import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { resolve, relative, dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { insertTask, getOrCreateAgentSession } from '../db/index.js';
import { config, getPortalGatewayBase, getEffectivePortalApiKey } from '../config.js';
import { getEffectiveStripeSecretKey } from '../channels/stripe.js';
import { getEffectiveDiscordBotToken } from '../channels/discord.js';
import {
  appendMemory,
  listMemories,
  getSharedScopeKeyForSession,
} from './memory.js';
import { addWatchPaths } from '../watcher/index.js';
import { createPendingAction } from './pending-actions.js';
import { getAllRequiredBins } from './skills.js';
import { getSkillConfigEnv, getSkillToolPolicy } from './skills-config.js';
import { redactSecretKeysInSummary } from '../redact.js';
import { runAgentTurn } from './loop.js';
import { getPluginTools, type PluginToolContext } from '../plugins/index.js';
import type { ToolDef, ToolExecuteContext } from '../types.js';

const registry = new Map<string, ToolDef>();

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

export function getTool(name: string): ToolDef | undefined {
  return registry.get(name);
}

/** Tool names that perform writes; excluded when a skill has readOnly: true. */
const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'run_command',
  'register_automation',
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
    'list_integrations_connections',
    'get_connection_token',
    'bluesky_post',
    'write_memory',
    'read_memory',
  ]),
  coding: new Set([
    'run_task',
    'read_file',
    'write_file',
    'run_command',
    'list_integrations_connections',
    'get_connection_token',
    'bluesky_post',
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
    description: 'Enqueue a background task by type and optional payload. Use for scheduling work (e.g. heartbeat, file_event, or custom types).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type (e.g. heartbeat, file_event)' },
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

  if (process.env.ALLOW_SHELL_TOOL === '1') {
    const envBins = (process.env.ALLOWED_BINARIES || '')
      .split(',')
      .map((b) => b.trim().toLowerCase())
      .filter(Boolean);
    const skillBins = getAllRequiredBins(config);
    const allowed = [...new Set([...envBins, ...skillBins])];
    registerTool({
      name: 'run_command',
      description: 'Run a single command (binary + args). Only binaries in the ALLOWED_BINARIES list are permitted. Use for skills that document CLI usage (e.g. memo for Apple Notes): read the skill doc, then run the commands it describes.',
      profile: 'coding',
      parameters: {
        type: 'object',
        properties: {
          binary: { type: 'string', description: 'Executable name (e.g. memo, git). Must be in ALLOWED_BINARIES.' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments (e.g. ["notes", "-a", "buy saiko"] for memo).',
          },
        },
        required: ['binary', 'args'],
      },
      execute: (args) => {
        const binary = String(args.binary || '').trim().toLowerCase();
        if (!binary) return { error: 'binary is required' };
        if (allowed.length > 0 && !allowed.includes(binary)) {
          return { error: `binary "${binary}" is not in ALLOWED_BINARIES (allowed: ${allowed.join(', ')})` };
        }
        const rawArgs = Array.isArray(args.args) ? args.args : [];
        let argsList = rawArgs.map((a) => String(a).replace(/\0/g, '').trim()).filter((_, i) => i < 50);
        // Expand $PORTAL_GATEWAY_URL and $PORTAL_API_KEY in args (no shell in spawnSync, so LLM's $VAR stays literal and curl gets "Couldn't resolve host")
        const portalGatewayBase = getPortalGatewayBase() || process.env.PORTAL_GATEWAY_URL || '';
        const portalApiKey = getEffectivePortalApiKey() || process.env.PORTAL_API_KEY || '';
        if (portalGatewayBase || portalApiKey) {
          argsList = argsList.map((a) => {
            let s = a;
            if (portalGatewayBase && s.includes('$PORTAL_GATEWAY_URL')) s = s.replace(/\$PORTAL_GATEWAY_URL/g, portalGatewayBase);
            if (portalApiKey && s.includes('$PORTAL_API_KEY')) s = s.replace(/\$PORTAL_API_KEY/g, portalApiKey);
            return s;
          });
        }
        // Resolve portal gateway URLs for curl: .../connections/conn_xxx/use and .../connections/conn_xxx/bsky-request
        if (binary === 'curl' && portalGatewayBase && argsList.length > 0) {
          const argsStr = argsList.join(' ');
          const useMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/use/);
          const bskyMatch = argsStr.match(/\/connections\/(conn_[a-zA-Z0-9_]+)\/bsky-request/);
          const pathMatch = useMatch || bskyMatch;
          const pathSuffix = useMatch ? '/use' : bskyMatch ? '/bsky-request' : '';
          if (pathMatch) {
            const path = `/connections/${pathMatch[1]}${pathSuffix}`;
            const resolved = portalGatewayBase.replace(/\/$/, '') + path;
            const postIdx = argsList.indexOf('POST');
            const urlIdx =
              postIdx >= 0
                ? postIdx + 1
                : argsList.findIndex((a) => a.includes('/connections/') && (a.includes('/use') || a.includes('/bsky-request')));
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
                'Gmail/Calendar/Google API returned 401. Get an OAuth token first: call get_connection_token(connection_id) with the connection_id from list_integrations_connections, then call the Gmail/API URL again with -H "Authorization: Bearer <accessToken>" using the token from that result.';
            }
          }
          return out;
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    });
  }

  if (config.agentWorkspaceRoot || config.workspaceDir) {
    const workspaceRoot = config.agentWorkspaceRoot ? resolve(process.cwd(), config.agentWorkspaceRoot) : null;
    const workspaceDirResolved = config.workspaceDir ? resolve(config.workspaceDir) : null;
    const workspaceSkillsDir = config.skillsWorkspaceDir ? resolve(config.skillsWorkspaceDir) : null;
    const sulalaHomeDir = config.workspaceDir ? resolve(config.workspaceDir, '..') : null;
    const allowedReadRoots = [workspaceRoot, workspaceDirResolved, workspaceSkillsDir, sulalaHomeDir].filter(Boolean) as string[];
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
        const trimmed = rawPath.trim();
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
    const allowedWriteRoots = [workspaceRoot, workspaceDirResolved, workspaceSkillsDir].filter(Boolean) as string[];
    registerTool({
      name: 'write_file',
      description: 'Write content to a file. Use for scripts in workspace/scripts/, credentials in workspace/.env, or skills in workspace/skills/. Path can be relative to workspace root or absolute.',
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
        const trimmed = rawPath.trim();
        const requested = trimmed.startsWith('/') ? resolve(trimmed) : resolve(defaultRoot, trimmed);
        const insideAllowed = allowedWriteRoots.some(
          (root) => requested === root || relative(root, requested).startsWith('..') === false
        );
        if (!insideAllowed) {
          return { error: 'path must be inside the workspace, workspace dir (scripts/.env), or skills dir' };
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

  function filterByProvider(
    list: Array<{ connection_id?: string; id?: string; provider: string }>,
    provider: string | undefined,
  ): Array<{ connection_id: string; provider: string }> {
    if (!provider) return list.map((c) => ({ connection_id: c.connection_id ?? c.id ?? '', provider: c.provider }));
    const p = provider.toLowerCase();
    const filtered = list.filter((c) => (c.provider || '').toLowerCase() === p);
    return filtered.map((c) => ({ connection_id: c.connection_id ?? c.id ?? '', provider: c.provider }));
  }

  /** List OAuth connections so the agent can get connection_id for skills (run_command + curl). Use the exact provider for the integration you need (e.g. calendar, gmail, drive, github, slack). Stripe and Discord are not OAuth; do not use this for them—use stripe_list_customers and discord_* tools instead (they use Settings → Channels). */
  registerTool({
    name: 'list_integrations_connections',
    description:
      'List connected OAuth integrations only. Returns connection_id and provider for each. Use provider: "calendar", "gmail", "drive", "docs", "sheets", "slides", "github", "slack", "notion", "linear", "zoom", etc. Do not use for Stripe or Discord—those use API keys from Settings → Channels; use stripe_list_customers and discord_list_guilds / discord_send_message instead. Requires PORTAL_GATEWAY_URL + PORTAL_API_KEY or INTEGRATIONS_URL.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Exact provider to filter: "calendar", "gmail", "drive", "docs", "sheets", "slides", "github", "slack", "notion", "linear", "zoom", etc. Optional; omit to list all.',
        },
      },
      required: [],
    },
    execute: async (args) => {
      const portalGatewayBase = getPortalGatewayBase();
      const portalKey = getEffectivePortalApiKey();
      const provider = typeof args.provider === 'string' ? args.provider.trim() : undefined;

      if (portalGatewayBase && portalKey) {
        try {
          const res = await fetch(`${portalGatewayBase}/connections`, {
            headers: { Authorization: `Bearer ${portalKey}` },
          });
          if (!res.ok) return { error: `Portal gateway: ${res.status}` };
          const data = (await res.json()) as {
            connections?: Array<{ connection_id: string; provider: string }>;
          };
          const list = data.connections || [];
          const filtered = filterByProvider(list, provider);
          console.log('agent', 'info', 'list_integrations_connections: portal gateway', {
            provider: provider ?? '(all)',
            rawCount: list.length,
            filteredCount: filtered.length,
            connections: filtered.map((c) => ({ id: c.connection_id, provider: c.provider })),
          });
          return {
            connections: filtered.map((c) => ({ id: c.connection_id, provider: c.provider })),
            count: filtered.length,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }

      const base = config.integrationsUrl?.replace(/\/$/, '');
      if (!base) return { error: 'Set PORTAL_GATEWAY_URL + PORTAL_API_KEY (from Portal → API Keys) or INTEGRATIONS_URL' };
      const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
      try {
        const res = await fetch(`${base}/connections${q}`);
        if (!res.ok) return { error: `Integrations: ${res.status}` };
        const data = (await res.json()) as { connections?: Array<{ id: string; provider: string }> };
        const raw = (data.connections || []).map((c) => ({ connection_id: c.id, id: c.id, provider: c.provider }));
        const filtered = filterByProvider(raw, provider);
        console.log('agent', 'info', 'list_integrations_connections: integrations URL', {
          provider: provider ?? '(all)',
          rawCount: raw.length,
          filteredCount: filtered.length,
          connections: filtered.map((c) => ({ id: c.connection_id, provider: c.provider })),
        });
        return {
          connections: filtered.map((c) => ({ id: c.connection_id, provider: c.provider })),
          count: filtered.length,
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Get OAuth access token for a connection. Call this before calling Gmail/Calendar/Drive etc. APIs—the agent cannot reliably curl the portal from run_command; use this tool instead, then pass accessToken to run_command (curl) for the provider API. */
  registerTool({
    name: 'get_connection_token',
    description:
      'Get an OAuth access token for a connected integration. Call list_integrations_connections first to get connection_id, then call this with that connection_id. Returns accessToken to use in the next run_command (curl) as header: Authorization: Bearer <accessToken>. Required before any Gmail, Calendar, Drive, GitHub, Slack, etc. API call.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'string',
          description: 'Connection ID from list_integrations_connections (e.g. conn_gmail_..., conn_calendar_...).',
        },
      },
      required: ['connection_id'],
    },
    execute: async (args) => {
      const connectionId = typeof args.connection_id === 'string' ? args.connection_id.trim() : '';
      if (!connectionId) return { error: 'connection_id is required' };
      const portalGatewayBase = getPortalGatewayBase();
      const portalKey = getEffectivePortalApiKey();
      if (!portalGatewayBase || !portalKey) {
        return { error: 'Set PORTAL_GATEWAY_URL and PORTAL_API_KEY (from Portal → API Keys)' };
      }
      try {
        const url = `${portalGatewayBase.replace(/\/$/, '')}/connections/${encodeURIComponent(connectionId)}/use`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${portalKey}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return { error: `Portal gateway: ${res.status}`, detail: text.slice(0, 200) };
        }
        const data = (await res.json()) as {
          accessToken?: string;
          error?: string;
          provider?: string;
          useProxy?: boolean;
          blueskyDid?: string;
          connectionId?: string;
        };
        if (data.error) return { error: data.error };
        if (data.useProxy && data.provider === 'bluesky') {
          console.log('agent', 'info', 'get_connection_token: Bluesky proxy', { connection_id: connectionId });
          return {
            useProxy: true,
            connectionId: data.connectionId ?? connectionId,
            blueskyDid: data.blueskyDid,
            message: 'Use the bluesky_post tool with this connection_id and the post text to post. Do not use run_command (curl) for Bluesky.',
          };
        }
        if (!data.accessToken) {
          return { error: 'No accessToken in response' };
        }
        console.log('agent', 'info', 'get_connection_token: got token', { connection_id: connectionId });
        return { accessToken: data.accessToken };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Bluesky: post via Portal OAuth. Use this for posting; run_command (curl) often uses wrong URL/path. */
  registerTool({
    name: 'bluesky_post',
    description:
      'Post a message to Bluesky. Call list_integrations_connections with provider "bluesky" to get connection_id, then call this with that connection_id and the post text (max 300 characters).',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'Bluesky connection ID from list_integrations_connections (e.g. conn_bluesky_...).' },
        text: { type: 'string', description: 'Post text (max 300 characters).' },
      },
      required: ['connection_id', 'text'],
    },
    execute: async (args) => {
      const connectionId = typeof args.connection_id === 'string' ? args.connection_id.trim() : '';
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!connectionId) return { error: 'connection_id is required' };
      if (!text) return { error: 'text is required' };
      if (text.length > 300) return { error: 'Bluesky posts are limited to 300 characters' };
      const portalGatewayBase = getPortalGatewayBase();
      const portalKey = getEffectivePortalApiKey();
      if (!portalGatewayBase || !portalKey) return { error: 'Set PORTAL_GATEWAY_URL and PORTAL_API_KEY (from Portal → API Keys)' };
      const base = portalGatewayBase.replace(/\/$/, '');
      try {
        const useRes = await fetch(`${base}/connections/${encodeURIComponent(connectionId)}/use`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${portalKey}` },
        });
        if (!useRes.ok) {
          const t = await useRes.text();
          return { error: `Portal gateway use: ${useRes.status}`, detail: t.slice(0, 200) };
        }
        const useData = (await useRes.json()) as { useProxy?: boolean; blueskyDid?: string; error?: string };
        if (useData.error) return { error: useData.error };
        if (!useData.useProxy || !useData.blueskyDid) {
          return { error: 'Not a Bluesky connection or missing blueskyDid; reconnect Bluesky in the Portal.' };
        }
        const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
        const body = {
          path: '/xrpc/com.atproto.repo.createRecord',
          method: 'POST',
          body: {
            repo: useData.blueskyDid,
            collection: 'app.bsky.feed.post',
            record: { $type: 'app.bsky.feed.post', text, createdAt },
          },
        };
        const bskyRes = await fetch(`${base}/connections/${encodeURIComponent(connectionId)}/bsky-request`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${portalKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const resText = await bskyRes.text();
        if (!bskyRes.ok) return { error: `Bluesky request: ${bskyRes.status}`, detail: resText.slice(0, 300) };
        let parsed: { uri?: string; error?: string };
        try {
          parsed = JSON.parse(resText) as { uri?: string; error?: string };
        } catch {
          return { error: 'Invalid JSON from Bluesky', detail: resText.slice(0, 200) };
        }
        if (parsed.error) return { error: parsed.error };
        if (!parsed.uri) return { error: 'Post may have failed; response had no uri', detail: resText.slice(0, 200) };
        return { ok: true, uri: parsed.uri, message: 'Posted to Bluesky successfully.' };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Stripe: list customers using key from Settings → Channels (or STRIPE_SECRET_KEY). Do not use list_integrations_connections for Stripe. */
  registerTool({
    name: 'stripe_list_customers',
    description:
      'List Stripe customers. Uses the Stripe secret key from Settings → Channels (Stripe) or STRIPE_SECRET_KEY. Do not use list_integrations_connections for Stripe. Returns customers with id, email, name; or an error if Stripe is not configured.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max customers to return (default 10, max 100)' },
      },
      required: [],
    },
    execute: async (args) => {
      const key = getEffectiveStripeSecretKey();
      if (!key?.trim()) return { error: 'Stripe is not configured. Add a secret key in Settings → Channels (Stripe) or set STRIPE_SECRET_KEY.' };
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 100) : 10;
      try {
        const url = `https://api.stripe.com/v1/customers?limit=${limit}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
        if (res.status === 401) return { error: 'Invalid Stripe secret key (unauthorized)' };
        if (!res.ok) {
          const text = await res.text();
          return { error: `Stripe API: ${res.status}`, detail: text.slice(0, 200) };
        }
        const json = (await res.json()) as { data?: Array<{ id: string; email?: string; name?: string }> };
        const data = json.data ?? [];
        const customers = data.map((c) => ({ id: c.id, email: c.email, name: c.name }));
        return { customers, count: customers.length };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Discord: list guilds (servers) using bot token from Settings → Channels. Do not use list_integrations_connections for Discord. */
  registerTool({
    name: 'discord_list_guilds',
    description:
      'List Discord servers (guilds) the bot is in. Uses the bot token from Settings → Channels (Discord) or DISCORD_BOT_TOKEN. Do not use list_integrations_connections for Discord. Returns guilds with id and name; or an error if Discord is not configured.',
    profile: 'full',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const token = getEffectiveDiscordBotToken();
      if (!token?.trim()) return { error: 'Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.' };
      try {
        const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: { Authorization: `Bot ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return { error: `Discord API: ${res.status}`, detail: text.slice(0, 200) };
        }
        const list = (await res.json()) as Array<{ id: string; name: string }>;
        return { guilds: list.map((g) => ({ id: g.id, name: g.name })), count: list.length };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Discord: list channels in a guild. */
  registerTool({
    name: 'discord_list_channels',
    description:
      'List channels in a Discord server (guild). Uses the bot token from Settings → Channels. Call discord_list_guilds first to get guild_id. Returns channels with id, name, type (0=text, 2=voice, 4=category).',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        guild_id: { type: 'string', description: 'Discord guild (server) ID from discord_list_guilds' },
      },
      required: ['guild_id'],
    },
    execute: async (args) => {
      const token = getEffectiveDiscordBotToken();
      if (!token?.trim()) return { error: 'Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.' };
      const guildId = typeof args.guild_id === 'string' ? args.guild_id.trim() : '';
      if (!guildId) return { error: 'guild_id is required' };
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/channels`, {
          headers: { Authorization: `Bot ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return { error: `Discord API: ${res.status}`, detail: text.slice(0, 200) };
        }
        const list = (await res.json()) as Array<{ id: string; name: string; type: number }>;
        return { channels: list.map((c) => ({ id: c.id, name: c.name, type: c.type })), count: list.length };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  /** Discord: send a message to a channel. */
  registerTool({
    name: 'discord_send_message',
    description:
      'Send a message to a Discord channel. Uses the bot token from Settings → Channels. Call discord_list_guilds then discord_list_channels to get channel_id. Max content length 2000 characters.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Discord channel ID from discord_list_channels' },
        content: { type: 'string', description: 'Message text (max 2000 chars)' },
      },
      required: ['channel_id', 'content'],
    },
    execute: async (args) => {
      const token = getEffectiveDiscordBotToken();
      if (!token?.trim()) return { error: 'Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.' };
      const channelId = typeof args.channel_id === 'string' ? args.channel_id.trim() : '';
      let content = typeof args.content === 'string' ? args.content : '';
      if (!channelId) return { error: 'channel_id is required' };
      if (content.length > 2000) content = content.slice(0, 2000);
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const text = await res.text();
          return { error: `Discord API: ${res.status}`, detail: text.slice(0, 200) };
        }
        const data = (await res.json()) as { id: string };
        return { ok: true, message_id: data.id };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}
