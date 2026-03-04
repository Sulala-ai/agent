/**
 * Optional Pi (coding-agent) path. When AGENT_USE_PI=1 or request use_pi=true,
 * the agent runs via Pi SDK. Requires optionalDependencies:
 * @mariozechner/pi-agent-core, pi-ai, pi-coding-agent.
 */
/// <reference path="./pi-runner.d.ts" />

import { createRequire } from 'module';
import { config } from '../config.js';
import { getAgentMessages, appendAgentMessage } from '../db/index.js';
import { getMemoryForContext, getSharedScopeKeyForSession } from './memory.js';
import { listTools } from './tools.js';
import type { ToolDef, AgentTurnMessage, ToolCallSpec } from '../types.js';

const require = createRequire(import.meta.url);

let piAvailable: boolean | null = null;

/** True if Pi optional deps are installed and Pi path can be used. */
export function isPiAvailable(): boolean {
  if (piAvailable !== null) return piAvailable;
  try {
    require.resolve('@mariozechner/pi-agent-core');
    require.resolve('@mariozechner/pi-ai');
    require.resolve('@mariozechner/pi-coding-agent');
    piAvailable = true;
  } catch {
    piAvailable = false;
  }
  return piAvailable;
}

export interface RunTurnOptions {
  sessionId: string;
  userMessage?: string | null;
  systemPrompt?: string | null;
  provider?: string;
  model?: string;
  max_tokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunTurnResult {
  sessionId: string;
  messages: AgentTurnMessage[];
  finalContent: string;
  turnCount: number;
}

/** Run one agent turn using the Pi coding-agent runtime. Throws if Pi is not available. */
export async function runAgentTurnWithPi(options: RunTurnOptions): Promise<RunTurnResult> {
  const {
    sessionId,
    userMessage = null,
    systemPrompt: optionPrompt = null,
    provider,
    model,
    max_tokens = 1024,
    timeoutMs,
    signal,
  } = options;

  if (!isPiAvailable()) {
    throw new Error(
      'Pi runner not available. Install optional dependencies: npm install @mariozechner/pi-agent-core @mariozechner/pi-ai @mariozechner/pi-coding-agent',
    );
  }

  const pi = await import('@mariozechner/pi-coding-agent');

  const cwd = config.agentWorkspaceRoot ?? process.cwd();
  const agentDir = `${process.env.HOME || process.env.USERPROFILE || '.'}/.sulala/pi`;
  const sessionManager = pi.SessionManager.inMemory();
  const settingsManager = pi.SettingsManager.create(cwd, agentDir);

  const providerId = (provider ?? process.env.AI_DEFAULT_PROVIDER ?? 'ollama').toLowerCase();
  const modelId = model ?? (providerId === 'ollama' ? process.env.AI_OLLAMA_DEFAULT_MODEL ?? 'llama3.2' : '');
  const api = providerId === 'ollama' || providerId === 'llama' ? 'ollama' : 'openai';

  const piModel = {
    provider: providerId,
    id: modelId,
    api,
    baseUrl: providerId === 'ollama' ? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434' : undefined,
  };

  const sulalaTools = listTools();
  const customTools = sulalaToPiToolDefinitions(sulalaTools, sessionId);

  const authStorage = {
    getApiKey: async (_path?: string) => undefined,
    setApiKey: async (_path: string, _key: string) => {},
    getApiKeyForProvider: async (p: string) => {
      const key = p.toLowerCase();
      if (key === 'openai') return process.env.OPENAI_API_KEY ?? undefined;
      if (key === 'anthropic') return process.env.ANTHROPIC_API_KEY ?? undefined;
      if (key === 'ollama' || key === 'llama') return 'ollama';
      return process.env[`${p.toUpperCase().replace(/-/g, '_')}_API_KEY`] ?? undefined;
    },
  };

  const modelRegistry = {
    find: (_provider: string, id: string) => ({ ...piModel, id }),
    getApiKey: async (m: { provider?: string }) =>
      authStorage.getApiKeyForProvider(m?.provider ?? providerId),
    getApiKeyForProvider: authStorage.getApiKeyForProvider,
  };

  let resourceLoader: unknown = undefined;
  try {
    const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager });
    await loader.reload();
    resourceLoader = loader;
  } catch {
    resourceLoader = undefined;
  }

  const { session } = await pi.createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    settingsManager,
    model: piModel as unknown,
    modelRegistry: modelRegistry as unknown,
    authStorage: authStorage as unknown,
    tools: [],
    customTools: customTools as unknown[],
    resourceLoader,
    thinkingLevel: 'off',
  }) as {
    session: {
      agent: {
        streamFn: (model: unknown, context: unknown, options?: unknown) => unknown;
        messages: unknown[];
        replaceMessages: (messages: unknown[]) => void;
      };
      prompt: (text: string) => Promise<void>;
      dispose?: () => void;
    };
  };

  const runSignal = signal ?? (timeoutMs && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
  const sulalaStreamFn = createSulalaStreamFn({
    provider: providerId,
    model: modelId,
    max_tokens,
    signal: runSignal,
  });
  (session.agent as { streamFn: (m: unknown, c: unknown, o?: unknown) => unknown }).streamFn = (
    m: unknown,
    c: unknown,
    o?: unknown,
  ) => sulalaStreamFn(m as { provider?: string; id?: string }, c as { messages?: unknown[] }, o as { signal?: AbortSignal });

  let systemText = optionPrompt ?? config.agentSystemPrompt ?? 'You are a helpful assistant with access to tools.';
  const sessionMemory = getMemoryForContext('session', sessionId, { limit: 20, maxChars: 2000 });
  const sharedKey = getSharedScopeKeyForSession(sessionId);
  const sharedMemory =
    sharedKey != null ? getMemoryForContext('shared', sharedKey, { limit: 30, maxChars: 3000 }) : '';
  const memoryParts: string[] = [];
  if (sessionMemory) memoryParts.push('**This conversation:**\n' + sessionMemory);
  if (sharedMemory) memoryParts.push('**Across sessions:**\n' + sharedMemory);
  if (memoryParts.length > 0) {
    systemText += '\n\n## Memory\n\n' + memoryParts.join('\n\n');
  }
  const historyLimit = config.agentMaxHistoryMessages > 0 ? config.agentMaxHistoryMessages + 50 : 200;
  const history = getAgentMessages(sessionId, historyLimit);
  const piMessages = sulalaMessagesToPi(history, systemText);
  const numHistoryInPi = piMessages.length;
  if (piMessages.length > 0) session.agent.replaceMessages(piMessages);

  if (userMessage) {
    appendAgentMessage({ session_id: sessionId, role: 'user', content: userMessage });
  }

  const promptText = userMessage?.trim() ?? '';
  if (!promptText) {
    return {
      sessionId,
      messages: history.map((r) => ({ role: r.role, content: r.content ?? null })),
      finalContent: '',
      turnCount: 0,
    };
  }

  const controller = new AbortController();
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  if (timeoutMs && timeoutMs > 0) setTimeout(() => controller.abort(), timeoutMs);

  try {
    await session.prompt(promptText);
  } catch (err) {
    if (controller.signal.aborted) throw err;
    throw err;
  } finally {
    if (typeof session.dispose === 'function') session.dispose();
  }

  const finalMessages = (session.agent.messages ?? []) as Array<{ role: string; content?: string | Array<{ type?: string; text?: string }> }>;
  const lastAssistant = [...finalMessages].reverse().find((m) => m.role === 'assistant');
  const finalContent =
    typeof lastAssistant?.content === 'string'
      ? lastAssistant.content
      : Array.isArray(lastAssistant?.content)
        ? lastAssistant.content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text ?? '').join('')
        : '';

  const newMessages = finalMessages.slice(numHistoryInPi) as Array<{
    role: string;
    content?: string | Array<{ type?: string; text?: string }>;
    tool_calls?: unknown;
    tool_call_id?: string;
    name?: string;
  }>;
  for (const msg of newMessages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'toolResult' ? 'tool' : msg.role;
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => c?.text ?? '').join('')
          : '';
    appendAgentMessage({
      session_id: sessionId,
      role,
      content: content || null,
      tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      tool_call_id: msg.tool_call_id ?? null,
      name: msg.name ?? null,
    });
  }

  const turnCount = newMessages.filter((m: { role: string }) => m.role === 'assistant').length;
  const updatedHistory = getAgentMessages(sessionId);

  const messages = updatedHistory.map((r): AgentTurnMessage => {
    let tool_calls: ToolCallSpec[] | undefined;
    if (r.tool_calls) {
      try {
        const parsed = JSON.parse(r.tool_calls) as unknown;
        tool_calls = Array.isArray(parsed) ? (parsed as ToolCallSpec[]) : undefined;
      } catch {
        tool_calls = undefined;
      }
    }
    return {
      role: r.role,
      ...(r.content != null && { content: r.content }),
      ...(tool_calls !== undefined && { tool_calls }),
      ...(r.tool_call_id && { tool_call_id: r.tool_call_id }),
      ...(r.name && { name: r.name }),
    } as AgentTurnMessage;
  });

  return {
    sessionId,
    messages: messages as unknown as RunTurnResult['messages'],
    finalContent,
    turnCount,
  };
}

