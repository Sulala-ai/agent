import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { resolve, relative, dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { insertTask, getOrCreateAgentSession, insertScheduledJob, getScheduledJob } from '../db/index.js';
import { scheduleCronById } from '../scheduler/cron.js';
import { parseJobFromMessage } from './job-parse.js';
import { getEffectiveTelegramConfig } from '../channels/telegram.js';
import { config, getPortalGatewayBase } from '../config.js';
import { registerSpecTools } from './tool/spec-loader.js';
import {
  appendMemory,
  listMemories,
  getSharedScopeKeyForSession,
} from './memory.js';
import { addWatchPaths } from '../watcher/index.js';
import { createPendingAction } from './pending-actions.js';
import { getSkillConfigEnv, getSkillToolPolicy } from './skills-config.js';
import { redactSecretKeysInSummary } from '../redact.js';
import { runAgentTurn } from './loop.js';
import { getPluginTools, type PluginToolContext } from '../plugins/index.js';
import type { Config, ToolDef, ToolExecuteContext } from '../types.js';

const registry = new Map<string, ToolDef>();

/** Tool names registered from skills (tools.yaml); cleared and repopulated on skills_changed. */
let lastSpecToolNames: string[] = [];

/** Current agent run depth (0 = top-level). Used to block nested run_agent. */
let agentRunDepth = 0;

export function getAgentRunDepth(): number {
  return agentRunDepth;
}

export function setAgentRunDepth(d: number): void {
  agentRunDepth = d;
}

export function registerTool(tool: ToolDef): void {
  registry.set(tool.name, tool);
}

/** Remove tools by name (used when refreshing spec tools on skills_changed). */
export function unregisterTools(names: string[]): void {
  for (const n of names) registry.delete(n);
}

/** Re-load spec tools from skill dirs (~/.sulala/workspace/skills, context, etc.). Call on skills_changed so new skills are recognized without restart. */
export function refreshSpecTools(cfg: Config): void {
  unregisterTools(lastSpecToolNames);
  lastSpecToolNames = registerSpecTools((t) => registerTool(t), cfg);
}

export function getTool(name: string): ToolDef | undefined {
  return registry.get(name);
}

/** Tool names that perform writes; excluded when a skill has readOnly: true. */
const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'run_command',
  'register_automation',
  'create_scheduled_job',
  'add_mcp_server',
  'list_mcp_servers',
]);

export interface ListToolsOptions {
  allowlist?: string[] | null;
  profile?: 'full' | 'messaging' | 'coding' | 'minimal';
  /** Context for plugin tool resolution (e.g. sessionId). */
  pluginContext?: PluginToolContext;
  /** When set, apply this skill's allowedTools and readOnly policy. */
  skillSlug?: string;
}

/** Re-export for callers that build pluginContext. */
export type { PluginToolContext } from '../plugins/index.js';

/** Policy step: filter tools by allowlist and profile. */
export function applyToolPolicyPipeline(
  tools: ToolDef[],
  options: { allowlist?: string[] | null; profile?: 'full' | 'messaging' | 'coding' | 'minimal' },
): ToolDef[] {
  let out = tools;
  const allowlist = options.allowlist ?? config.agentToolAllowlist;
  const profile = options.profile ?? config.agentToolProfile;
  if (allowlist?.length) {
    const set = new Set(allowlist.map((n) => n.trim().toLowerCase()));
    out = out.filter((t) => set.has(t.name.toLowerCase()));
  }
  if (profile !== 'full') {
    const allowed = PROFILE_TOOLS[profile];
    if (allowed) out = out.filter((t) => allowed.has(t.name));
  }
  return out;
}

/** List tools: core registry + plugin tools, then policy (allowlist + profile). When skillSlug is set, apply that skill's allowedTools and readOnly. */
export function listTools(options?: ListToolsOptions): ToolDef[] {
  const core = [...registry.values()];
  const pluginTools = getPluginTools(options?.pluginContext ?? {});
  const nameSet = new Set(core.map((t) => t.name.toLowerCase()));
  const merged: ToolDef[] = [...core];
  for (const t of pluginTools) {
    if (nameSet.has(t.name.toLowerCase())) continue;
    nameSet.add(t.name.toLowerCase());
    merged.push(t);
  }
  let allowlist = options?.allowlist ?? config.agentToolAllowlist;
  if (options?.skillSlug) {
    const policy = getSkillToolPolicy(options.skillSlug);
    if (policy.allowlist !== null) allowlist = policy.allowlist;
    let out = applyToolPolicyPipeline(merged, {
      allowlist,
      profile: options?.profile ?? config.agentToolProfile,
    });
    if (policy.readOnly) {
      out = out.filter((t) => !WRITE_TOOL_NAMES.has(t.name));
    }
    return out;
  }
  return applyToolPolicyPipeline(merged, {
    allowlist,
    profile: options?.profile ?? config.agentToolProfile,
  });
}

