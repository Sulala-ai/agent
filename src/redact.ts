/**
 * Redact secrets so they are never logged or sent to clients.
 * Use when returning skills config from API or when logging objects that may contain secrets.
 */

const SECRET_KEY_PATTERN = /^(apiKey|.*(?:PASSWORD|SECRET|KEY|TOKEN).*)$/i;

/** True if a key name is considered secret and should not be exposed. */
export function isSecretKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key === 'enabled' || key === 'allowedTools' || key === 'readOnly') return false;
  return SECRET_KEY_PATTERN.test(key);
}

/** Redact a skill entry for API: secret values become "set" or "unset". */
export function redactSkillEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (isSecretKey(key)) {
      const str = typeof value === 'string' ? value.trim() : '';
      out[key] = str.length > 0 ? 'set' : 'unset';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Redact full skills config for API responses (entries only; configPath unchanged). */
export function redactSkillsConfig(cfg: { entries?: Record<string, Record<string, unknown>> }): typeof cfg {
  if (!cfg?.entries) return cfg;
  const redacted: Record<string, Record<string, unknown>> = {};
  for (const [slug, entry] of Object.entries(cfg.entries)) {
    if (entry && typeof entry === 'object') {
      redacted[slug] = redactSkillEntry(entry) as Record<string, unknown>;
    } else {
      redacted[slug] = entry;
    }
  }
  return { ...cfg, entries: redacted };
}

/** Redact for logging: replace secret key names with "***" in a string summary. */
export function redactSecretKeysInSummary(summary: string[]): string[] {
  return summary.map((s) => {
    const m = s.match(/^([^\s(]+)\s*(\(.*\))?$/);
    if (!m) return s;
    const keyPart = m[1];
    const rest = m[2] ?? '';
    if (isSecretKey(keyPart)) return `***${rest}`;
    return s;
  });
}
