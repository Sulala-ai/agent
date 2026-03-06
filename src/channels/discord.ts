/**
 * Discord channel config: bot token for agent tools (list guilds, list channels, send message).
 * Config can be set from env or from the dashboard (stored in DB); DB overrides env.
 */
import { config, getSulalaEnvKey } from '../config.js';
import { getChannelConfig, setChannelConfig } from '../db/index.js';

const CHANNEL_KEY = 'discord';

export type DiscordChannelState = {
  configured: boolean;
};

function parseDiscordConfig(raw: string | null): { botToken: string | null } | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const botToken = typeof o.botToken === 'string' ? o.botToken.trim() || null : null;
    return { botToken };
  } catch {
    return null;
  }
}

/** Effective token: DB overrides dashboard/env, then ~/.sulala/.env at request time. Used by agent Discord tools. */
export function getEffectiveDiscordBotToken(): string | null {
  const fromDb = parseDiscordConfig(getChannelConfig(CHANNEL_KEY));
  if (fromDb?.botToken) return fromDb.botToken;
  const fromFile = getSulalaEnvKey('DISCORD_BOT_TOKEN');
  if (fromFile?.trim()) return fromFile.trim();
  return config.discordBotToken;
}

/** State for API (no token). */
export function getDiscordChannelState(): DiscordChannelState {
  const token = getEffectiveDiscordBotToken();
  return { configured: !!token?.trim() };
}

/** Save config to DB. Optionally validate token with Discord API. */
export async function setDiscordChannelConfig(body: {
  botToken?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const current = parseDiscordConfig(getChannelConfig(CHANNEL_KEY));
  const botToken =
    body.botToken !== undefined ? (body.botToken?.trim() || null) : (current?.botToken ?? null);

  if (botToken) {
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `Invalid bot token: ${res.status} ${text.slice(0, 80)}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid bot token: ${msg}` };
    }
  }

  const next = { botToken };
  setChannelConfig(CHANNEL_KEY, JSON.stringify(next));
  return { ok: true };
}
