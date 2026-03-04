import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { complete, completeStream, type StreamChunkEvent } from '../ai/orchestrator.js';
import { estimateCostUsd } from '../ai/pricing.js';
import { getAgentMessages, appendAgentMessage } from '../db/index.js';
import { log } from '../db/index.js';
import { config } from '../config.js';
import {
  runAgentHooksSessionStart,
  runAgentHooksSessionEnd,
  runAgentHooksBeforePromptBuild,
  runAgentHooksBeforeToolCall,
  runAgentHooksAfterToolCall,
  runAgentHooksAgentEnd,
} from '../plugins/index.js';
import { listTools, executeTool, getAgentRunDepth, setAgentRunDepth, type ExecuteToolOptions } from './tools.js';
import { getMemoryForContext, getSharedScopeKeyForSession } from './memory.js';
import { getSkillPaths } from './skills.js';
import { isSkillEnabled } from './skills-config.js';
import type { AgentTurnMessage, AgentMessageRow } from '../types.js';

export type AgentStreamEvent =
  | { type: 'assistant'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; name: string; result?: unknown }
  | { type: 'done'; finalContent: string; turnCount: number; usage?: Record<string, number> }
  | { type: 'error'; message: string };

const DEFAULT_SYSTEM = 'You are a helpful assistant. You have access to tools; use them when appropriate.';
const MAX_TOOL_TURNS = 10;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const e = new Error('Agent run aborted');
    e.name = 'AbortError';
    throw e;
  }
}

function buildEffectiveSignal(options: RunTurnOptions): { signal: AbortSignal | undefined; cleanup: () => void } {
  const timeoutMs = options.timeoutMs ?? config.agentTimeoutMs ?? 0;
  if (timeoutMs <= 0 && !options.signal) return { signal: undefined, cleanup: () => {} };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) options.signal.addEventListener('abort', () => controller.abort());
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer != null) clearTimeout(timer);
    },
  };
}

function rowsToMessages(rows: (AgentMessageRow & { id?: number })[]): AgentTurnMessage[] {
  return rows.map((r) => {
    const msg: AgentTurnMessage = { role: r.role };
    if (r.content != null) msg.content = r.content;
    if (r.tool_calls) {
      try {
        msg.tool_calls = JSON.parse(r.tool_calls) as Array<{ id: string; name: string; arguments: string }>;
      } catch {
        // ignore
      }
    }
    if (r.tool_call_id) msg.tool_call_id = r.tool_call_id;
    if (r.name) msg.name = r.name;
    return msg;
  });
}

/** Keep only the last tool message per tool_call_id so the API never sees duplicates (e.g. pending placeholder + result). */
function deduplicateToolMessages(messages: AgentTurnMessage[]): AgentTurnMessage[] {
  const lastIndexByToolCallId = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role === 'tool' && m.tool_call_id) lastIndexByToolCallId.set(m.tool_call_id, i);
  });
  return messages.filter((m, i) => m.role !== 'tool' || !m.tool_call_id || lastIndexByToolCallId.get(m.tool_call_id) === i);
}

/** Estimate token count (conservative: ~3.5 chars per token so we stay under API limits). */
function estimateTokens(messages: AgentTurnMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.content) n += m.content.length;
    if (m.tool_calls) for (const tc of m.tool_calls) n += (tc.arguments?.length ?? 0) + (tc.name?.length ?? 0);
  }
  return Math.ceil(n / 3.5);
}

const MAX_CHARS_PER_MESSAGE = 6000;
/** Hard cap so we never send more than the model can accept (e.g. 128k for many models). */
const API_MAX_CONTEXT_TOKENS = 128000;

/** Truncate message content and tool args so no single message blows the context. */
function truncateMessagesForContext(messages: AgentTurnMessage[]): AgentTurnMessage[] {
  let out = messages.map((m) => {
    const msg: AgentTurnMessage = { role: m.role };
    if (m.content != null) {
      msg.content = m.content.length <= MAX_CHARS_PER_MESSAGE ? m.content : m.content.slice(0, MAX_CHARS_PER_MESSAGE) + '\n\n[... truncated]';
    }
    if (m.tool_calls?.length) {
      msg.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: (tc.arguments?.length ?? 0) <= MAX_CHARS_PER_MESSAGE ? (tc.arguments ?? '') : (tc.arguments!.slice(0, MAX_CHARS_PER_MESSAGE) + ' ... [truncated]'),
      }));
    }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.name) msg.name = m.name;
    return msg;
  });
  const limit = Math.min(config.agentMaxContextTokens || API_MAX_CONTEXT_TOKENS, API_MAX_CONTEXT_TOKENS);
  while (estimateTokens(out) > limit && out.length > 2) {
    const dropIndex = out.findIndex((m) => m.role !== 'system');
    if (dropIndex === -1) break;
    out = out.filter((_, i) => i !== dropIndex);
  }
  return out;
}

