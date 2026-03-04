/**
 * Stripe channel config: secret key for agent tools (customers, invoices).
 * Config can be set from env or from the dashboard (stored in DB); DB overrides env.
 */
import { config } from '../config.js';
import { getChannelConfig, setChannelConfig } from '../db/index.js';

const CHANNEL_KEY = 'stripe';

export type StripeChannelState = {
  configured: boolean;
};

function parseStripeConfig(raw: string | null): { secretKey: string | null } | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const secretKey = typeof o.secretKey === 'string' ? o.secretKey.trim() || null : null;
    return { secretKey };
  } catch {
    return null;
  }
}

/** Effective key: DB overrides env. Used by agent Stripe tools. */
export function getEffectiveStripeSecretKey(): string | null {
  const fromDb = parseStripeConfig(getChannelConfig(CHANNEL_KEY));
  if (fromDb?.secretKey) return fromDb.secretKey;
  return config.stripeSecretKey;
}

/** State for API (no key). */
export function getStripeChannelState(): StripeChannelState {
  const key = getEffectiveStripeSecretKey();
  return { configured: !!key?.trim() };
}

/** Save config to DB. Validate key with Stripe API. */
export async function setStripeChannelConfig(body: {
  secretKey?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const current = parseStripeConfig(getChannelConfig(CHANNEL_KEY));
  const secretKey =
    body.secretKey !== undefined ? (body.secretKey?.trim() || null) : (current?.secretKey ?? null);

  if (secretKey) {
    try {
      const res = await fetch('https://api.stripe.com/v1/customers?limit=1', {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (res.status === 401) {
        return { ok: false, error: 'Invalid Stripe secret key (unauthorized)' };
      }
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        return { ok: false, error: `Stripe API error: ${res.status} ${text.slice(0, 80)}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid key or network error: ${msg}` };
    }
  }

  const next = { secretKey };
  setChannelConfig(CHANNEL_KEY, JSON.stringify(next));
  return { ok: true };
}
