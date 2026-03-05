import 'dotenv/config';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
/** Use os.homedir() for cross-platform home (Unix: $HOME / Windows: USERPROFILE). */
import { homedir } from 'os';

function expandTilde(p: string | undefined): string | undefined {
  if (!p || typeof p !== 'string') return undefined;
  const t = p.trim();
  if (t === '~') return homedir();
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(homedir(), t.slice(2));
  if (t.startsWith('~' + join('', '/')) && t.length > 1) return join(homedir(), t.slice(2));
  return t || undefined;
}
import { fileURLToPath } from 'url';
import type { Config } from './types.js';

// Keys we load from ~/.sulala/.env at startup (same whitelist as onboard). Project .env wins (we only set if process.env[key] is unset).
const SULALA_ENV_LOAD_KEYS = [
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY',
  'OLLAMA_BASE_URL', 'AI_DEFAULT_PROVIDER', 'GATEWAY_API_KEY', 'PORTAL_GATEWAY_URL', 'PORTAL_API_KEY',
  'STORE_PUBLISH_API_KEY', 'ALLOWED_BINARIES', 'STRIPE_SECRET_KEY',
  'MCP_OAUTH_ENABLED', 'MCP_OAUTH_RESOURCE_URL', 'MCP_OAUTH_AUTHORIZATION_SERVER', 'MCP_OAUTH_SCOPES_SUPPORTED',
];
(function loadSulalaEnv() {
  const path = join(homedir(), '.sulala', '.env');
  if (!existsSync(path)) return;
  try {
    const content = readFileSync(path, 'utf8');
    const allow = new Set(SULALA_ENV_LOAD_KEYS);
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!allow.has(key) || process.env[key] !== undefined) continue;
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  } catch {
    // ignore
  }
})();

/** Path to ~/.sulala/.env used by onboard; gateway uses this for GET/PUT /api/onboard/env. */
export function getSulalaEnvPath(): string {
  return join(homedir(), '.sulala', '.env');
}