/** Return the last user message content (for debugging why a tool was called). */
function getLastUserContent(messages: AgentTurnMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const c = last && 'content' in last ? last.content : null;
  return typeof c === 'string' ? c : c != null ? JSON.stringify(c).slice(0, 500) : '(none)';
}

/** Apply message compaction: limit by count and optionally by token budget. */
function compactHistory(rows: (AgentMessageRow & { id?: number })[], systemPromptLength: number): (AgentMessageRow & { id?: number })[] {
  let out = rows;
  if (config.agentMaxHistoryMessages > 0 && out.length > config.agentMaxHistoryMessages) {
    out = out.slice(-config.agentMaxHistoryMessages);
  }
  if (config.agentMaxContextTokens > 0) {
    let msgs = rowsToMessages(out);
    let tokens = systemPromptLength + estimateTokens(msgs);
    while (tokens > config.agentMaxContextTokens && msgs.length > 2) {
      msgs = msgs.slice(1);
      out = out.slice(1);
      tokens = systemPromptLength + estimateTokens(msgs);
    }
  }
  return out;
}

const TOOL_RETRY_DELAY_MS = 500;

async function executeToolWithRetry(
  name: string,
  args: Record<string, unknown>,
  opts?: ExecuteToolOptions,
): Promise<unknown> {
  const maxRetries = config.agentToolRetryCount;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, TOOL_RETRY_DELAY_MS * attempt));
    }
    try {
      return await executeTool(name, args, opts);
    } catch (err) {
      lastErr = err;
      log('agent', 'warn', `Tool ${name} attempt ${attempt + 1}/${maxRetries + 1} failed`, { error: (err as Error).message });
    }
  }
  throw lastErr;
}

export interface RunTurnOptions {
  sessionId: string;
  userMessage?: string | null;
  systemPrompt?: string | null;
  provider?: string;
  model?: string;
  max_tokens?: number;
  /** Max run time in ms; overrides config.agentTimeoutMs when set. */
  timeoutMs?: number;
  /** When aborted, the run throws. Used for request disconnect or cancel. */
  signal?: AbortSignal;
  /** When true, high-risk tools (e.g. send email) run without approval. Use for scheduled jobs where no one is there to approve. */
  skipToolApproval?: boolean;
}

export interface RunTurnResult {
  sessionId: string;
  messages: AgentTurnMessage[];
  finalContent: string;
  turnCount: number;
  /** Set when execution preview is on and a high-risk tool is awaiting user approval. */
  pendingActionId?: string;
}

/** Parse YAML-like frontmatter (--- ... ---) and return name, description, and body. */
function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: content };
  const block = match[1];
  const body = match[2].trim();
  let name: string | undefined;
  let description: string | undefined;
  for (const line of block.split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return { name, description, body };
}

function collectFiles(base: string): { path: string; name: string }[] {
  const files: { path: string; name: string }[] = [];
  if (!existsSync(base)) return files;
  try {
    const stat = statSync(base);
    if (stat.isFile() && (base.endsWith('.md') || base.endsWith('.txt'))) {
      files.push({ path: base, name: base.split(/[/\\]/).pop() || '' });
    } else if (stat.isDirectory()) {
      const names = readdirSync(base).sort();
      for (const n of names) {
        if (!n.endsWith('.md') && !n.endsWith('.txt')) continue;
        files.push({ path: join(base, n), name: n });
      }
    }
  } catch (e) {
    log('agent', 'warn', `Skip skill path ${base}: ${(e as Error).message}`);
  }
  return files;
}