function sulalaToPiToolDefinitions(
  tools: ToolDef[],
  sessionId: string,
): Array<{
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, params: Record<string, unknown>, sig?: AbortSignal, _onUpdate?: (chunk: unknown) => void) => Promise<{ content: { type: 'text'; text: string }[]; details: unknown }>;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description ?? '',
    parameters: tool.parameters ?? {},
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      sig?: AbortSignal,
      _onUpdate?: (chunk: unknown) => void,
    ) => {
      const { executeTool } = await import('./tools.js');
      const result = await executeTool(tool.name, params, { toolCallId, signal: sig, sessionId });
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text' as const, text }],
        details: result,
      };
    },
  }));
}

function sulalaMessagesToPi(
  rows: Array<{ role: string; content: string | null; tool_calls?: string | null; tool_call_id?: string | null; name?: string | null }>,
  systemPrompt: string,
): Array<{ role: string; content?: string | Array<{ type: string; text?: string }>; tool_calls?: unknown; toolCallId?: string; toolName?: string }> {
  const out: Array<{ role: string; content?: string | Array<{ type: string; text?: string }>; tool_calls?: unknown; toolCallId?: string; toolName?: string }> = [];
  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }
  for (const r of rows) {
    if (r.role === 'system') continue;
    if (r.role === 'user') {
      out.push({ role: 'user', content: r.content ?? '' });
      continue;
    }
    if (r.role === 'assistant') {
      const msg: { role: string; content?: string; tool_calls?: unknown } = {
        role: 'assistant',
        content: r.content ?? '',
      };
      if (r.tool_calls) {
        try {
          msg.tool_calls = JSON.parse(r.tool_calls) as unknown;
        } catch {
          // ignore
        }
      }
      out.push(msg);
      continue;
    }
    if (r.role === 'tool') {
      out.push({
        role: 'toolResult',
        content: [{ type: 'text', text: r.content ?? '' }],
        toolCallId: r.tool_call_id ?? undefined,
        toolName: r.name ?? undefined,
      });
    }
  }
  return out;
}

