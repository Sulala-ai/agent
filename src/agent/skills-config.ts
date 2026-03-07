/**
 * Skills config: single JSON file, no DB.
 * Path: SULALA_CONFIG_PATH > .sulala/config.json in cwd (if exists) > ~/.sulala/config.json.
 * Read: loadFullConfig/loadSkillsConfig from that path; cache invalidated on file mtime change.
 * Write: saveFullConfig/saveSkillsConfig to the same path.
 * See docs/config.md for full resolution and read/write flow.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { cwd } from 'process';

export type SkillEntry = {
  enabled?: boolean;
  handle?: string;
  apiKey?: string;
  /** Per-skill tool allowlist; when set, only these tools are allowed for this skill (used when skillSlug is passed to listTools/executeTool). */
  allowedTools?: string[];
  /** When true, only read-only tools are allowed for this skill (e.g. read_file, not write_file or run_command). */
  readOnly?: boolean;
  [key: string]: unknown;
};

export type SkillsConfig = {
  entries?: Record<string, SkillEntry>;
};

export type SulalaConfig = {
  skills?: SkillsConfig;
  /** Binaries allowed for run_command; merged with ALLOWED_BINARIES env. */
  allowedBinaries?: string[];
  [key: string]: unknown;
};

let cached: SkillsConfig | null | undefined = undefined;
let cachedPath: string | null = null;
let cachedMtime: number = 0;

/** Expand leading ~ to homedir; .env is loaded as-is so ~ is not expanded by the shell. */
function expandTilde(path: string): string {
  const s = path.trim();
  if (s === '~') return homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2));
  return path;
}

/** Config path: SULALA_CONFIG_PATH > .sulala/config.json in cwd (if exists) > ~/.sulala/config.json */
export function getConfigPath(): string {
  const fromEnv = process.env.SULALA_CONFIG_PATH;
  if (fromEnv?.trim()) return expandTilde(fromEnv.trim());
  const workspaceConfig = join(cwd(), '.sulala', 'config.json');
  if (existsSync(workspaceConfig)) return workspaceConfig;
  return join(homedir(), '.sulala', 'config.json');
}

function getConfigMtime(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadFullConfig(): SulalaConfig {
  try {
    const path = getConfigPath();
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{}', 'utf8');
      return {};
    }
    return JSON.parse(readFileSync(path, 'utf8')) as SulalaConfig;
  } catch {
    return {};
  }
}

export function saveFullConfig(data: SulalaConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  cached = undefined;
}

export function loadSkillsConfig(): SkillsConfig {
  const path = getConfigPath();
  const mtime = getConfigMtime(path);
  if (cached !== undefined && cachedPath === path && cachedMtime === mtime) {
    return cached ?? {};
  }
  cachedPath = path;
  cachedMtime = mtime;
  try {
    const data = loadFullConfig();
    cached = data.skills ?? {};
    return cached ?? {};
  } catch {
    cached = {};
    return {};
  }
}