function loadContextFromPaths(): string {
  const paths = getSkillPaths(config);
  const bySkillName = new Map<string, { index: { name: string; description: string }; body: string }>();
  const nonSkillChunks: string[] = [];
  for (const { path: base } of paths) {
    for (const { path: full, name: fileName } of collectFiles(base)) {
      try {
        const raw = readFileSync(full, 'utf8');
        if (!fileName.endsWith('.md')) {
          nonSkillChunks.push(`--- ${fileName}\n${raw}`);
          continue;
        }
        const parsed = parseFrontmatter(raw);
        const slug = fileName.replace(/\.md$/, '');
        if (parsed.name && parsed.description && isSkillEnabled(slug)) {
          bySkillName.set(parsed.name, {
            index: { name: parsed.name, description: parsed.description },
            body: parsed.body,
          });
        } else {
          nonSkillChunks.push(`--- ${fileName}\n${raw}`);
        }
      } catch (e) {
        log('agent', 'warn', `Skip context file ${full}: ${(e as Error).message}`);
      }
    }
  }
  const skillIndex = Array.from(bySkillName.values()).map((v) => v.index);
  const chunks = Array.from(bySkillName.values()).map(
    (v) => `### Skill: ${v.index.name}\n\n${v.body}`
  );
  chunks.push(...nonSkillChunks);
  if (chunks.length === 0) return '';
  const indexSection =
    skillIndex.length > 0
      ? `### Available skills (use when the user's request matches)\n${skillIndex.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n\n`
      : '';
  // Inject workspace path so the agent knows where to create skills and watch-folder automations.
  const workspaceSection =
    `## Workspace\n\n` +
    `- **Skills**: \`${config.skillsWorkspaceDir}\` — use **write_file** with path \`${config.skillsWorkspaceDir}/<slug>/SKILL.md\` when creating a skill. Do not use \`~\` or \`$HOME\`.\n\n` +
    `- **Scripts and watch-folder automations**: Workspace root is \`${config.workspaceDir}\`. When the user asks to watch a folder and do something (e.g. post new images to Bluesky or Facebook):\n` +
    `  1. Create a script under \`${config.workspaceDir}/scripts/\` (e.g. \`scripts/watch_bluesky.sh\` or \`scripts/watch_facebook.sh\`) that accepts the **file path as first argument** (\`$1\`) and uses env vars for credentials.\n` +
    `  2. Store credentials in \`${config.workspaceDir}/.env\` (e.g. \`BSKY_HANDLE=...\`, \`BSKY_APP_PASSWORD=...\` or \`PAGE_ACCESS_TOKEN=...\`). Use **write_file** to create or append lines to \`.env\`.\n` +
    `  3. Call **register_automation** with \`id\`, \`script\` (e.g. \`scripts/watch_bluesky.sh\`), \`watch_folders\` (array of absolute paths), and optional \`filter: "image"\` for image-only. The agent will run your script when matching files are added.\n` +
    `  4. **Always test the script yourself** before replying: run it with **run_command** and a real file path from the watch folder (e.g. an existing image). Example: \`bash -lc "set -a; source ${config.workspaceDir}/.env; set +a; ${config.workspaceDir}/scripts/your_script.sh /path/to/existing/image.jpg"\`. If it fails (e.g. missing argument, auth error), fix the script or .env and run again until it succeeds. Do not tell the user to test manually.\n\n`;
  return `\n\n## Context\n\n${workspaceSection}${indexSection}${chunks.join('\n\n')}`;
}

async function resolveSystemPrompt(
  sessionId: string,
  basePrompt: string,
  messageCount: number
): Promise<string> {
  const context = loadContextFromPaths();
  let withContext = basePrompt + context;

  const sessionMemory = getMemoryForContext('session', sessionId, { limit: 20, maxChars: 2000 });
  const sharedKey = getSharedScopeKeyForSession(sessionId);
  const sharedMemory =
    sharedKey != null ? getMemoryForContext('shared', sharedKey, { limit: 30, maxChars: 3000 }) : '';
  const memoryParts: string[] = [];
  if (sessionMemory) memoryParts.push('**This conversation:**\n' + sessionMemory);
  if (sharedMemory) memoryParts.push('**Across sessions:**\n' + sharedMemory);
  if (memoryParts.length > 0) {
    withContext += '\n\n## Memory\n\n' + memoryParts.join('\n\n');
  }

  const overridden = await runAgentHooksBeforePromptBuild(sessionId, {
    systemPrompt: withContext,
    messageCount,
  });
  return overridden ?? withContext;
}