/** Get a key from process.env or ~/.sulala/.env (file wins only if process.env[key] is unset). Use at request time so keys saved via dashboard take effect without restart. */
export function getSulalaEnvKey(key: string): string | undefined {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const path = getSulalaEnvPath();
  if (!existsSync(path)) return undefined;
  try {
    const content = readFileSync(path, 'utf8');
    const allow = new Set(SULALA_ENV_LOAD_KEYS);
    if (!allow.has(key)) return undefined;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      if (k !== key) continue;
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '') || undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Path to ~/.sulala/secrets.json for future use (skill secrets, OAuth tokens). Not yet used; config stores secrets for now. */
export function getSulalaSecretsPath(): string {
  return join(homedir(), '.sulala', 'secrets.json');
}

/** Default Portal gateway URL (fixed, not user-configurable). */
export const DEFAULT_PORTAL_GATEWAY_URL = 'https://portal.sulala.ai/api/gateway';

/** Normalized portal gateway base URL. Uses PORTAL_GATEWAY_URL if set, otherwise DEFAULT_PORTAL_GATEWAY_URL. Read at call time so dashboard-saved value applies without restart. */
export function getPortalGatewayBase(): string | null {
  const url = (process.env.PORTAL_GATEWAY_URL || '').trim() || DEFAULT_PORTAL_GATEWAY_URL;
  const u = url.replace(/\/$/, '');
  if (/\/api\/gateway$/i.test(u)) return u;
  return `${u}/api/gateway`;
}

/** Portal API key: process.env first (dashboard-saved), then config. Use at call time so saving in Settings applies without restart. */
export function getEffectivePortalApiKey(): string | null {
  return (process.env.PORTAL_API_KEY || '').trim() || config.portalApiKey || null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

function loadWatchFolders(): string[] {
  const fromEnv = (process.env.WATCH_FOLDERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const configPath = join(projectRoot, 'config', 'watched.json');
  if (!existsSync(configPath)) return fromEnv;
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8')) as { folders?: string[] };
    const fromFile = Array.isArray(data.folders) ? data.folders : [];
    const combined = [...fromEnv];
    for (const p of fromFile) {
      const s = typeof p === 'string' ? p.trim() : '';
      if (s && !combined.includes(s)) combined.push(s);
    }
    return combined;
  } catch {
    return fromEnv;
  }
}

export type ScheduleEntry = { cron: string; type: string; payload?: unknown };

export function loadSchedulesConfig(): ScheduleEntry[] {
  const configPath = join(projectRoot, 'config', 'schedules.json');
  if (!existsSync(configPath)) return [];
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8')) as { schedules?: ScheduleEntry[] };
    const arr = Array.isArray(data.schedules) ? data.schedules : [];
    return arr.filter((e) => e && typeof e.cron === 'string' && typeof e.type === 'string');
  } catch {
    return [];
  }
}

function parseToolProfile(v: string | undefined): 'full' | 'messaging' | 'coding' | 'minimal' {
  if (v === 'messaging' || v === 'coding' || v === 'minimal') return v;
  return 'full';
}

export const config: Config = {
  port: parseInt(process.env.PORT || '2026', 10),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH || './data/sulala.db',
  watchFolders: loadWatchFolders(),
  debug: !!process.env.DEBUG,
  gatewayApiKey: process.env.GATEWAY_API_KEY || null,
  webhookUrls: (process.env.WEBHOOK_URL || process.env.WEBHOOK_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '0', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  agentSystemPrompt: process.env.AGENT_SYSTEM_PROMPT || null,
  agentTimeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS || '0', 10),
  agentContextPath: process.env.AGENT_CONTEXT_PATH || null,
  agentWorkspaceRoot: process.env.AGENT_WORKSPACE_ROOT || null,
  agentMaxHistoryMessages: parseInt(process.env.AGENT_MAX_HISTORY_MESSAGES || '0', 10),
  /** Max estimated tokens for history (messages + system). Older messages are dropped to stay under. Default 70000 leaves headroom under 128k (estimate is conservative). */
  agentMaxContextTokens: parseInt(process.env.AGENT_MAX_CONTEXT_TOKENS || '70000', 10),
  agentToolAllowlist: (process.env.AGENT_TOOL_ALLOWLIST || '')
    ? (process.env.AGENT_TOOL_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean)
    : null,
  agentToolProfile: parseToolProfile(process.env.AGENT_TOOL_PROFILE),
  agentToolRetryCount: parseInt(process.env.AGENT_TOOL_RETRY_COUNT || '2', 10) || 0,
  agentExecutionPreview: process.env.AGENT_EXECUTION_PREVIEW === '1' || process.env.AGENT_EXECUTION_PREVIEW === 'true',
  agentUsePi: process.env.AGENT_USE_PI !== '0' && process.env.AGENT_USE_PI !== 'false',
  agentSharedMemoryKey: (process.env.AGENT_SHARED_MEMORY_KEY || '').trim() || null,
  integrationsUrl: (process.env.INTEGRATIONS_URL || '').trim() || null,
  portalGatewayUrl: (process.env.PORTAL_GATEWAY_URL || '').trim() || null,
  portalApiKey: (process.env.PORTAL_API_KEY || '').trim() || null,
  discordBotToken: (process.env.DISCORD_BOT_TOKEN || '').trim() || null,
  stripeSecretKey: (process.env.STRIPE_SECRET_KEY || '').trim() || null,
  skillsBundledDir: join(projectRoot, 'context'),
  /** Workspace root: scripts, .env, automations.json. Env SULALA_WORKSPACE_DIR. */
  workspaceDir:
    process.env.SULALA_WORKSPACE_DIR ||
    join(homedir(), '.sulala', 'workspace'),
  /** User workspace skills; path is resolved from homedir() so it works on all OSes. ~ in env is expanded. */
  skillsWorkspaceDir:
    expandTilde(process.env.SULALA_WORKSPACE_SKILLS_DIR) ||
    join(homedir(), '.sulala', 'workspace', 'skills'),
  /** "Created by me" skills dir (default: skillsWorkspaceDir + '/my'). Env SULALA_WORKSPACE_SKILLS_MY_DIR. */
  skillsWorkspaceMyDir:
    expandTilde(process.env.SULALA_WORKSPACE_SKILLS_MY_DIR) ||
    join(
      expandTilde(process.env.SULALA_WORKSPACE_SKILLS_DIR) || join(homedir(), '.sulala', 'workspace', 'skills'),
      'my'
    ),
  skillsManagedDir:
    expandTilde(process.env.SULALA_SKILLS_DIR) || join(homedir(), '.sulala', 'skills'),
  skillsExtraDirs: (process.env.SKILLS_EXTRA_DIRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  skillsPluginDirs: loadPluginSkillDirs(),
  skillsWatch: process.env.SKILLS_WATCH !== '0',
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === '1' || process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    dmPolicy: (process.env.TELEGRAM_DM_POLICY || 'open') as 'open' | 'allowlist' | 'disabled',
    allowFrom: (process.env.TELEGRAM_ALLOW_FROM || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n)),
    defaultProvider: process.env.TELEGRAM_DEFAULT_PROVIDER || null,
    defaultModel: process.env.TELEGRAM_DEFAULT_MODEL || null,
  },
};

function loadPluginSkillDirs(): string[] {
  const pluginsDir = join(process.cwd(), 'plugins');
  if (!existsSync(pluginsDir)) return [];
  const dirs: string[] = [];
  try {
    for (const name of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const skillsPath = join(pluginsDir, name.name, 'skills');
      if (existsSync(skillsPath)) dirs.push(skillsPath);
    }
  } catch {
    // skip
  }
  return dirs;
}