function createSulalaStreamFn(opts: {
  provider: string;
  model: string;
  max_tokens: number;
  signal?: AbortSignal;
}) {
  return async (
    model: { provider?: string; id?: string },
    context: { messages?: unknown[] },
    options?: { signal?: AbortSignal },
  ) => {
    const { complete } = await import('../ai/orchestrator.js');
    const provider = model?.provider ?? opts.provider;
    const modelId = model?.id ?? opts.model;
    const messages = context?.messages ?? [];
    const sulalaMessages = piMessagesToSulala(messages);
    const tools = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const result = await complete({
      provider,
      model: modelId,
      messages: sulalaMessages as Array<{ role: string; content?: string | null; tool_calls?: ToolCallSpec[]; tool_call_id?: string; name?: string }>,
      max_tokens: opts.max_tokens,
      tools: tools.length ? tools : undefined,
      signal: options?.signal ?? opts.signal,
    });
    return (async function* () {
      if (result.content) yield { type: 'content', content: result.content } as const;
      if (result.tool_calls?.length) yield { type: 'tool_calls', tool_calls: result.tool_calls } as const;
    })();
  };
}

function piMessagesToSulala(piMessages: unknown[]): Array<{ role: string; content?: string | null; tool_calls?: unknown }> {
  return piMessages.map((m) => {
    const msg = m as { role: string; content?: string | Array<{ type?: string; text?: string }>; tool_calls?: unknown };
    const role = msg.role;
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => (typeof c === 'object' && c && 'text' in c ? (c as { text?: string }).text ?? '' : '')).join('')
          : '';
    const out: { role: string; content?: string | null; tool_calls?: unknown } = { role, content: content || null };
    if (msg.tool_calls) out.tool_calls = msg.tool_calls;
    return out;
  });
}