export async function runAgentTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const {
    sessionId,
    userMessage = null,
    systemPrompt: optionPrompt = null,
    provider,
    model,
    max_tokens = 1024,
    skipToolApproval = false,
  } = options;

  const { signal, cleanup } = buildEffectiveSignal(options);
  setAgentRunDepth(getAgentRunDepth() + 1);
  try {
    throwIfAborted(signal);
    await runAgentHooksSessionStart(sessionId);

    const historyLimit = config.agentMaxHistoryMessages > 0 ? config.agentMaxHistoryMessages + 50 : 80;
    const history = getAgentMessages(sessionId, historyLimit);
    const baseSystem = optionPrompt ?? config.agentSystemPrompt ?? DEFAULT_SYSTEM;
    let systemPrompt = await resolveSystemPrompt(sessionId, baseSystem, history.length + 1);
    const compacted = compactHistory(history, systemPrompt.length);
    const messages: AgentTurnMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...deduplicateToolMessages(rowsToMessages(compacted)));

    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
      appendAgentMessage({ session_id: sessionId, role: 'user', content: userMessage });
    }

    const toolsForApi = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let turnCount = 0;
    let lastContent = '';

    while (turnCount < MAX_TOOL_TURNS) {
      throwIfAborted(signal);
      turnCount++;
      const apiMessages = truncateMessagesForContext(messages);
      const result = await complete({
        provider,
        model,
        messages: apiMessages,
        max_tokens,
        tools: toolsForApi.length ? toolsForApi : undefined,
        signal,
      });

      lastContent = result.content ?? '';

      const assistantContent = result.content ?? null;
      const toolCalls = result.tool_calls;

      appendAgentMessage({
        session_id: sessionId,
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
      });

      if (!toolCalls?.length) {
        break;
      }

      const lastUser = getLastUserContent(messages);
      console.log(
        '[agent] Tools:',
        toolCalls.map((tc) => tc.name).join(', '),
        '| Last user message:',
        lastUser.slice(0, 300),
        lastUser.length > 300 ? '...' : ''
      );

      messages.push({
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        throwIfAborted(signal);
        console.log('[agent] Tool:', tc.name);
        let args: Record<string, unknown> = {};
        if (tc.arguments?.trim()) {
          try {
            args = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch (parseErr) {
            log('agent', 'warn', `Tool ${tc.name} arguments invalid or truncated`, {
              error: parseErr instanceof Error ? parseErr.message : String(parseErr),
              length: tc.arguments?.length ?? 0,
            });
            args = { __parseError: 'Arguments were truncated or invalid; please try again with a shorter or simpler request.' };
          }
        }
        args = await runAgentHooksBeforeToolCall(sessionId, tc.name, args);
        let toolResult: unknown;
        const parseError = args?.__parseError as string | undefined;
        if (parseError) {
          toolResult = { error: parseError };
        } else {
          try {
            toolResult = await executeToolWithRetry(tc.name, args, {
              toolCallId: tc.id,
              signal,
              sessionId,
              skipApproval: skipToolApproval,
            });
          } catch (err) {
            toolResult = { error: err instanceof Error ? err.message : String(err) };
            log('agent', 'warn', `Tool ${tc.name} failed after retries`, { error: (err as Error).message });
          }
        }
        await runAgentHooksAfterToolCall(sessionId, tc.name, args, toolResult);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
        appendAgentMessage({
          session_id: sessionId,
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
        const pending = typeof toolResult === 'object' && toolResult !== null && (toolResult as { __pendingApproval?: boolean }).__pendingApproval;
        if (pending) {
          const pendingActionId = (toolResult as { pendingActionId: string }).pendingActionId;
          const updatedHistory = getAgentMessages(sessionId);
          return {
            sessionId,
            messages: rowsToMessages(updatedHistory),
            finalContent: lastContent,
            turnCount,
            pendingActionId,
          };
        }
      }
    }

    const updatedHistory = getAgentMessages(sessionId);
    const result: RunTurnResult = {
      sessionId,
      messages: rowsToMessages(updatedHistory),
      finalContent: lastContent,
      turnCount,
    };
    await runAgentHooksAgentEnd(sessionId, { finalContent: lastContent, turnCount });
    return result;
  } finally {
    setAgentRunDepth(getAgentRunDepth() - 1);
    cleanup();
    await runAgentHooksSessionEnd(sessionId);
  }
}

/** Run agent turn with streaming (OpenAI: deltas; others: single done). */
export async function runAgentTurnStream(
  options: RunTurnOptions,
  onEvent: (ev: AgentStreamEvent) => void
): Promise<RunTurnResult> {
  const {
    sessionId,
    userMessage = null,
    systemPrompt: optionPrompt = null,
    provider,
    model,
    max_tokens = 1024,
    skipToolApproval = false,
  } = options;

  const { signal, cleanup } = buildEffectiveSignal(options);
  setAgentRunDepth(getAgentRunDepth() + 1);
  try {
    throwIfAborted(signal);
    await runAgentHooksSessionStart(sessionId);

    const historyLimit = config.agentMaxHistoryMessages > 0 ? config.agentMaxHistoryMessages + 50 : 80;
    const history = getAgentMessages(sessionId, historyLimit);
    const baseSystem = optionPrompt ?? config.agentSystemPrompt ?? DEFAULT_SYSTEM;
    let systemPrompt = await resolveSystemPrompt(sessionId, baseSystem, history.length + 1);
    const compacted = compactHistory(history, systemPrompt.length);
    const messages: AgentTurnMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...deduplicateToolMessages(rowsToMessages(compacted)));
    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
      appendAgentMessage({ session_id: sessionId, role: 'user', content: userMessage });
    }

    const toolsForApi = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let turnCount = 0;
    let lastContent = '';
    const useStream = ['openai', 'openrouter', 'ollama', 'llama'].includes(provider ?? process.env.AI_DEFAULT_PROVIDER ?? 'ollama');

    while (turnCount < MAX_TOOL_TURNS) {
      throwIfAborted(signal);
      turnCount++;
      const isFirstTurn = turnCount === 1;

      if (useStream && isFirstTurn) {
        const apiMessages = truncateMessagesForContext(messages);
        const result = await completeStream(
          { provider, model, messages: apiMessages, max_tokens, tools: toolsForApi.length ? toolsForApi : undefined, signal, think: true },
          (ev: StreamChunkEvent) => {
            if (ev.type === 'delta') onEvent({ type: 'assistant', delta: ev.content });
            if (ev.type === 'thinking') onEvent({ type: 'thinking', delta: ev.delta });
          }
        );
        lastContent = result.content ?? '';
        const costUsd = estimateCostUsd(result.usage ?? undefined, model);
        appendAgentMessage({
          session_id: sessionId,
          role: 'assistant',
          content: lastContent,
          tool_calls: result.tool_calls ? JSON.stringify(result.tool_calls) : null,
          usage: result.usage ?? undefined,
          cost_usd: costUsd ?? undefined,
        });
        if (result.tool_calls?.length) {
          const lastUserStreamChunk = getLastUserContent(messages);
          console.log(
            '[agent] Tools:',
            result.tool_calls.map((tc) => tc.name).join(', '),
            '| Last user message:',
            lastUserStreamChunk.slice(0, 300),
            lastUserStreamChunk.length > 300 ? '...' : ''
          );
          messages.push({ role: 'assistant', content: lastContent, tool_calls: result.tool_calls });
          for (const tc of result.tool_calls) {
            throwIfAborted(signal);
            console.log('[agent] Tool:', tc.name);
            let args: Record<string, unknown> = {};
            if (tc.arguments?.trim()) {
              try {
                args = JSON.parse(tc.arguments) as Record<string, unknown>;
              } catch (parseErr) {
                log('agent', 'warn', `Tool ${tc.name} arguments invalid or truncated (streaming)`, {
                  error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                  length: tc.arguments.length,
                });
                args = { __parseError: 'Arguments were truncated or invalid; please try again with a shorter or simpler request.' };
              }
            }
            args = await runAgentHooksBeforeToolCall(sessionId, tc.name, args);
            let toolResult: unknown;
            const parseError = args?.__parseError as string | undefined;
            if (parseError) {
              toolResult = { error: parseError };
            } else {
              try {
                toolResult = await executeToolWithRetry(tc.name, args, {
                  toolCallId: tc.id,
                  signal,
                  sessionId,
                  skipApproval: skipToolApproval,
                });
              } catch (err) {
                toolResult = { error: err instanceof Error ? err.message : String(err) };
                log('agent', 'warn', `Tool ${tc.name} failed after retries`, { error: (err as Error).message });
              }
            }
            await runAgentHooksAfterToolCall(sessionId, tc.name, args, toolResult);
            onEvent({ type: 'tool_call', name: tc.name, result: toolResult });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
            appendAgentMessage({
              session_id: sessionId,
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });
            const pending = typeof toolResult === 'object' && toolResult !== null && (toolResult as { __pendingApproval?: boolean }).__pendingApproval;
            if (pending) {
              const pendingActionId = (toolResult as { pendingActionId: string }).pendingActionId;
              const updatedHistory = getAgentMessages(sessionId);
              const runResult: RunTurnResult = { sessionId, messages: rowsToMessages(updatedHistory), finalContent: lastContent, turnCount, pendingActionId };
              await runAgentHooksAgentEnd(sessionId, { finalContent: lastContent, turnCount });
              return runResult;
            }
          }
          continue;
        }
        onEvent({ type: 'done', finalContent: lastContent, turnCount, usage: result.usage });
        const updatedHistory = getAgentMessages(sessionId);
        const runResult: RunTurnResult = { sessionId, messages: rowsToMessages(updatedHistory), finalContent: lastContent, turnCount };
        await runAgentHooksAgentEnd(sessionId, { finalContent: lastContent, turnCount });
        return runResult;
      }

      const apiMessages = truncateMessagesForContext(messages);
      const result = await complete({
        provider,
        model,
        messages: apiMessages,
        max_tokens,
        tools: toolsForApi.length ? toolsForApi : undefined,
        signal,
      });
      lastContent = result.content ?? '';
      const toolCalls = result.tool_calls;
      const costUsd = estimateCostUsd(result.usage ?? undefined, model);
      appendAgentMessage({
        session_id: sessionId,
        role: 'assistant',
        content: lastContent,
        tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
        usage: result.usage ?? undefined,
        cost_usd: costUsd ?? undefined,
      });
      if (!toolCalls?.length) {
        onEvent({ type: 'done', finalContent: lastContent, turnCount, usage: result.usage });
        break;
      }
      const lastUserStream = getLastUserContent(messages);
      console.log(
        '[agent] Tools:',
        toolCalls.map((tc) => tc.name).join(', '),
        '| Last user message:',
        lastUserStream.slice(0, 300),
        lastUserStream.length > 300 ? '...' : ''
      );
      messages.push({ role: 'assistant', content: lastContent, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        throwIfAborted(signal);
        console.log('[agent] Tool:', tc.name);
        let args: Record<string, unknown> = {};
        if (tc.arguments?.trim()) {
          try {
            args = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch (parseErr) {
            log('agent', 'warn', `Tool ${tc.name} arguments invalid or truncated`, {
              error: parseErr instanceof Error ? parseErr.message : String(parseErr),
              length: tc.arguments?.length ?? 0,
            });
            args = { __parseError: 'Arguments were truncated or invalid; please try again with a shorter or simpler request.' };
          }
        }
        args = await runAgentHooksBeforeToolCall(sessionId, tc.name, args);
        let toolResult: unknown;
        const parseError = args?.__parseError as string | undefined;
        if (parseError) {
          toolResult = { error: parseError };
        } else {
          try {
            toolResult = await executeToolWithRetry(tc.name, args, {
              toolCallId: tc.id,
              signal,
              sessionId,
              skipApproval: skipToolApproval,
            });
          } catch (err) {
            toolResult = { error: err instanceof Error ? err.message : String(err) };
            log('agent', 'warn', `Tool ${tc.name} failed after retries`, { error: (err as Error).message });
          }
        }
        await runAgentHooksAfterToolCall(sessionId, tc.name, args, toolResult);
        onEvent({ type: 'tool_call', name: tc.name, result: toolResult });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
        appendAgentMessage({
          session_id: sessionId,
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
        const pending = typeof toolResult === 'object' && toolResult !== null && (toolResult as { __pendingApproval?: boolean }).__pendingApproval;
        if (pending) {
          const pendingActionId = (toolResult as { pendingActionId: string }).pendingActionId;
          const updatedHistory = getAgentMessages(sessionId);
          const runResult: RunTurnResult = { sessionId, messages: rowsToMessages(updatedHistory), finalContent: lastContent, turnCount, pendingActionId };
          await runAgentHooksAgentEnd(sessionId, { finalContent: lastContent, turnCount });
          return runResult;
        }
      }
    }

    const updatedHistory = getAgentMessages(sessionId);
    const runResult: RunTurnResult = { sessionId, messages: rowsToMessages(updatedHistory), finalContent: lastContent, turnCount };
    onEvent({ type: 'done', finalContent: lastContent, turnCount, usage: undefined });
    await runAgentHooksAgentEnd(sessionId, { finalContent: lastContent, turnCount });
    return runResult;
  } finally {
    setAgentRunDepth(getAgentRunDepth() - 1);
    cleanup();
    await runAgentHooksSessionEnd(sessionId);
  }
}