/** When client sends "set" for a secret key it means "keep existing"; "unset" means clear. */
function mergeSkillEntry(existing: SkillEntry, incoming: SkillEntry): SkillEntry {
  const out: SkillEntry = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === 'set') {
      if (existing[key] !== undefined && existing[key] !== '') continue;
    }
    if (value === 'unset') {
      delete out[key];
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function saveSkillsConfig(cfg: SkillsConfig): void {
  const full = loadFullConfig();
  const existingEntries = full.skills?.entries ?? {};
  const incomingEntries = cfg.entries ?? {};
  const mergedEntries: Record<string, SkillEntry> = { ...existingEntries };
  for (const [name, entry] of Object.entries(incomingEntries)) {
    const existing = existingEntries[name] ?? {};
    const incoming = entry && typeof entry === 'object' ? entry : {};
    mergedEntries[name] = mergeSkillEntry(existing as SkillEntry, incoming as SkillEntry);
  }
  full.skills = { ...full.skills, entries: mergedEntries };
  saveFullConfig(full);
  cached = full.skills;
}

/** Config keys are slugs (filename without .md). */
export function isSkillEnabled(slug: string): boolean {
  const cfg = loadSkillsConfig();
  const entry = cfg.entries?.[slug];
  if (!entry) return true;
  return entry.enabled !== false;
}

export function setSkillEnabled(slug: string, enabled: boolean): void {
  const cfg = loadSkillsConfig();
  if (!cfg.entries) cfg.entries = {};
  if (!cfg.entries[slug]) cfg.entries[slug] = {};
  cfg.entries[slug]!.enabled = enabled;
  saveSkillsConfig(cfg);
}

/** Remove a skill's config entry entirely (clears override; skill reverts to default enabled). */
export function removeSkillEntry(slug: string): void {
  const full = loadFullConfig();
  const entries = full.skills?.entries;
  if (!entries || !(slug in entries)) return;
  const next = { ...entries };
  delete next[slug];
  full.skills = { ...full.skills, entries: next };
  saveFullConfig(full);
  cached = full.skills;
}

/** Migrate config entries from name keys to slug keys (one-time for existing installs). */
export function migrateConfigNameKeysToSlug(
  nameToSlug: Array<{ name: string; slug: string }>
): void {
  const full = loadFullConfig();
  const entries = full.skills?.entries;
  if (!entries) return;
  let changed = false;
  const next = { ...entries };
  for (const { name, slug } of nameToSlug) {
    if (name !== slug && name in next && !(slug in next)) {
      next[slug] = next[name] as SkillEntry;
      delete next[name];
      changed = true;
    }
  }
  if (changed) {
    full.skills = { ...full.skills, entries: next };
    saveFullConfig(full);
    cached = full.skills;
  }
}

/** Whether the config file is empty (missing, or parses to {} / no onboarding state). Empty config = onboarding not finished. */
function isConfigEmpty(full: SulalaConfig): boolean {
  if (full.onboardingComplete === true || full.onboardingComplete === false) return false;
  const keys = Object.keys(full);
  if (keys.length === 0) return true;
  if (keys.length === 1 && full.skills) {
    const entryKeys = Object.keys(full.skills.entries ?? {});
    if (entryKeys.length === 0) return true;
  }
  return false;
}

/** Onboarding: persisted in config for first-launch detection. When .sulala/config is empty (or missing), onboarding is not finished → show onboarding. */
export function getOnboardingComplete(): boolean {
  const full = loadFullConfig();
  if (full.onboardingComplete === true) return true;
  // Explicit reset: set to false in config to see onboarding again
  if (full.onboardingComplete === false) return false;
  // Empty config (no onboardingComplete, no meaningful content) = onboarding not finished → show onboarding
  if (isConfigEmpty(full)) {
    // Migration: existing users with at least one AI provider key in ~/.sulala/.env are considered onboarded.
    // Do not treat default .env (PORT, HOST, DB_PATH only) as complete — they must have set an API key.
    const AI_KEYS_FOR_MIGRATION = new Set([
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_GEMINI_API_KEY',
      'GEMINI_API_KEY',
    ]);
    const envPath = join(homedir(), '.sulala', '.env');
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf8');
        const hasAiKey = content.split('\n').some((line) => {
          const t = line.trim();
          if (!t || t.startsWith('#')) return false;
          const eq = t.indexOf('=');
          if (eq <= 0) return false;
          const key = t.slice(0, eq).trim();
          const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          return AI_KEYS_FOR_MIGRATION.has(key) && value.length > 0;
        });
        if (hasAiKey) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }
  // Config has other content but no onboardingComplete: still not complete
  return false;
}

export function setOnboardingComplete(complete: boolean): void {
  const full = loadFullConfig();
  full.onboardingComplete = complete;
  saveFullConfig(full);
}

/** Per-skill tool policy for listTools/executeTool when skillSlug is provided. */
export function getSkillToolPolicy(slug: string): { allowlist: string[] | null; readOnly: boolean } {
  const cfg = loadSkillsConfig();
  const entry = cfg.entries?.[slug];
  if (!entry || typeof entry !== 'object') return { allowlist: null, readOnly: false };
  const allowedTools = entry.allowedTools;
  const allowlist = Array.isArray(allowedTools) && allowedTools.length > 0
    ? allowedTools.map((s) => String(s).trim()).filter(Boolean)
    : null;
  const readOnly = entry.readOnly === true;
  return { allowlist, readOnly };
}

/** Build env vars for run_command from ~/.sulala/config.json (or SULALA_CONFIG_PATH) under skills.entries.<slug> (e.g. gmail.PORTAL_API_KEY). */
export function getSkillConfigEnv(): Record<string, string> {
  const cfg = loadSkillsConfig();
  const out: Record<string, string> = {};
  for (const entry of Object.values(cfg.entries ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'enabled' || key === 'allowedTools' || key === 'readOnly') continue;
      if (typeof value === 'string' && value.trim()) out[key] = value;
    }
  }
  return out;
}
