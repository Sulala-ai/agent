/**
 * Read/write ~/.sulala/.env for onboard API keys (whitelist only).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getSulalaEnvPath } from './config.js';

export const ONBOARD_ENV_WHITELIST = [
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'OLLAMA_BASE_URL',
  'GATEWAY_API_KEY',
  'PORTAL_GATEWAY_URL',
  'PORTAL_API_KEY',
  'STORE_PUBLISH_API_KEY',
  'ALLOWED_BINARIES',
  'STRIPE_SECRET_KEY',
] as const;

export type OnboardEnvKey = (typeof ONBOARD_ENV_WHITELIST)[number];

/** Parse .env file into key=value map (only whitelisted keys). */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const set = new Set<string>(ONBOARD_ENV_WHITELIST);
  if (!existsSync(path)) return out;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!set.has(key as OnboardEnvKey)) continue;
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = value.replace(/^["']|["']$/g, '');
    out[key] = unquoted;
  }
  return out;
}

/** Which whitelisted keys are set (values never returned). */
export function readOnboardEnvKeys(): Record<string, 'set' | 'unset'> {
  const path = getSulalaEnvPath();
  const parsed = parseEnvFile(path);
  const result: Record<string, 'set' | 'unset'> = {};
  for (const k of ONBOARD_ENV_WHITELIST) {
    result[k] = parsed[k]?.trim() ? 'set' : 'unset';
  }
  return result;
}

/** Merge updates into ~/.sulala/.env (whitelist only); update process.env. */
export function writeOnboardEnvKeys(updates: Record<string, string>): void {
  const path = getSulalaEnvPath();
  const set = new Set<string>(ONBOARD_ENV_WHITELIST);
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (set.has(k as OnboardEnvKey) && typeof v === 'string') filtered[k] = v.trim();
  }
  if (Object.keys(filtered).length === 0) return;

  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const parsed = parseEnvFile(path);
  for (const [k, v] of Object.entries(filtered)) {
    parsed[k] = v;
    process.env[k] = v;
  }

  const lines: string[] = [];
  const written = new Set<string>();
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    if (trimmed.startsWith('#')) {
      lines.push(line);
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      lines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (set.has(key as OnboardEnvKey)) {
      written.add(key);
      if (key in parsed) lines.push(`${key}=${parsed[key]}`);
      continue;
    }
    lines.push(line);
  }
  for (const k of ONBOARD_ENV_WHITELIST) {
    if (k in parsed && !written.has(k)) lines.push(`${k}=${parsed[k]}`);
  }
  writeFileSync(path, lines.join('\n') + (lines.length && !lines[lines.length - 1] ? '' : '\n'), 'utf8');
}
