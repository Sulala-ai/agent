import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { log } from '../db/index.js';
import type { ToolDef } from '../types.js';

export interface AgentPromptContext {
  systemPrompt: string;
  messageCount: number;
}

/** Context passed to plugin tool factories. */
export interface PluginToolContext {
  sessionId?: string;
  workspaceDir?: string;
}

export interface Plugin {
  onStart?(): Promise<void>;
  onStop?(): Promise<void>;
  onFileEvent?(payload: { event: string; path: string; ts: number }): void;
  onTask?(task: { id: string; type: string; payload: unknown }): Promise<boolean>;
  /** Return tools provided by this plugin; names must not clash with core or other plugins. */
  tools?(context: PluginToolContext): ToolDef[] | Promise<ToolDef[]>;
  /** Agent hooks */
  onAgentSessionStart?(sessionId: string): void | Promise<void>;
  onAgentSessionEnd?(sessionId: string): void | Promise<void>;
  onAgentBeforePromptBuild?(sessionId: string, context: AgentPromptContext): string | void | Promise<string | void>;
  onAgentBeforeToolCall?(sessionId: string, toolName: string, args: Record<string, unknown>): Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  onAgentAfterToolCall?(sessionId: string, toolName: string, args: Record<string, unknown>, result: unknown): void | Promise<void>;
  onAgentEnd?(sessionId: string, result: { finalContent: string; turnCount: number }): void | Promise<void>;
}

const plugins = new Map<string, Plugin>();
let pluginsDir = join(process.cwd(), 'plugins');

export function setPluginsDir(path: string): void {
  pluginsDir = path;
}

export function getPluginsDir(): string {
  return pluginsDir;
}

async function loadPlugin(name: string): Promise<Plugin | null> {
  const base = join(pluginsDir, name);
  const paths = [
    join(base, 'index.js'),
    join(base, 'index.mjs'),
    join(base + '.js'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href) as { default?: Plugin } & Plugin;
      return mod.default || mod;
    }
  }
  return null;
}

export async function loadAllPlugins(): Promise<string[]> {
  if (!existsSync(pluginsDir)) {
    log('plugins', 'info', 'No plugins directory', { path: pluginsDir });
    return [];
  }
  const entries = readdirSync(pluginsDir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isDirectory() || (e.isFile() && e.name.endsWith('.js')))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.js$/, '')));
  const loaded: string[] = [];
  for (const name of [...new Set(names)]) {
    try {
      const plugin = await loadPlugin(name);
      if (plugin) {
        plugins.set(name, plugin);
        if (typeof plugin.onStart === 'function') await plugin.onStart();
        loaded.push(name);
        log('plugins', 'info', `Loaded plugin: ${name}`);
      }
    } catch (e) {
      log('plugins', 'error', `Failed to load plugin ${name}: ${(e as Error).message}`, { stack: (e as Error).stack });
    }
  }
  return loaded;
}

export function onFileEvent(payload: { event: string; path: string; ts: number }): void {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onFileEvent === 'function') {
      try {
        plugin.onFileEvent(payload);
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onFileEvent: ${(e as Error).message}`);
      }
    }
  }
}

export async function onTask(task: { id: string; type: string; payload: unknown }): Promise<boolean> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onTask === 'function') {
      try {
        const handled = await plugin.onTask(task);
        if (handled) return true;
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onTask: ${(e as Error).message}`);
      }
    }
  }
  return false;
}

export async function stopAllPlugins(): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onStop === 'function') {
      try {
        await plugin.onStop();
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onStop: ${(e as Error).message}`);
      }
    }
  }
  plugins.clear();
}

/** Resolve all tools from plugins. Names must not clash with core. Called by listTools(). Sync only; Promise return is skipped. */
export function getPluginTools(context: PluginToolContext): ToolDef[] {
  const out: ToolDef[] = [];
  const seen = new Set<string>();
  for (const [name, plugin] of plugins) {
    if (typeof plugin.tools !== 'function') continue;
    try {
      const result = plugin.tools(context);
      if (result instanceof Promise) {
        log('plugins', 'warn', `Plugin ${name} tools() returned Promise; sync return only for now`);
        continue;
      }
      const list = Array.isArray(result) ? result : result ? [result] : [];
      for (const t of list) {
        if (!t?.name) continue;
        const key = t.name.toLowerCase();
        if (seen.has(key)) {
          log('plugins', 'warn', `Plugin tool name conflict: ${t.name} (plugin ${name}), skipping`);
          continue;
        }
        seen.add(key);
        out.push(t);
      }
    } catch (e) {
      log('plugins', 'error', `Plugin ${name} tools(): ${(e as Error).message}`);
    }
  }
  return out;
}

// --- Agent hooks (run by agent loop) ---

export async function runAgentHooksSessionStart(sessionId: string): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentSessionStart === 'function') {
      try {
        await plugin.onAgentSessionStart(sessionId);
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentSessionStart: ${(e as Error).message}`);
      }
    }
  }
}

export async function runAgentHooksSessionEnd(sessionId: string): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentSessionEnd === 'function') {
      try {
        await plugin.onAgentSessionEnd(sessionId);
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentSessionEnd: ${(e as Error).message}`);
      }
    }
  }
}

export async function runAgentHooksBeforePromptBuild(
  sessionId: string,
  context: AgentPromptContext
): Promise<string | null> {
  let overridden: string | null = null;
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentBeforePromptBuild === 'function') {
      try {
        const out = await plugin.onAgentBeforePromptBuild(sessionId, context);
        if (typeof out === 'string') overridden = out;
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentBeforePromptBuild: ${(e as Error).message}`);
      }
    }
  }
  return overridden;
}

export async function runAgentHooksBeforeToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let current = args;
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentBeforeToolCall === 'function') {
      try {
        const out = await plugin.onAgentBeforeToolCall(sessionId, toolName, current);
        if (out && typeof out === 'object') current = { ...current, ...out };
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentBeforeToolCall: ${(e as Error).message}`);
      }
    }
  }
  return current;
}

export async function runAgentHooksAfterToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentAfterToolCall === 'function') {
      try {
        await plugin.onAgentAfterToolCall(sessionId, toolName, args, result);
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentAfterToolCall: ${(e as Error).message}`);
      }
    }
  }
}

export async function runAgentHooksAgentEnd(
  sessionId: string,
  result: { finalContent: string; turnCount: number }
): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (typeof plugin.onAgentEnd === 'function') {
      try {
        await plugin.onAgentEnd(sessionId, result);
      } catch (e) {
        log('plugins', 'error', `Plugin ${name} onAgentEnd: ${(e as Error).message}`);
      }
    }
  }
}