const PROFILE_TOOLS: Record<string, Set<string>> = {
  messaging: new Set([
    'run_task',
    'run_command',
    'list_mcp_servers',
    'write_memory',
    'read_memory',
  ]),
  coding: new Set([
    'run_task',
    'read_file',
    'write_file',
    'run_command',
    'list_mcp_servers',
    'write_memory',
    'read_memory',
  ]),
  minimal: new Set(['run_task']),
};

export interface ExecuteToolOptions {
  toolCallId?: string;
  signal?: AbortSignal;
  /** When set, enforce this skill's allowedTools and readOnly before executing. */
  skillSlug?: string;
  /** When set with agentExecutionPreview, high-risk tools create a pending action instead of running. */
  sessionId?: string;
  /** When true, skip execution-preview gate (used when replaying an approved action). */
  skipApproval?: boolean;
}

/** Execute a tool; throws if tool is unknown or not allowed. When execution preview is on and tool is high-risk, returns pending-approval payload instead of running. */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  opts?: ExecuteToolOptions,
): Promise<unknown> {
  const allowed = listTools({ skillSlug: opts?.skillSlug });
  const tool = allowed.find((t) => t.name === name);
  if (!tool) {
    throw new Error(opts?.skillSlug ? `Tool "${name}" is not allowed for this skill` : `Unknown tool: ${name}`);
  }
  if (
    config.agentExecutionPreview &&
    WRITE_TOOL_NAMES.has(name) &&
    !opts?.skipApproval &&
    opts?.sessionId &&
    opts?.toolCallId
  ) {
    const pendingActionId = createPendingAction(opts.sessionId, opts.toolCallId, name, args);
    const message = `This action requires your approval: ${name}. Approve or reject in the dashboard.`;
    return Promise.resolve({ __pendingApproval: true, pendingActionId, message });
  }
  const context: ToolExecuteContext | undefined =
    opts?.toolCallId != null || opts?.signal != null || opts?.sessionId != null
      ? {
          toolCallId: opts.toolCallId,
          signal: opts.signal,
          sessionId: opts.sessionId,
        }
      : undefined;
  const result = tool.execute(args, context);
  return Promise.resolve(result);
}

