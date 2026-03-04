import { config } from './config.js';
import { log } from './db/index.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function postWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  eventType: string,
  attempt = 1
): Promise<void> {
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return postWithRetry(url, body, headers, eventType, attempt + 1);
    }
    if (!res.ok) log('webhook', 'warn', `Webhook ${url} returned ${res.status} after ${MAX_RETRIES} tries`, { eventType });
  } catch (err: unknown) {
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return postWithRetry(url, body, headers, eventType, attempt + 1);
    }
    log('webhook', 'error', `Webhook ${url} failed after ${MAX_RETRIES} tries: ${(err as Error).message}`, { eventType });
  }
}

export function fireWebhooks(eventType: string, payload: unknown): void {
  const urls = config.webhookUrls ?? [];
  if (!urls.length) return;
  const body = JSON.stringify({ event: eventType, payload, ts: Date.now() });
  const secret = config.webhookSecret ?? null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Sulala-Agent-Webhook',
    ...(secret && { 'X-Webhook-Secret': secret }),
  };
  for (const url of urls) {
    postWithRetry(url, body, headers, eventType);
  }
}