/** Built-in: enqueue a task (type + optional payload) */
export function registerBuiltInTools(enqueueTask: (taskId: string) => void): void {
  registerTool({
    name: 'run_task',
    description:
      'Enqueue a background task by type and optional payload. Use ONLY for system/scheduled task types (e.g. heartbeat, file_event, agent_job). Do NOT use for user-requested immediate results: for read/summarize email, list calendar, create invoice, or similar, use MCP tools or run_command with skill OAuth (e.g. Gmail skill) and return the result in this turn.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type (e.g. heartbeat, file_event, agent_job)' },
        payload: { type: 'object', description: 'Optional JSON payload' },
      },
      required: ['type'],
    },
    profile: 'full',
    execute: (args) => {
      const type = args.type as string;
      const payload = args.payload ?? null;
      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      insertTask({ id: taskId, type, payload: payload ?? undefined });
      enqueueTask(taskId);
      return { taskId, type, status: 'enqueued' };
    },
  });

  registerTool({
    name: 'run_command',
    description: 'Run a single command (binary + args). Use for skills that document CLI usage (e.g. memo for Apple Notes, osascript): read the skill doc, then run the commands it describes.',
    profile: 'coding',
    parameters: {
      type: 'object',
      properties: {
        binary: { type: 'string', description: 'Executable name (e.g. osascript, memo, git, curl).' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments (e.g. ["notes", "-a", "buy saiko"] for memo).',
        },
      },
      required: ['binary', 'args'],
    },
    execute: (args) => {
        const binary = String(args.binary || '').trim();
        if (!binary) return { error: 'binary is required' };
        const rawArgs = Array.isArray(args.args) ? args.args : [];
        let argsList = rawArgs.map((a) => String(a).replace(/\0/g, '').trim()).filter((_, i) => i < 50);
        const portalGatewayBase = getPortalGatewayBase();
        // Resolve portal gateway URLs for curl: .../connections/conn_xxx/use, .../bsky-request, .../youtube-upload
        if (binary === 'curl' && portalGatewayBase && argsList.length > 0) {
          const argsStr = argsList.join(' ');
          const useMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/use/);
          const bskyMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/bsky-request/);
          const ytUploadMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/youtube-upload/);
          const pathMatch = useMatch || bskyMatch || ytUploadMatch;
          const pathSuffix = useMatch ? '/use' : bskyMatch ? '/bsky-request' : ytUploadMatch ? '/youtube-upload' : '';
          if (pathMatch) {
            const path = `/connections/${pathMatch[1]}${pathSuffix}`;
            const resolved = portalGatewayBase.replace(/\/$/, '') + path;
            const postIdx = argsList.indexOf('POST');
            const urlIdx =
              postIdx >= 0
                ? postIdx + 1
                : argsList.findIndex((a) => a.includes('/connections/') && (a.includes('/use') || a.includes('/bsky-request') || a.includes('/youtube-upload')));
            if (urlIdx >= 0 && urlIdx < argsList.length) {
              const urlArg = argsList[urlIdx];
              const isBroken =
                urlArg.includes('$') ||
                !urlArg.startsWith('http') ||
                (() => {
                  try {
                    const u = new URL(urlArg);
                    return !u.hostname || u.hostname.includes('$');
                  } catch {
                    return true;
                  }
                })();
              if (isBroken || urlArg !== resolved) {
                console.log('agent', 'info', 'run_command: resolved portal URL for curl', {
                  host: new URL(resolved).hostname,
                  path: pathSuffix,
                });
                argsList = [...argsList.slice(0, urlIdx), resolved, ...argsList.slice(urlIdx + 1)];
                if (argsList[urlIdx + 1] === path) {
                  argsList = [...argsList.slice(0, urlIdx + 1), ...argsList.slice(urlIdx + 2)];
                }
              }
            }
          }
        }
        if (binary === 'curl') {
          const allowedHosts = (process.env.ALLOWED_CURL_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
          if (allowedHosts.length > 0) {
            const urls = argsList.join(' ').match(/https?:\/\/[^/\s"'<>]+/g) || [];
            for (const u of urls) {
              try {
                const host = new URL(u).hostname.toLowerCase();
                const allowed = allowedHosts.some((h) => host === h || host.endsWith('.' + h));
                if (!allowed) return { error: `curl URL host not allowed: ${host} (ALLOWED_CURL_HOSTS)` };
              } catch {
                // skip malformed URL
              }
            }
          }
        }
        try {
          const skillEnv = getSkillConfigEnv();
          const env = { ...process.env, ...skillEnv };
          if (process.env.DEBUG || process.env.SULALA_LOG_SKILL_ENV) {
            const keys = Object.keys(skillEnv).sort();
            const summary = keys.map((k) => {
              const v = skillEnv[k];
              const len = typeof v === 'string' ? v.length : 0;
              return `${k} (${len > 0 ? `${len} chars` : 'empty'})`;
            });
            console.log('agent', 'info', `run_command skill env: ${redactSecretKeysInSummary(summary).join(', ')}`, { binary, keyCount: keys.length });
          }
          const result = spawnSync(binary, argsList, { encoding: 'utf8', timeout: 30000, env });
          if (result.error) return { error: result.error.message };
          // Log token request result so we can confirm gateway returned accessToken (do not log the token)
          if (binary === 'curl' && argsList.length > 0) {
            const argsStr = argsList.join(' ');
            const tokenUseMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/use/);
            if (tokenUseMatch) {
              const stdout = result.stdout ?? '';
              const gotToken = stdout.includes('accessToken') && !stdout.trimStart().startsWith('{"error"');
              console.log('agent', 'info', 'run_command: token request (POST .../connections/<id>/use) result', {
                connection_id: tokenUseMatch[1],
                gotToken,
                exitCode: result.status ?? null,
              });
            }
          }
          const out = {
            status: result.status ?? null,
            stdout: result.stdout?.trim() ?? '',
            stderr: result.stderr?.trim() ?? '',
          };
          // When agent calls Gmail/Calendar/Google API without token, 401 is returned. Add a hint so the model retries with token-first flow.
          if (binary === 'curl' && argsList.length > 0) {
            const argsStr = argsList.join(' ');
            const stdout = result.stdout ?? '';
            const isGoogleApi =
              argsStr.includes('gmail.googleapis.com') || argsStr.includes('www.googleapis.com') || argsStr.includes('sheets.googleapis.com');
            const is401 = stdout.includes('401') && (stdout.includes('invalid authentication') || stdout.includes('invalid credentials'));
            if (isGoogleApi && is401) {
              (out as Record<string, unknown>)._hint =
                'Gmail/Calendar/Google API returned 401. Use the skill\'s own OAuth (e.g. Gmail skill with GMAIL_REFRESH_TOKEN) or MCP; get a token and call the API with Authorization: Bearer <token>.';
            }
          }
          return out;
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
  });

  if (config.agentWorkspaceRoot || config.workspaceDir) {
    const workspaceRoot = config.agentWorkspaceRoot ? resolve(process.cwd(), config.agentWorkspaceRoot) : null;
    const workspaceDirResolved = config.workspaceDir ? resolve(config.workspaceDir) : null;
    const workspaceSkillsDir = config.skillsWorkspaceDir ? resolve(config.skillsWorkspaceDir) : null;
    const workspaceSkillsMyDir = config.skillsWorkspaceMyDir ? resolve(config.skillsWorkspaceMyDir) : null;
    const sulalaHomeDir = config.workspaceDir ? resolve(config.workspaceDir, '..') : null;
    const mcpServersDir = join(homedir(), '.sulala', 'mcp-servers');
    const allowedReadRoots = [workspaceRoot, workspaceDirResolved, workspaceSkillsDir, workspaceSkillsMyDir, sulalaHomeDir, mcpServersDir].filter(Boolean) as string[];
    const defaultRoot = workspaceRoot ?? workspaceDirResolved ?? process.cwd();
    registerTool({
      name: 'read_file',
      description: 'Read the contents of a file. Path is relative to the workspace root, or absolute (e.g. user workspace dir for scripts/.env/automations).',
      profile: 'coding',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path: relative to workspace (e.g. README.md) or absolute (e.g. ~/.sulala/workspace/scripts/foo.sh)' },
        },
        required: ['path'],
      },
      execute: (args) => {
        const rawPath = (args.path as string) || '';
        if (!rawPath.trim()) return { error: 'path is required' };
        let trimmed = rawPath.trim();
        if (trimmed.startsWith('~/') || trimmed.startsWith('～/')) trimmed = join(homedir(), trimmed.slice(2));
        else if (trimmed === '~' || trimmed === '～') trimmed = homedir();
        const requested = trimmed.startsWith('/') ? resolve(trimmed) : resolve(defaultRoot, trimmed);
        const insideAllowed = allowedReadRoots.some(
          (root) => requested === root || relative(root, requested).startsWith('..') === false
        );
        if (!insideAllowed) {
          return { error: 'path must be inside the workspace, workspace dir (scripts/.env), skills dir, or ~/.sulala (read-only)' };
        }
        if (!existsSync(requested)) return { error: `file not found: ${trimmed}` };
        try {
          const content = readFileSync(requested, 'utf8');
          return { path: trimmed, content };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    });
    const allowedWriteRoots = [workspaceRoot, workspaceDirResolved, workspaceSkillsDir, workspaceSkillsMyDir, mcpServersDir].filter(Boolean) as string[];
    registerTool({
      name: 'write_file',
      description: 'Write content to a file. Use for: workspace scripts (workspace/scripts/), .env (workspace/.env), skills (workspace/skills/my/<slug>/), or AI-generated MCP servers under ~/.sulala/mcp-servers/<name>/ (package.json, index.ts). Path can be relative to workspace root or absolute.',
      profile: 'coding',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path: relative to workspace (e.g. out.txt) or absolute (e.g. workspace/scripts/watch_bluesky.sh or workspace/.env)' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      execute: (args) => {
        const rawPath = (args.path as string) || '';
        const content = args.content;
        if (!rawPath.trim()) return { error: 'path is required' };
        if (content === undefined || content === null) return { error: 'content is required' };
        let trimmed = rawPath.trim();
        if (trimmed.startsWith('~/') || trimmed.startsWith('～/')) trimmed = join(homedir(), trimmed.slice(2));
        else if (trimmed === '~' || trimmed === '～') trimmed = homedir();
        const requested = trimmed.startsWith('/') ? resolve(trimmed) : resolve(defaultRoot, trimmed);
        const insideAllowed = allowedWriteRoots.some(
          (root) => requested === root || relative(root, requested).startsWith('..') === false
        );
        if (!insideAllowed) {
          return { error: 'path must be inside the workspace, workspace dir (scripts/.env), skills dir, or ~/.sulala/mcp-servers/' };
        }
        try {
          const dir = dirname(requested);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(requested, typeof content === 'string' ? content : String(content), 'utf8');
          const ext = requested.toLowerCase().slice(requested.lastIndexOf('.'));
          if (['.sh', '.bash', '.py'].includes(ext)) {
            try {
              chmodSync(requested, 0o755);
            } catch {
              // ignore chmod errors
            }
          }
          return { path: trimmed, written: true };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    });
  }

  if (config.workspaceDir) {
    registerTool({
      name: 'register_automation',
      description:
        'Register a watch-folder automation so the agent runs a script when files are added. Use after creating a script in workspace/scripts/ and (optionally) storing credentials in workspace/.env. Script is run with the file path as first argument and env loaded from workspace/.env. Adds the watch folder to the agent config so file events are emitted.',
      profile: 'coding',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique id for this automation (e.g. watch_bluesky)' },
          script: { type: 'string', description: 'Path to script under workspace, e.g. scripts/watch_bluesky.sh' },
          watch_folders: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute paths of folders to watch (e.g. ["/Users/me/Desktop/bluesky"])',
          },
          filter: { type: 'string', description: 'Optional: "image" to run only for image files (jpg,png,gif,webp); omit for all files' },
        },
        required: ['id', 'script', 'watch_folders'],
      },
      execute: (args) => {
        const id = String(args.id ?? '').trim();
        const script = String(args.script ?? '').trim();
        const watchFolders = Array.isArray(args.watch_folders)
          ? (args.watch_folders as string[]).map((s) => String(s).trim()).filter(Boolean)
          : [];
        const filter = typeof args.filter === 'string' ? args.filter.trim() : undefined;
        if (!id) return { error: 'id is required' };
        if (!script) return { error: 'script is required' };
        if (!watchFolders.length) return { error: 'watch_folders must be a non-empty array' };
        const workspaceDirResolved = resolve(config.workspaceDir);
        const automationsPath = join(workspaceDirResolved, 'automations.json');
        let automations: { automations?: Array<{ id: string; script: string; watch_folders: string[]; filter?: string }> } = {};
        if (existsSync(automationsPath)) {
          try {
            automations = JSON.parse(readFileSync(automationsPath, 'utf8')) as typeof automations;
          } catch {
            return { error: 'Could not read existing automations.json' };
          }
        }
        const list = Array.isArray(automations.automations) ? automations.automations : [];
        const existing = list.findIndex((a) => a.id === id);
        const entry = { id, script, watch_folders: watchFolders, filter };
        if (existing >= 0) list[existing] = entry;
        else list.push(entry);
        automations.automations = list;
        try {
          mkdirSync(workspaceDirResolved, { recursive: true });
          writeFileSync(automationsPath, JSON.stringify(automations, null, 2), 'utf8');
        } catch (e) {
          return { error: (e as Error).message };
        }
        addWatchPaths(watchFolders);
        return { written: true, automation: entry };
      },
    });
  }

  registerTool({
    name: 'write_memory',
    description:
      'Store a durable note the agent can recall later. Use for user preferences, decisions, or facts the user asked to remember. Session memory is for this conversation only; shared memory persists across sessions (e.g. per user).',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or note to remember (concise)' },
        scope: {
          type: 'string',
          enum: ['session', 'shared'],
          description: 'session = this conversation only; shared = across sessions for this identity (default: session)',
        },
      },
      required: ['content'],
    },
    execute: (args, context) => {
      const sessionId = context?.sessionId;
      if (!sessionId) return { error: 'Memory tools require an active session' };
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      if (!content) return { error: 'content is required' };
      const scope = (args.scope === 'shared' ? 'shared' : 'session') as 'session' | 'shared';
      const scopeKey = scope === 'session' ? sessionId : getSharedScopeKeyForSession(sessionId) ?? sessionId;
      const row = appendMemory(scope, scopeKey, content);
      return { ok: true, id: row.id, scope, message: 'Stored in memory.' };
    },
  });

  registerTool({
    name: 'read_memory',
    description:
      'Recall stored memory. Use when the user asks what you remember or to list recent notes. Session = this conversation; shared = across sessions.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['session', 'shared'],
          description: 'session = this conversation only; shared = across sessions (default: session)',
        },
        limit: { type: 'number', description: 'Max number of entries to return (default 20)' },
      },
    },
    execute: (args, context) => {
      const sessionId = context?.sessionId;
      if (!sessionId) return { error: 'Memory tools require an active session' };
      const scope = (args.scope === 'shared' ? 'shared' : 'session') as 'session' | 'shared';
      const scopeKey = scope === 'session' ? sessionId : getSharedScopeKeyForSession(sessionId) ?? sessionId;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20;
      const entries = listMemories(scope, scopeKey, limit);
      const text = entries.length
        ? entries.map((e) => `[${e.id}] ${e.content}`).join('\n')
        : 'No stored memory for this scope.';
      return { entries, text };
    },
  });

  registerTool({
    name: 'run_agent',
    description: 'Run a sub-agent in a separate session: create or reuse a session by key, send a message, and get the final response. Use for delegated research or a one-off task in isolation. Do not call run_agent from within another run_agent.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        session_key: { type: 'string', description: 'Optional session key (e.g. research-1). If omitted, a unique key is generated.' },
        message: { type: 'string', description: 'User message to send to the sub-agent' },
        timeout_ms: { type: 'number', description: 'Optional max run time in ms (default 60000)' },
      },
      required: ['message'],
    },
    execute: async (args) => {
      if (agentRunDepth >= 2) {
        return { error: 'run_agent cannot be nested (only one level of sub-agent allowed)' };
      }
      const message = (args.message as string) || '';
      if (!message.trim()) return { error: 'message is required' };
      const sessionKey = (args.session_key as string)?.trim() || `child_${Date.now()}`;
      const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 60000;
      try {
        const session = getOrCreateAgentSession(sessionKey);
        const result = await runAgentTurn({
          sessionId: session.id,
          userMessage: message,
          timeoutMs,
        });
        return {
          sessionId: result.sessionId,
          session_key: sessionKey,
          finalContent: result.finalContent,
          turnCount: result.turnCount,
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Create a scheduled job from a natural-language description. Use when the user confirms they want to create a job (after you suggested it). */
  registerTool({
    name: 'create_scheduled_job',
    description:
      'Create a scheduled job from a short natural-language description. Use ONLY after the user has agreed to create a job (e.g. said "yes", "please do", "create it"). The description should include what to do and when (e.g. "Fetch daily news and post one to Bluesky every morning at 9", "Send me weather every weekday at 8 AM"). Do not use for one-off tasks—only for recurring/scheduled automation.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural-language description of the job including the schedule (e.g. "Post a tip to Bluesky every 12 hours", "Remind me to backup every Monday at 9 AM").',
        },
      },
      required: ['description'],
    },
    execute: async (args) => {
      const description = typeof args.description === 'string' ? args.description.trim() : '';
      if (!description) return { error: 'description is required' };
      try {
        const parsed = await parseJobFromMessage(description);
        const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const delivery = [{ channel: 'telegram', target: 'default' }];
        insertScheduledJob({
          id,
          name: parsed.name,
          cron_expression: parsed.cron_expression,
          task_type: 'agent_job',
          prompt: parsed.prompt,
          delivery: JSON.stringify(delivery),
          enabled: 1,
        });
        const agentPayload = {
          jobId: id,
          name: parsed.name,
          prompt: parsed.prompt,
          delivery,
        };
        scheduleCronById(id, parsed.cron_expression, 'agent_job', agentPayload);
        const row = getScheduledJob(id);
        const telegramConfig = getEffectiveTelegramConfig();
        const telegramConfigured = !!telegramConfig.botToken?.trim();
        let message = `Created scheduled job "${parsed.name}". It will run on schedule; the user can see it in Dashboard → Jobs.`;
        if (!telegramConfigured) {
          message += ' To receive notifications when the job runs, ask the user to set up the Telegram channel in Settings → Channels.';
        }
        return {
          ok: true,
          jobId: id,
          name: row?.name ?? parsed.name,
          prompt: parsed.prompt,
          schedule: parsed.cron_expression,
          message,
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  // Register YAML spec tools; first-wins so ~/.sulala/workspace/skills (e.g. stripe) overrides ./context
  lastSpecToolNames = registerSpecTools(
    (tool) => {
      if (!registry.has(tool.name)) registerTool(tool);
    },
    config,
  );
}
