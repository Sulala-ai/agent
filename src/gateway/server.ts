import express, { type Express, type Request, type Response } from 'express';
import { createServer } from 'http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import cors from 'cors';
import { config, getSulalaEnvPath, getPortalGatewayBase, getEffectivePortalApiKey } from '../config.js';
import { readOnboardEnvKeys, writeOnboardEnvKeys } from '../onboard-env.js';
import {
  initDb,
  getDb,
  log,
  insertTask,
  getFileStates,
  updateTaskStatus,
  setTaskPendingForRetry,
  getOrCreateAgentSession,
  getAgentSessionById,
  getAgentMessages,
  appendAgentMessage,
  updateAgentMessageToolResult,
  listAgentMemories,
  listAgentMemoryScopeKeys,
  listAgentSessions,
  listScheduledJobs,
  getScheduledJob,
  insertScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
  getTasksForJob,
  getChannelConfig,
  setChannelConfig,
} from '../db/index.js';
import { scheduleCronById, unscheduleJob } from '../scheduler/cron.js';
import { getTelegramChannelState, setTelegramChannelConfig } from '../channels/telegram.js';
import { getDiscordChannelState, setDiscordChannelConfig } from '../channels/discord.js';
import { getEffectiveStripeSecretKey, getStripeChannelState, setStripeChannelConfig } from '../channels/stripe.js';
import { reloadProviders } from '../ai/orchestrator.js';
import { runAgentTurn, runAgentTurnStream } from '../agent/loop.js';
import { runAgentTurnWithPi, isPiAvailable } from '../agent/pi-runner.js';
import { listTools, executeTool } from '../agent/tools.js';
import { listSkills, getAllRequiredBins } from '../agent/skills.js';
import { getRegistrySkills, getAvailableUpdates, installSkill, uninstallSkill, updateSkillsAll, installAllSystemSkills } from '../agent/skill-install.js';
import { getTemplates } from '../agent/skill-templates.js';
import { generateSkillSpec, writeGeneratedSkill, WIZARD_APPS, WIZARD_TRIGGERS } from '../agent/skill-generate.js';
import { loadSkillsConfig, saveSkillsConfig, getConfigPath, setSkillEnabled, removeSkillEntry, migrateConfigNameKeysToSlug, getOnboardingComplete, setOnboardingComplete } from '../agent/skills-config.js';
import { redactSkillsConfig } from '../redact.js';
import { withSessionLock } from '../agent/session-queue.js';
import {
  listPendingActions,
  getPendingAction,
  getPendingActionForReplay,
  setPendingActionApproved,
  setPendingActionRejected,
  sanitizeArgsForDisplay,
} from '../agent/pending-actions.js';
import { isOllamaReachable, startOllamaServeForApi, runOllamaInstall, setPullProgressCallback, pullOllamaModel } from '../ollama-setup.js';
import { getSystemCapabilities } from '../system-capabilities.js';
import { getPackageRoot } from '../onboard.js';
import type { AppLocals } from '../types.js';

const projectRoot = getPackageRoot();
const dashboardDist = join(projectRoot, 'dashboard', 'dist');
const registryDir = join(projectRoot, 'registry');

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimitMiddleware(req: Request, res: Response, next: () => void): void {
  if (!config.rateLimitMax || config.rateLimitMax <= 0) return next();
  if (req.path === '/health') return next();
  // Don't rate-limit read-only or bootstrap endpoints the dashboard calls often
  if (req.path.startsWith('/api/onboard')) return next();
  if (req.path === '/api/agent/pending-actions' && req.method === 'GET') return next();
  if (req.path === '/api/config' && req.method === 'GET') return next();
  if (req.path === '/api/integrations/connections' && req.method === 'GET') return next();
  if (req.path === '/api/integrations/connect' && req.method === 'POST') return next();
  if (req.path.startsWith('/api/integrations/connections/') && req.method === 'DELETE') return next();
  if (req.path === '/api/oauth/connect-url' && req.method === 'GET') return next();
  if (req.path === '/api/oauth/callback' && req.method === 'GET') return next();
  const ip = (req.ip || req.socket?.remoteAddress || 'unknown') as string;
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + config.rateLimitWindowMs };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > config.rateLimitMax) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

/** Store base URL for publishing skills (POST /api/submissions). Derived from SKILLS_REGISTRY_URL origin. */
function getStorePublishBaseUrl(): string | null {
  const registryUrl = (process.env.SKILLS_REGISTRY_URL || '').trim();
  if (!registryUrl) return null;
  try {
    return new URL(registryUrl).origin;
  } catch {
    return null;
  }
}

export function createGateway(appMount: Express | null = null): Express {
  const app = appMount || express();
  app.use(cors());
  app.use(express.json());
  app.use(rateLimitMiddleware);

  try {
    const skills = listSkills(config, { includeDisabled: true });
    migrateConfigNameKeysToSlug(skills.map((s) => ({ name: s.name, slug: s.slug ?? s.name })));
  } catch {
    /* migration best-effort */
  }

  if (config.gatewayApiKey) {
    app.use((req: Request, res: Response, next: () => void) => {
      if (req.path === '/health') return next();
      if (req.path === '/onboard' || req.path.startsWith('/api/onboard') || req.path.startsWith('/api/ollama')) return next();
      const key = (req.headers['x-api-key'] as string) || (req.query.api_key as string);
      if (key === config.gatewayApiKey) return next();
      res.status(401).json({ error: 'Invalid or missing API key' });
    });
  }

  /** SulalaHub: public skills registry. When serving, base URL for skill links is derived from SKILLS_REGISTRY_URL (origin) or host:port. */
  app.get('/api/sulalahub/registry', (_req: Request, res: Response) => {
    try {
      const registryUrl = process.env.SKILLS_REGISTRY_URL?.trim();
      const baseUrl = registryUrl
        ? (() => {
            try {
              return new URL(registryUrl).origin;
            } catch {
              return `http://${config.host}:${config.port}`;
            }
          })()
        : `http://${config.host}:${config.port}`;
      const registryPath = join(registryDir, 'skills-registry.json');
      if (!existsSync(registryPath)) {
        res.json({ skills: [] });
        return;
      }
      const data = JSON.parse(readFileSync(registryPath, 'utf8')) as { skills: Array<{ slug: string; name: string; description: string; version?: string }> };
      const skills = (data.skills || []).map((s) => ({
        ...s,
        url: `${baseUrl}/api/sulalahub/skills/${s.slug}`,
      }));
      res.json({ skills });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/sulalahub/skills/:slug', (req: Request, res: Response) => {
    try {
      const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
      if (!slug || /[^a-z0-9-]/.test(slug)) {
        res.status(400).json({ error: 'Invalid slug' });
        return;
      }
      const path = join(registryDir, `${slug}.md`);
      if (!existsSync(path)) {
        res.status(404).json({ error: `Skill not found: ${slug}` });
        return;
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(readFileSync(path, 'utf8'));
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/system/capabilities', (_req: Request, res: Response) => {
    try {
      const caps = getSystemCapabilities();
      res.json(caps);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({
        storageFreeBytes: null,
        isCloudOrContainer: false,
        cloudReason: '',
        ollamaSuitable: true,
        ollamaSuitableReason: 'Check unavailable',
      });
    }
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'sulala-gateway' });
  });

  /** Onboard: check if onboarding is complete (first-launch detection). */
  app.get('/api/onboard/status', (_req: Request, res: Response) => {
    try {
      const complete = getOnboardingComplete();
      res.json({ complete });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ complete: false, error: (e as Error).message });
    }
  });

  /** Onboard: mark onboarding as complete. Installs all system skills to workspace/skills in the background when SKILLS_REGISTRY_URL is set. */
  app.put('/api/onboard/complete', async (_req: Request, res: Response) => {
    try {
      setOnboardingComplete(true);
      await reloadProviders();
      res.json({ ok: true, complete: true });
      installAllSystemSkills()
        .then(({ installed, failed }) => {
          if (installed.length) log('gateway', 'info', `Onboard: installed ${installed.length} system skill(s): ${installed.join(', ')}`);
          if (failed.length) log('gateway', 'warn', `Onboard: failed to install ${failed.length} system skill(s): ${failed.map((f) => f.slug).join(', ')}`);
        })
        .catch((e) => log('gateway', 'error', `Onboard: system skills install failed: ${(e as Error).message}`));
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Onboard: which API keys are set (values never returned). */
  app.get('/api/onboard/env', (_req: Request, res: Response) => {
    try {
      const keys = readOnboardEnvKeys();
      const envPath = getSulalaEnvPath();
      res.json({ envPath, keys });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Onboard: save API keys to ~/.sulala/.env (whitelist only). Reload AI providers so new keys apply without restart. */
  app.put('/api/onboard/env', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, string>;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Body must be an object' });
        return;
      }
      writeOnboardEnvKeys(body);
      await reloadProviders();
      res.json({ ok: true, keys: readOnboardEnvKeys() });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Ollama status and setup (for onboard and dashboard). */
  app.get('/api/ollama/status', async (_req: Request, res: Response) => {
    try {
      const running = await isOllamaReachable();
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      res.json({ running, baseUrl });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ running: false, error: (e as Error).message });
    }
  });

  app.post('/api/ollama/start', async (_req: Request, res: Response) => {
    try {
      const result = await startOllamaServeForApi();
      res.json(result);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ started: false, error: (e as Error).message });
    }
  });

  app.post('/api/ollama/install', (_req: Request, res: Response) => {
    try {
      runOllamaInstall();
      res.json({ ok: true, message: 'Install started. Check your terminal or install from https://ollama.com' });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  (app.locals as AppLocals).ollamaPullState = { inProgress: false, model: '', lastLine: '', percent: 0 };
  app.get('/api/ollama/pull-status', (_req: Request, res: Response) => {
    res.json((app.locals as AppLocals).ollamaPullState ?? { inProgress: false, model: '', lastLine: '', percent: 0 });
  });
  setPullProgressCallback((model, line, percent) => {
    const state = { inProgress: percent >= 0 && percent < 100, model, lastLine: line, percent };
    (app.locals as AppLocals).ollamaPullState = state;
    const b = (app.locals as AppLocals).wsBroadcast;
    if (b) b({ type: 'ollama_pull_progress', data: state });
  });

  app.post('/api/ollama/pull', (req: Request, res: Response) => {
    try {
      const { model } = req.body || {};
      if (!model || typeof model !== 'string' || !model.trim()) {
        res.status(400).json({ error: 'model required' });
        return;
      }
      pullOllamaModel(model.trim());
      res.json({ ok: true, model: model.trim(), message: 'Pull started. Check pull-status for progress.' });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Recommended Ollama models for onboarding (size, RAM, CPU/GPU). */
  const RECOMMENDED_OLLAMA_MODELS = [
    { id: 'llama3.2', name: 'Llama 3.2', size: '~2GB', ram: '8GB', cpu: 'Any', gpu: 'Optional', description: 'Good balance of speed and quality' },
    { id: 'llama3.2:1b', name: 'Llama 3.2 1B', size: '~1.3GB', ram: '4GB', cpu: 'Any', gpu: 'None', description: 'Fast, low resource' },
    { id: 'mistral', name: 'Mistral 7B', size: '~4.1GB', ram: '8GB', cpu: '4+ cores', gpu: 'Recommended', description: 'Strong general model' },
    { id: 'codellama', name: 'Code Llama', size: '~3.8GB', ram: '8GB', cpu: '4+ cores', gpu: 'Recommended', description: 'Optimized for code' },
    { id: 'phi3', name: 'Phi-3 Mini', size: '~2.3GB', ram: '8GB', cpu: 'Any', gpu: 'Optional', description: 'Efficient small model' },
    { id: 'gemma2:2b', name: 'Gemma 2 2B', size: '~1.6GB', ram: '4GB', cpu: 'Any', gpu: 'None', description: 'Lightweight, capable' },
  ];
  app.get('/api/onboard/recommended-models', (_req: Request, res: Response) => {
    res.json({ models: RECOMMENDED_OLLAMA_MODELS });
  });

  /** /onboard is served by the dashboard SPA (new step-by-step OnboardingFlow) when dashboard exists. See fallback below when dashboard is missing. */

  app.get('/api/tasks', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
      const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit);
      res.json({ tasks: rows });
    } catch (e) {
      log('gateway', 'error', (e as Error).message, { stack: (e as Error).stack });
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/tasks', (req: Request, res: Response) => {
    try {
      const { type, payload, scheduled_at } = req.body || {};
      if (!type) {
        res.status(400).json({ error: 'type required' });
        return;
      }
      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      insertTask({ id, type, payload: payload ?? null, scheduled_at: scheduled_at ?? null });
      log('gateway', 'info', 'Task enqueued', { id, type });
      res.status(201).json({ id, type, status: 'pending' });
    } catch (e) {
      log('gateway', 'error', (e as Error).message, { stack: (e as Error).stack });
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/logs', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
      const rows = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT ?').all(limit);
      res.json({ logs: rows });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/file-states', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '200', 10), 500);
      const rows = getFileStates(limit);
      res.json({ fileStates: rows });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/channels/telegram', (_req: Request, res: Response) => {
    try {
      const state = getTelegramChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/channels/telegram', async (req: Request, res: Response) => {
    try {
      const { enabled, botToken, dmPolicy, allowFrom, notificationChatId, defaultProvider, defaultModel } = req.body || {};
      const result = await setTelegramChannelConfig({
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        botToken: botToken !== undefined ? botToken : undefined,
        dmPolicy: typeof dmPolicy === 'string' ? dmPolicy as 'open' | 'allowlist' | 'disabled' : undefined,
        allowFrom: Array.isArray(allowFrom) ? allowFrom : undefined,
        notificationChatId: notificationChatId !== undefined ? (typeof notificationChatId === 'number' ? notificationChatId : parseInt(String(notificationChatId), 10)) : undefined,
        defaultProvider: defaultProvider !== undefined ? (typeof defaultProvider === 'string' ? defaultProvider : null) : undefined,
        defaultModel: defaultModel !== undefined ? (typeof defaultModel === 'string' ? defaultModel : null) : undefined,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error || 'Failed to save' });
        return;
      }
      const state = getTelegramChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/channels/discord', (_req: Request, res: Response) => {
    try {
      const state = getDiscordChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/channels/discord', async (req: Request, res: Response) => {
    try {
      const { botToken } = req.body || {};
      const result = await setDiscordChannelConfig({
        botToken: botToken !== undefined ? (typeof botToken === 'string' ? botToken : null) : undefined,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error || 'Failed to save' });
        return;
      }
      const state = getDiscordChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/channels/stripe', (_req: Request, res: Response) => {
    try {
      const state = getStripeChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/channels/stripe', async (req: Request, res: Response) => {
    try {
      const { secretKey } = req.body || {};
      const result = await setStripeChannelConfig({
        secretKey: secretKey !== undefined ? (typeof secretKey === 'string' ? secretKey : null) : undefined,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error || 'Failed to save' });
        return;
      }
      // Persist to ~/.sulala/.env so the key is visible there and survives across DB resets
      const effective = getEffectiveStripeSecretKey();
      writeOnboardEnvKeys({ STRIPE_SECRET_KEY: effective ?? '' });
      const state = getStripeChannelState();
      res.json(state);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Returns connected integration provider ids (from Portal). When Portal is not configured, returns []. */
  async function getConnectedIntegrationIds(): Promise<string[]> {
    const base = getPortalGatewayBase();
    const key = getEffectivePortalApiKey();
    if (!base || !key) return [];
    try {
      const portalRes = await fetch(`${base}/connections`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!portalRes.ok) return [];
      const data = (await portalRes.json()) as {
        connections?: Array<{ provider?: string }>;
      };
      const raw = data.connections ?? [];
      const ids = new Set<string>();
      for (const c of raw) {
        const p = (c.provider ?? '').trim();
        if (p) ids.add(p);
      }
      return Array.from(ids);
    } catch {
      return [];
    }
  }

  /** GET /api/integrations/connections — When Portal is configured, proxy list from Portal (dashboard can show connections like direct mode). */
  app.get('/api/integrations/connections', async (_req: Request, res: Response) => {
    try {
      const base = getPortalGatewayBase();
      const key = getEffectivePortalApiKey();
      if (!base || !key) {
        res.status(404).json({ error: 'Portal not configured', connections: [] });
        return;
      }
      const portalRes = await fetch(`${base}/connections`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!portalRes.ok) {
        const text = await portalRes.text();
        let err = `Portal: ${portalRes.status}`;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) err = j.error;
        } catch {
          if (text) err = text.slice(0, 200);
        }
        res.status(portalRes.status >= 500 ? 502 : portalRes.status).json({ error: err, connections: [] });
        return;
      }
      const data = (await portalRes.json()) as { connections?: Array<{ connection_id?: string; id?: string; provider?: string; created_at?: number | string }> };
      const raw = data.connections ?? [];
      const connections = raw.map((c) => {
        const created = c.created_at;
        const createdAt = typeof created === 'number' ? created : created ? new Date(created).getTime() : 0;
        return {
          id: c.connection_id ?? c.id ?? '',
          provider: c.provider ?? '',
          scopes: [] as string[],
          createdAt,
          updatedAt: undefined as number | undefined,
        };
      });
      res.json({ connections });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message, connections: [] });
    }
  });

  /** POST /api/integrations/connect — When Portal configured, start OAuth via Portal. Body: { provider, redirect_success }. Returns { authUrl, connectionId }. */
  app.post('/api/integrations/connect', async (req: Request, res: Response) => {
    try {
      const base = getPortalGatewayBase();
      const key = getEffectivePortalApiKey();
      if (!base || !key) {
        res.status(404).json({ error: 'Portal not configured' });
        return;
      }
      const body = req.body as { provider?: string; redirect_success?: string };
      const provider = typeof body?.provider === 'string' ? body.provider.trim() : '';
      if (!provider) {
        res.status(400).json({ error: 'provider required' });
        return;
      }
      const portalRes = await fetch(`${base}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ provider, redirect_success: body.redirect_success || undefined }),
      });
      const text = await portalRes.text();
      if (!portalRes.ok) {
        let err = `Portal: ${portalRes.status}`;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) err = j.error;
        } catch {
          if (text) err = text.slice(0, 200);
        }
        res.status(portalRes.status >= 500 ? 502 : portalRes.status).json({ error: err });
        return;
      }
      const data = JSON.parse(text) as { authUrl?: string; connectionId?: string };
      if (!data.authUrl) {
        res.status(502).json({ error: 'No authUrl from Portal' });
        return;
      }
      res.json({ authUrl: data.authUrl, connectionId: data.connectionId ?? null });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** DELETE /api/integrations/connections/:id — When Portal configured, disconnect via Portal. */
  app.delete('/api/integrations/connections/:id', async (req: Request, res: Response) => {
    try {
      const base = getPortalGatewayBase();
      const key = getEffectivePortalApiKey();
      if (!base || !key) {
        res.status(404).json({ error: 'Portal not configured' });
        return;
      }
      const rawId = req.params?.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'connection id required' });
        return;
      }
      const portalRes = await fetch(`${base}/connections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!portalRes.ok) {
        const text = await portalRes.text();
        let err = `Portal: ${portalRes.status}`;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) err = j.error;
        } catch {
          if (text) err = text.slice(0, 200);
        }
        res.status(portalRes.status >= 500 ? 502 : portalRes.status).json({ error: err });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** GET /api/oauth/connect-url — Build Portal "Connect with Sulala" URL for dashboard. Requires PORTAL_GATEWAY_URL, PORTAL_OAUTH_CLIENT_ID; redirect_uri = this gateway base + /api/oauth/callback. Optional return_to encoded in state for callback redirect. */
  app.get('/api/oauth/connect-url', (req: Request, res: Response) => {
    try {
      const portalGateway = getPortalGatewayBase();
      const portalBase = portalGateway ? portalGateway.replace(/\/api\/gateway$/i, '') : '';
      const clientId = (process.env.PORTAL_OAUTH_CLIENT_ID || '').trim();
      if (!portalBase || !clientId) {
        res.status(503).json({
          error: 'OAuth not configured',
          hint: 'Set PORTAL_GATEWAY_URL and PORTAL_OAUTH_CLIENT_ID (and PORTAL_OAUTH_CLIENT_SECRET for callback). Register redirect_uri in the Portal.',
        });
        return;
      }
      const proto = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
      const publicBase = (process.env.PUBLIC_URL || process.env.GATEWAY_PUBLIC_URL || '').trim() || `${proto}://${host}`;
      const callbackUrl = `${publicBase.replace(/\/$/, '')}/api/oauth/callback`;
      const return_to = (req.query.return_to as string)?.trim() || undefined;
      const statePayload = JSON.stringify({ r: randomBytes(12).toString('base64url'), return_to });
      const state = Buffer.from(statePayload, 'utf8').toString('base64url');
      const url = `${portalBase}/connect?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
      res.json({ url });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  function parseOAuthReturnTo(req: Request): string | undefined {
    try {
      const stateRaw = (req.query.state as string) || '';
      const statePayload = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
      if (statePayload && typeof statePayload.return_to === 'string' && statePayload.return_to.trim()) {
        return statePayload.return_to.trim();
      }
    } catch {
      /* state may be legacy random string */
    }
    return undefined;
  }

  /** GET /api/oauth/callback — Portal redirects here with code & state. Exchange for access token, save as PORTAL_API_KEY, redirect to dashboard. */
  app.get('/api/oauth/callback', async (req: Request, res: Response) => {
    const dashboardOrigin = (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}` : null) || (req.headers.origin || `${req.protocol}://${req.get('host')}`);
    const return_to = parseOAuthReturnTo(req);
    const returnFragment = return_to ? `&return_to=${encodeURIComponent(return_to)}` : '';
    try {
      const code = (req.query.code as string) || '';
      const portalGateway = getPortalGatewayBase();
      const portalBase = portalGateway ? portalGateway.replace(/\/api\/gateway$/i, '') : '';
      const clientId = (process.env.PORTAL_OAUTH_CLIENT_ID || '').trim();
      const clientSecret = (process.env.PORTAL_OAUTH_CLIENT_SECRET || '').trim();
      if (!code || !portalBase || !clientId || !clientSecret) {
        res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=error&message=missing_config${returnFragment}`);
        return;
      }
      const proto = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
      const publicBase = (process.env.PUBLIC_URL || process.env.GATEWAY_PUBLIC_URL || '').trim() || `${proto}://${host}`;
      const redirectUri = `${publicBase.replace(/\/$/, '')}/api/oauth/callback`;
      const tokenRes = await fetch(`${portalBase}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });
      const tokenText = await tokenRes.text();
      if (!tokenRes.ok) {
        log('gateway', 'error', `OAuth token exchange failed: ${tokenRes.status} ${tokenText}`);
        res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=error&message=exchange_failed${returnFragment}`);
        return;
      }
      let tokenData: { access_token?: string };
      try {
        tokenData = JSON.parse(tokenText);
      } catch {
        res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=error&message=invalid_response${returnFragment}`);
        return;
      }
      const accessToken = tokenData.access_token?.trim();
      if (!accessToken) {
        res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=error&message=no_token${returnFragment}`);
        return;
      }
      writeOnboardEnvKeys({ PORTAL_API_KEY: accessToken });
      res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=success${returnFragment}`);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      const dashboardOrigin = (req.headers.origin || (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-host'] ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}` : null) || `${req.protocol}://${req.get('host')}`);
      const return_to = parseOAuthReturnTo(req);
      const returnFragment = return_to ? `&return_to=${encodeURIComponent(return_to)}` : '';
      res.redirect(302, `${dashboardOrigin || '/'}/?page=integrations&oauth=error&message=server_error${returnFragment}`);
    }
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    try {
      const portalUrl = getPortalGatewayBase();
      const portalKey = getEffectivePortalApiKey();
      const portalSet = !!(portalUrl && portalKey);
      const directSet = !!config.integrationsUrl?.trim();
      const integrationsMode = portalSet ? 'portal' : directSet ? 'direct' : null;
      const portalOAuthClientId = (process.env.PORTAL_OAUTH_CLIENT_ID || '').trim();
      res.json({
        watchFolders: config.watchFolders || [],
        agentUsePi: config.agentUsePi,
        piAvailable: isPiAvailable(),
        /** When set, dashboard can use this for Integrations page instead of VITE_INTEGRATIONS_URL. */
        integrationsUrl: config.integrationsUrl || null,
        /** 'portal' = agent uses Portal for connections; 'direct' = agent uses INTEGRATIONS_URL; null = neither. */
        integrationsMode,
        portalGatewayUrl: portalUrl || config.portalGatewayUrl || null,
        /** When set, dashboard can show "Connect with Sulala (OAuth)" and use /api/oauth/connect-url. */
        portalOAuthConnectAvailable: !!(portalUrl && portalOAuthClientId),
        aiProviders: [
          { id: 'openai', label: 'OpenAI', defaultModel: process.env.AI_OPENAI_DEFAULT_MODEL || 'gpt-4o-mini' },
          { id: 'openrouter', label: 'OpenRouter', defaultModel: process.env.AI_OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini' },
          { id: 'claude', label: 'Claude', defaultModel: process.env.AI_CLAUDE_DEFAULT_MODEL || 'claude-sonnet-4-6' },
          { id: 'gemini', label: 'Gemini', defaultModel: process.env.AI_GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash' },
          { id: 'ollama', label: 'Ollama', defaultModel: process.env.AI_OLLAMA_DEFAULT_MODEL || 'llama3.2' },
        ],
      });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  const JOB_DEFAULT_KEY = 'job_default';
  app.get('/api/settings/job-default', (_req: Request, res: Response) => {
    try {
      const raw = getChannelConfig(JOB_DEFAULT_KEY);
      if (!raw?.trim()) {
        res.json({ defaultProvider: null, defaultModel: null });
        return;
      }
      const o = JSON.parse(raw) as Record<string, unknown>;
      const defaultProvider = typeof o.defaultProvider === 'string' ? o.defaultProvider.trim() || null : null;
      const defaultModel = typeof o.defaultModel === 'string' ? o.defaultModel.trim() || null : null;
      res.json({ defaultProvider, defaultModel });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });
  app.put('/api/settings/job-default', (req: Request, res: Response) => {
    try {
      const { defaultProvider, defaultModel } = req.body || {};
      const provider = defaultProvider !== undefined ? (typeof defaultProvider === 'string' ? defaultProvider.trim() || null : null) : undefined;
      const model = defaultModel !== undefined ? (typeof defaultModel === 'string' ? defaultModel.trim() || null : null) : undefined;
      const current = getChannelConfig(JOB_DEFAULT_KEY);
      let next: Record<string, unknown> = {};
      if (current?.trim()) {
        try {
          next = JSON.parse(current) as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
      if (provider !== undefined) next.defaultProvider = provider;
      if (model !== undefined) next.defaultModel = model;
      setChannelConfig(JOB_DEFAULT_KEY, JSON.stringify(next));
      res.json({ defaultProvider: next.defaultProvider ?? null, defaultModel: next.defaultModel ?? null });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/skills/required-bins', (_req: Request, res: Response) => {
    try {
      const bins = getAllRequiredBins(config);
      res.json({ bins });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/skills', (_req: Request, res: Response) => {
    try {
      const skills = listSkills(config, { includeDisabled: true });
      res.json({ skills });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/skills/config', (_req: Request, res: Response) => {
    try {
      const cfg = loadSkillsConfig();
      res.json({ skills: redactSkillsConfig(cfg), configPath: getConfigPath() });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/agent/skills/config', (req: Request, res: Response) => {
    try {
      const { skills } = req.body || {};
      if (skills && typeof skills === 'object') saveSkillsConfig(skills);
      res.json({ skills: redactSkillsConfig(loadSkillsConfig()), configPath: getConfigPath() });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/skills/config/remove', (req: Request, res: Response) => {
    try {
      const { slug } = req.body || {};
      if (!slug || typeof slug !== 'string') {
        res.status(400).json({ error: 'slug required' });
        return;
      }
      removeSkillEntry(slug);
      res.json({ removed: slug, skills: redactSkillsConfig(loadSkillsConfig()), configPath: getConfigPath() });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/skills/updates', async (_req: Request, res: Response) => {
    try {
      const updates = await getAvailableUpdates();
      res.json({ updates });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/skills/registry', async (req: Request, res: Response) => {
    try {
      const url = (req.query.url as string)?.trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Registry fetch failed: ${resp.status}`);
        const data = (await resp.json()) as { skills?: unknown[] };
        res.json({ skills: data.skills ?? [] });
        return;
      }
      const skills = await getRegistrySkills();
      res.json({ skills });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/skills/update', async (_req: Request, res: Response) => {
    try {
      const result = await updateSkillsAll();
      res.json(result);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/skills/uninstall', (req: Request, res: Response) => {
    try {
      const { slug, target } = req.body || {};
      if (!slug || typeof slug !== 'string') {
        res.status(400).json({ error: 'slug required' });
        return;
      }
      const t = target === 'user' ? 'user' : target === 'managed' ? 'managed' : 'workspace';
      const result = uninstallSkill(slug, t);
      if (result.success) {
        removeSkillEntry(slug);
        res.json({ uninstalled: slug, path: result.path, target: t });
      } else {
        res.status(400).json({ error: result.error || 'Uninstall failed' });
      }
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Publish a user-created skill to the store (POST to store /api/submissions). No API key required by default; set STORE_PUBLISH_API_KEY if the store requires it. */
  app.post('/api/agent/skills/publish', async (req: Request, res: Response) => {
    try {
      const { slug, priceIntent, intendedPriceCents } = req.body || {};
      if (!slug || typeof slug !== 'string') {
        res.status(400).json({ error: 'slug required' });
        return;
      }
      const skills = listSkills(config, { includeDisabled: true });
      const skill = skills.find((s) => (s.slug ?? s.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, '')) === slug && s.source === 'user');
      if (!skill) {
        res.status(400).json({ error: 'Skill not found or not a user-created skill. Only skills in My skills can be published.' });
        return;
      }
      const skillDir = join(config.skillsWorkspaceMyDir, slug);
      const readmePath = join(skillDir, 'README.md');
      const skillPath = join(skillDir, 'SKILL.md');
      const mdPath = existsSync(readmePath) ? readmePath : existsSync(skillPath) ? skillPath : null;
      if (!mdPath) {
        res.status(400).json({ error: 'Skill README.md or SKILL.md not found' });
        return;
      }
      const markdown = readFileSync(mdPath, 'utf8');
      const toolsPath = join(skillDir, 'tools.yaml');
      const toolsYaml = existsSync(toolsPath) ? readFileSync(toolsPath, 'utf8').trim() : undefined;
      const storeBase = getStorePublishBaseUrl();
      if (!storeBase) {
        res.status(400).json({
          error: 'Store URL not configured. Set SKILLS_REGISTRY_URL to your hub (e.g. https://hub.sulala.ai or http://localhost:3002).',
        });
        return;
      }
      const submitUrl = `${storeBase.replace(/\/$/, '')}/api/submissions`;
      const body: Record<string, unknown> = {
        slug,
        name: skill.name,
        description: skill.description,
        version: skill.version || '1.0.0',
        markdown,
        priceIntent: priceIntent === 'paid' || priceIntent === 'free' ? priceIntent : 'free',
      };
      if (toolsYaml) body.toolsYaml = toolsYaml;
      if (priceIntent === 'paid' && typeof intendedPriceCents === 'number' && intendedPriceCents >= 0) {
        body.intendedPriceCents = intendedPriceCents;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = (process.env.STORE_PUBLISH_API_KEY || '').trim();
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const resp = await fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; githubUrl?: string };
      if (!resp.ok) {
        const status = resp.status === 503 ? 503 : 400;
        res.status(status).json({ error: data.error || `Store returned ${resp.status}`, githubUrl: data.githubUrl });
        return;
      }
      if (data.ok && data.id) {
        res.json({ published: true, slug, id: data.id, message: 'Submitted to the store. An admin will review it.' });
      } else {
        res.json({ published: true, slug, message: 'Submitted to the store.' });
      }
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Publish status: list of user's submissions (pending/approved) from the store. Uses STORE_PUBLISH_API_KEY. */
  app.get('/api/agent/skills/publish-status', async (_req: Request, res: Response) => {
    try {
      const storeBase = getStorePublishBaseUrl();
      const apiKey = (process.env.STORE_PUBLISH_API_KEY || '').trim();
      if (!storeBase || !apiKey) {
        res.json({ submissions: [] });
        return;
      }
      const url = `${storeBase.replace(/\/$/, '')}/api/me/submissions`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const data = (await resp.json().catch(() => ({}))) as { submissions?: Array<{ slug: string; status: string }>; error?: string };
      if (!resp.ok) {
        res.json({ submissions: [] });
        return;
      }
      res.json({ submissions: data.submissions ?? [] });
    } catch {
      res.json({ submissions: [] });
    }
  });

  app.post('/api/agent/skills/install', async (req: Request, res: Response) => {
    try {
      const { slug, target, registryUrl } = req.body || {};
      if (!slug || typeof slug !== 'string') {
        res.status(400).json({ error: 'slug required' });
        return;
      }
      const t = target === 'managed' ? 'managed' : 'workspace';
      const result = await installSkill(slug, t, { registryUrl: typeof registryUrl === 'string' ? registryUrl : undefined });
      if (result.success) {
        setSkillEnabled(slug, true);
        res.status(201).json({ installed: slug, path: result.path, target: t });
      } else {
        res.status(400).json({ error: result.error || 'Install failed' });
      }
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Skill Wizard: generate spec and optionally write skill to workspace. */
  app.get('/api/agent/skills/wizard-apps', (_req: Request, res: Response) => {
    res.json({ apps: WIZARD_APPS, triggers: WIZARD_TRIGGERS });
  });

  app.get('/api/agent/skills/templates', async (_req: Request, res: Response) => {
    try {
      const registrySkills = await getRegistrySkills();
      const templates = getTemplates(registrySkills);
      res.json({ templates });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/skills/generate', (req: Request, res: Response) => {
    try {
      const { goal = '', app: appId = 'other', trigger: triggerId = 'manual', write } = req.body || {};
      const spec = generateSkillSpec(
        typeof goal === 'string' ? goal : '',
        typeof appId === 'string' ? appId : 'other',
        typeof triggerId === 'string' ? triggerId : 'manual'
      );
      if (write) {
        const { path: filePath, slug } = writeGeneratedSkill(config, spec);
        res.status(201).json({ spec, path: filePath, slug, written: true });
      } else {
        res.json({ spec, written: false });
      }
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Execution preview: list pending tool actions awaiting approval. */
  app.get('/api/agent/pending-actions', (req: Request, res: Response) => {
    try {
      const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : undefined;
      const list = listPendingActions(sessionId).map((a) => ({
        ...a,
        args: sanitizeArgsForDisplay(a.args),
      }));
      res.json({ pendingActions: list });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/pending-actions/:id/approve', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Pending action id required' });
      return;
    }
    try {
      const pending = getPendingActionForReplay(id);
      if (!pending) {
        res.status(404).json({ error: 'Pending action not found or already handled' });
        return;
      }
      let result: unknown;
      try {
        result = await executeTool(pending.toolName, pending.args, {
          sessionId: pending.sessionId,
          toolCallId: pending.toolCallId,
          skipApproval: true,
        });
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
      const updated = updateAgentMessageToolResult(pending.sessionId, pending.toolCallId, resultContent);
      if (!updated) {
        appendAgentMessage({
          session_id: pending.sessionId,
          role: 'tool',
          tool_call_id: pending.toolCallId,
          name: pending.toolName,
          content: resultContent,
        });
      }
      setPendingActionApproved(id, result);
      res.json({ ok: true, result });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/pending-actions/:id/reject', (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Pending action id required' });
      return;
    }
    try {
      const pending = getPendingAction(id);
      if (!pending || pending.status !== 'pending') {
        res.status(404).json({ error: 'Pending action not found or already handled' });
        return;
      }
      setPendingActionRejected(id);
      const rejectedContent = JSON.stringify({ error: 'User rejected this action.' });
      const updated = updateAgentMessageToolResult(pending.sessionId, pending.toolCallId, rejectedContent);
      if (!updated) {
        appendAgentMessage({
          session_id: pending.sessionId,
          role: 'tool',
          tool_call_id: pending.toolCallId,
          name: pending.toolName,
          content: rejectedContent,
        });
      }
      res.json({ ok: true });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** List models for a provider. Ollama: local /api/tags; OpenRouter: proxies OpenRouter API. */
  app.get('/api/agent/models', async (req: Request, res: Response) => {
    const provider = (req.query.provider as string) || '';
    if (provider === 'ollama') {
      try {
        const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) {
          res.json({ models: [] });
          return;
        }
        const data = (await r.json()) as { models?: Array<{ name: string }> };
        const toolsWhitelist = /^(qwen3|qwen3\.5|qwen3-vl|qwen3-next|deepseek-r1|deepseek-v3|gpt-oss|glm-4\.7-flash|nemotron-3-nano|magistral|llama3|hermes3|mistral|gemma2|codellama|solar|qwen2|wizardlm2|neural-chat|starling-lm)(:|$)/i;
        const models = (data.models || [])
          .filter((m) => toolsWhitelist.test(m.name))
          .filter((m) => !/:1b$|:1\.5b$|:0\.6b$|:2b$/i.test(m.name))
          .map((m) => ({ id: m.name, name: m.name }));
        res.json({ models });
      } catch {
        res.json({ models: [] });
      }
      return;
    }
    if (provider !== 'openrouter') {
      res.json({ models: [] });
      return;
    }
    try {
      const key = process.env.OPENROUTER_API_KEY;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const r = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (!r.ok) {
        res.status(r.status).json({ error: `OpenRouter models: ${r.status}`, models: [] });
        return;
      }
      const data = (await r.json()) as { data?: Array<{ id: string; name?: string }> };
      const models = (data.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
      res.json({ models });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message, models: [] });
    }
  });

  app.post('/api/complete', async (req: Request, res: Response) => {
    try {
      const { provider, model, messages, max_tokens } = req.body || {};
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'messages array required' });
        return;
      }
      const { complete } = await import('../ai/orchestrator.js');
      const result = await complete({ provider, model, messages, max_tokens: max_tokens || 1024 });
      res.json(result);
    } catch (e) {
      log('gateway', 'error', (e as Error).message, { stack: (e as Error).stack });
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** POST /api/tools/invoke — direct tool execution. Same policy as agent run. */
  app.post('/api/tools/invoke', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { tool?: unknown; args?: unknown };
      const toolName = typeof body.tool === 'string' ? body.tool.trim() : '';
      if (!toolName) {
        res.status(400).json({ error: 'body.tool (string) required' });
        return;
      }
      const args =
        body.args != null && typeof body.args === 'object' && !Array.isArray(body.args)
          ? (body.args as Record<string, unknown>)
          : {};
      const allowed = listTools();
      const tool = allowed.find((t) => t.name === toolName);
      if (!tool) {
        res.status(404).json({ error: `Tool "${toolName}" not found or not allowed` });
        return;
      }
      const result = await executeTool(toolName, args);
      res.json({ ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log('gateway', 'error', msg, { stack: e instanceof Error ? e.stack : undefined });
      res.status(500).json({ error: msg });
    }
  });

  // --- Agent runner (sessions + tool loop) ---
  app.get('/api/agent/sessions', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
      const sessions = listAgentSessions(limit);
      res.json({ sessions });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** GET /api/agent/memory/scope-keys — distinct scope_key per scope (for Settings > Memory dropdowns). */
  app.get('/api/agent/memory/scope-keys', (_req: Request, res: Response) => {
    try {
      const keys = listAgentMemoryScopeKeys();
      res.json(keys);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** GET /api/agent/memory — list memory entries. Query: scope (session|shared), scope_key, limit (default 100). */
  app.get('/api/agent/memory', (req: Request, res: Response) => {
    try {
      const scope = (req.query.scope as string) === 'shared' ? 'shared' : 'session';
      const scopeKey = typeof req.query.scope_key === 'string' ? req.query.scope_key.trim() : '';
      if (!scopeKey) {
        res.status(400).json({ error: 'scope_key is required' });
        return;
      }
      const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
      const rows = listAgentMemories(scope, scopeKey, limit);
      const entries = rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        scope_key: r.scope_key,
        content: r.content,
        created_at: r.created_at,
      }));
      res.json({ entries });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/sessions', (req: Request, res: Response) => {
    try {
      const sessionKey = (req.body?.session_key as string) || `default_${Date.now()}`;
      const meta = req.body?.meta as Record<string, unknown> | undefined;
      const session = getOrCreateAgentSession(sessionKey, meta);
      res.status(201).json(session);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/agent/sessions/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Session id required' });
        return;
      }
      const session = getAgentSessionById(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const rows = getAgentMessages(id);
      const messages = rows.map((r) => {
        const msg: Record<string, unknown> = { role: r.role, content: r.content, tool_call_id: r.tool_call_id, name: r.name, created_at: r.created_at };
        if (r.tool_calls) {
          try {
            msg.tool_calls = JSON.parse(r.tool_calls) as unknown;
          } catch {
            msg.tool_calls = [];
          }
        }
        if ((r as { usage?: string | null }).usage) {
          try {
            msg.usage = JSON.parse((r as { usage: string }).usage) as unknown;
          } catch {
            // ignore
          }
        }
        const costUsd = (r as { cost_usd?: number | null }).cost_usd;
        if (costUsd != null) msg.cost_usd = costUsd;
        return msg;
      });
      res.json({ ...session, messages });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/agent/sessions/:id/messages', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const session = getAgentSessionById(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const { message, system_prompt, provider, model, max_tokens, timeout_ms, use_pi, required_integrations, attachment_urls } = req.body || {};
    const urls = Array.isArray(attachment_urls) ? (attachment_urls as string[]).filter((u) => typeof u === 'string' && u.trim()) : [];
    const userMessageText = typeof message === 'string' ? message : '';
    const fullUserMessage = urls.length > 0 ? `${userMessageText}\n\n[Attached media (use these URLs when posting images, e.g. Facebook photo post): ${urls.join(', ')}]` : userMessageText;
    const required = Array.isArray(required_integrations)
      ? (required_integrations as string[]).filter((k) => typeof k === 'string' && k.trim())
      : [];
    if (required.length > 0) {
      const connected = await getConnectedIntegrationIds();
      const missing = required.filter((k) => !connected.includes(k));
      if (missing.length > 0) {
        res.status(422).json({
          type: 'missing_integrations',
          error: 'Missing required integrations',
          missing,
        });
        return;
      }
    }
    const timeoutMs = typeof timeout_ms === 'number' ? timeout_ms : config.agentTimeoutMs || 0;
    let usePi = config.agentUsePi || use_pi === true || use_pi === '1';
    if (usePi && !isPiAvailable()) usePi = false;
    try {
      const result = await withSessionLock(id, () =>
        usePi
          ? runAgentTurnWithPi({
              sessionId: id,
              userMessage: fullUserMessage || null,
              systemPrompt: typeof system_prompt === 'string' ? system_prompt : null,
              provider: typeof provider === 'string' ? provider : undefined,
              model: typeof model === 'string' ? model : undefined,
              max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
              timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
              signal: controller.signal,
            })
          : runAgentTurn({
              sessionId: id,
              userMessage: fullUserMessage || null,
              systemPrompt: typeof system_prompt === 'string' ? system_prompt : null,
              provider: typeof provider === 'string' ? provider : undefined,
              model: typeof model === 'string' ? model : undefined,
              max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
              timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
              signal: controller.signal,
            }),
      );
      res.json(result);
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') {
        res.status(499).json({ error: 'Client closed request or run timed out' });
        return;
      }
      console.error('[gateway] POST /api/agent/sessions/:id/messages error:', err.message, err.stack);
      log('gateway', 'error', err.message, { stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agent/sessions/:id/messages/stream', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const session = getAgentSessionById(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const bodyRequired = Array.isArray((req.body as { required_integrations?: string[] })?.required_integrations)
      ? ((req.body as { required_integrations: string[] }).required_integrations.filter((k) => typeof k === 'string' && k.trim()))
      : [];
    if (bodyRequired.length > 0) {
      const connected = await getConnectedIntegrationIds();
      const missing = bodyRequired.filter((k) => !connected.includes(k));
      if (missing.length > 0) {
        res.status(422).json({
          type: 'missing_integrations',
          error: 'Missing required integrations',
          missing,
        });
        return;
      }
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const broadcast = (app.locals as AppLocals).wsBroadcast;

    const send = (event: string, data: unknown) => {
      const payload = event === 'start' ? { runId, ...(data as object) } : data;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
      if (broadcast) {
        broadcast({ type: 'agent_stream', runId, event, data: payload });
      }
    };

    send('start', { runId });

    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const { message, continue: continueAfterApproval, system_prompt, provider, model, max_tokens, timeout_ms, attachment_urls: streamAttachmentUrls } = req.body || {};
    const timeoutMs = typeof timeout_ms === 'number' ? timeout_ms : config.agentTimeoutMs || 0;
    const isContinue = continueAfterApproval === true || continueAfterApproval === 'true';
    const streamUrls = Array.isArray(streamAttachmentUrls) ? (streamAttachmentUrls as string[]).filter((u) => typeof u === 'string' && u.trim()) : [];
    const streamMsg = typeof message === 'string' ? message : '';
    const streamFullMessage = streamUrls.length > 0 ? `${streamMsg}\n\n[Attached media (use these URLs when posting images, e.g. Facebook photo post): ${streamUrls.join(', ')}]` : streamMsg;
    const userMessage = isContinue ? null : (streamFullMessage || null);

    try {
      const runResult = await withSessionLock(id, () =>
        runAgentTurnStream(
          {
            sessionId: id,
            userMessage,
            systemPrompt: typeof system_prompt === 'string' ? system_prompt : null,
            provider: typeof provider === 'string' ? provider : undefined,
            model: typeof model === 'string' ? model : undefined,
            max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
            timeoutMs: timeoutMs > 0 ? timeoutMs : undefined,
            signal: controller.signal,
          },
          (ev) => {
            if (ev.type === 'assistant') send('assistant', { delta: ev.delta });
            else if (ev.type === 'thinking') send('thinking', { delta: ev.delta });
            else if (ev.type === 'tool_call') send('tool_call', { name: ev.name, result: ev.result });
            else if (ev.type === 'done') send('done', { finalContent: ev.finalContent, turnCount: ev.turnCount, usage: ev.usage });
            else if (ev.type === 'error') send('error', { message: ev.message });
          }
        )
      );
      if (runResult.pendingActionId) {
        send('pending_approval', { pendingActionId: runResult.pendingActionId });
      }
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') send('error', { message: 'Client closed request or run timed out' });
      else {
        console.error('[gateway] POST /api/agent/sessions/:id/messages/stream error:', err.message, err.stack);
        log('gateway', 'error', err.message, { stack: err.stack });
        send('error', { message: err.message });
      }
    } finally {
      res.end();
    }
  });

  /** Start an agent run in the background; returns runId immediately. Stream events are broadcast on WebSocket (type: agent_stream, runId, event, data). */
  app.post('/api/agent/run', async (req: Request, res: Response) => {
    const { session_id, session_key, message, system_prompt, provider, model, max_tokens, timeout_ms } = req.body || {};
    let sessionId = typeof session_id === 'string' ? session_id : null;
    if (!sessionId && typeof session_key === 'string') {
      const session = getOrCreateAgentSession(session_key);
      sessionId = session.id;
    }
    if (!sessionId) {
      res.status(400).json({ error: 'session_id or session_key required' });
      return;
    }
    const session = getAgentSessionById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const broadcast = (app.locals as AppLocals).wsBroadcast;
    const sendWs = (event: string, data: unknown) => {
      if (broadcast) broadcast({ type: 'agent_stream', runId, event, data });
    };

    res.status(202).json({ runId, sessionId });

    withSessionLock(sessionId, () =>
      runAgentTurnStream(
        {
          sessionId,
          userMessage: typeof message === 'string' ? message : null,
          systemPrompt: typeof system_prompt === 'string' ? system_prompt : null,
          provider: typeof provider === 'string' ? provider : undefined,
          model: typeof model === 'string' ? model : undefined,
          max_tokens: typeof max_tokens === 'number' ? max_tokens : undefined,
          timeoutMs: typeof timeout_ms === 'number' && timeout_ms > 0 ? timeout_ms : config.agentTimeoutMs || 60000,
          signal: undefined,
        },
        (ev) => {
          if (ev.type === 'assistant') sendWs('assistant', { delta: ev.delta });
          else if (ev.type === 'thinking') sendWs('thinking', { delta: ev.delta });
          else if (ev.type === 'tool_call') sendWs('tool_call', { name: ev.name, result: ev.result });
          else if (ev.type === 'done') sendWs('done', { finalContent: ev.finalContent, turnCount: ev.turnCount });
          else if (ev.type === 'error') sendWs('error', { message: ev.message });
        }
      )
    ).then(
      () => sendWs('done', {}),
      (e) => {
        const err = e as Error;
        log('gateway', 'error', err.message, { runId, stack: err.stack });
        sendWs('error', { message: err.message });
      }
    );
  });

  app.patch('/api/tasks/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Task id required' });
        return;
      }
      const { action } = req.body || {};
      const db = getDb();
      const row = db.prepare('SELECT id, status FROM tasks WHERE id = ?').get(id) as { id: string; status: string } | undefined;
      if (!row) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      if (action === 'cancel') {
        if (row.status !== 'pending' && row.status !== 'running') {
          res.status(400).json({ error: 'Task cannot be cancelled' });
          return;
        }
        updateTaskStatus(id, 'cancelled');
        log('gateway', 'info', 'Task cancelled', { id });
        res.json({ id, status: 'cancelled' });
        return;
      }
      if (action === 'retry') {
        if (row.status !== 'failed') {
          res.status(400).json({ error: 'Only failed tasks can be retried' });
          return;
        }
        setTaskPendingForRetry(id);
        const enqueueTaskId = (app.locals as AppLocals).enqueueTaskId;
        if (typeof enqueueTaskId === 'function') enqueueTaskId(id);
        log('gateway', 'info', 'Task retry enqueued', { id });
        res.json({ id, status: 'pending' });
        return;
      }
      res.status(400).json({ error: 'action required: cancel or retry' });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Scheduled jobs (cron → task type)
  app.get('/api/schedules', (_req: Request, res: Response) => {
    try {
      const jobs = listScheduledJobs(false);
      res.json({ schedules: jobs });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/schedules', (req: Request, res: Response) => {
    try {
      const { name, description, cron_expression, task_type, payload, prompt, delivery, provider, model } = req.body || {};
      if (!cron_expression?.trim()) {
        res.status(400).json({ error: 'cron_expression required' });
        return;
      }
      const isAgentJob = typeof prompt === 'string' && prompt.trim().length > 0;
      const effectiveType = isAgentJob ? 'agent_job' : (task_type?.trim() || 'agent_job');
      const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const payloadStr = !isAgentJob && payload != null ? JSON.stringify(payload) : null;
      const deliveryStr = isAgentJob && delivery != null ? JSON.stringify(delivery) : null;
      const providerStr = typeof provider === 'string' ? provider.trim() || null : null;
      const modelStr = typeof model === 'string' ? model.trim() || null : null;
      insertScheduledJob({
        id,
        name: name?.trim() ?? '',
        description: description?.trim() ?? '',
        cron_expression: cron_expression.trim(),
        task_type: effectiveType,
        payload: payloadStr,
        prompt: isAgentJob ? prompt.trim() : null,
        delivery: deliveryStr,
        provider: providerStr,
        model: modelStr,
        enabled: 1,
      });
      try {
        if (isAgentJob) {
          const deliveryList = Array.isArray(delivery) ? delivery : (delivery ? [delivery] : []);
          const agentPayload: Record<string, unknown> = {
            jobId: id,
            name: name?.trim() || id,
            prompt: prompt.trim(),
            delivery: deliveryList,
          };
          if (providerStr) agentPayload.provider = providerStr;
          if (modelStr) agentPayload.model = modelStr;
          scheduleCronById(id, cron_expression.trim(), 'agent_job', agentPayload);
        } else {
          scheduleCronById(id, cron_expression.trim(), effectiveType, payload ?? null);
        }
      } catch (e) {
        deleteScheduledJob(id);
        throw e;
      }
      const row = getScheduledJob(id)!;
      log('gateway', 'info', 'Schedule created', { id, task_type: effectiveType });
      res.status(201).json(row);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.patch('/api/schedules/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Schedule id required' });
        return;
      }
      const row = getScheduledJob(id);
      if (!row) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }
      const { name, description, cron_expression, task_type, payload, prompt, delivery, provider, model, enabled } = req.body || {};
      const updates: {
        name?: string;
        description?: string;
        cron_expression?: string;
        task_type?: string;
        payload?: string | null;
        prompt?: string | null;
        delivery?: string | null;
        provider?: string | null;
        model?: string | null;
        enabled?: number;
      } = {};
      if (typeof name === 'string') updates.name = name;
      if (typeof description === 'string') updates.description = description;
      if (typeof cron_expression === 'string') updates.cron_expression = cron_expression;
      if (typeof task_type === 'string') updates.task_type = task_type;
      if (payload !== undefined) updates.payload = payload == null ? null : JSON.stringify(payload);
      if (prompt !== undefined) updates.prompt = prompt == null ? null : String(prompt).trim() || null;
      if (delivery !== undefined) updates.delivery = delivery == null ? null : JSON.stringify(delivery);
      if (provider !== undefined) updates.provider = provider == null ? null : (typeof provider === 'string' ? provider.trim() || null : null);
      if (model !== undefined) updates.model = model == null ? null : (typeof model === 'string' ? model.trim() || null : null);
      if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
      updateScheduledJob(id, updates);
      unscheduleJob(id);
      const updated = getScheduledJob(id)!;
      if (updated.enabled) {
        if (updated.prompt?.trim()) {
          const deliveryList = updated.delivery?.trim() ? JSON.parse(updated.delivery) as { channel: string; target?: string }[] : [];
          const agentPayload: Record<string, unknown> = {
            jobId: id,
            name: updated.name || id,
            prompt: updated.prompt,
            delivery: deliveryList,
          };
          const prov = (updated as { provider?: string | null }).provider;
          const mod = (updated as { model?: string | null }).model;
          if (prov?.trim()) agentPayload.provider = prov.trim();
          if (mod?.trim()) agentPayload.model = mod.trim();
          scheduleCronById(id, updated.cron_expression, 'agent_job', agentPayload);
        } else {
          const payloadVal = updated.payload ? JSON.parse(updated.payload) : null;
          scheduleCronById(id, updated.cron_expression, updated.task_type, payloadVal);
        }
      }
      log('gateway', 'info', 'Schedule updated', { id });
      res.json(updated);
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete('/api/schedules/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Schedule id required' });
        return;
      }
      const row = getScheduledJob(id);
      if (!row) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }
      unscheduleJob(id);
      deleteScheduledJob(id);
      log('gateway', 'info', 'Schedule deleted', { id });
      res.status(204).send();
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Run a scheduled job immediately (test run). */
  app.post('/api/schedules/:id/run', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Schedule id required' });
        return;
      }
      const row = getScheduledJob(id);
      if (!row) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }
      let payload: unknown;
      let taskType: string;
      if (row.prompt?.trim()) {
        const deliveryList = row.delivery?.trim() ? JSON.parse(row.delivery) as { channel: string; target?: string }[] : [];
        const r = row as { provider?: string | null; model?: string | null };
        const agentPayload: Record<string, unknown> = { jobId: id, name: row.name || id, prompt: row.prompt, delivery: deliveryList };
        if (r.provider?.trim()) agentPayload.provider = r.provider.trim();
        if (r.model?.trim()) agentPayload.model = r.model.trim();
        payload = agentPayload;
        taskType = 'agent_job';
      } else {
        payload = row.payload ? JSON.parse(row.payload) : null;
        taskType = row.task_type;
      }
      const taskId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      insertTask({ id: taskId, type: taskType, payload, scheduled_at: Date.now() });
      const enqueueTaskId = (app.locals as AppLocals).enqueueTaskId;
      if (typeof enqueueTaskId === 'function') enqueueTaskId(taskId);
      log('gateway', 'info', 'Schedule test run enqueued', { scheduleId: id, taskId });
      res.status(201).json({ id: taskId, type: taskType, status: 'pending' });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Get run history for a scheduled job. */
  app.get('/api/schedules/:id/runs', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'Schedule id required' });
        return;
      }
      const row = getScheduledJob(id);
      if (!row) {
        res.status(404).json({ error: 'Schedule not found' });
        return;
      }
      const limit = Math.min(parseInt((req.query.limit as string) || '30', 10), 100);
      const runs = getTasksForJob(id, limit);
      res.json({ runs });
    } catch (e) {
      log('gateway', 'error', (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Chat attachments: upload image/file, get a URL the agent can use (e.g. for Facebook photo posts). */
  const uploadsDir = join(projectRoot, 'uploads');
  const ALLOWED_EXT = /\.(jpg|jpeg|png|gif|webp)$/i;
  app.post(
    '/api/upload',
    express.json({ limit: '10mb' }),
    (req: Request, res: Response) => {
      try {
        const { filename, data } = req.body || {};
        if (typeof data !== 'string') {
          res.status(400).json({ error: 'Missing or invalid body: { filename, data (base64) }' });
          return;
        }
        const base = typeof filename === 'string' ? filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) : 'file';
        const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
        const safeExt = ALLOWED_EXT.test(ext) ? ext : '.jpg';
        const name = `${randomBytes(8).toString('hex')}${safeExt}`;
        if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
        const path = join(uploadsDir, name);
        const buf = Buffer.from(data, 'base64');
        if (buf.length > 8 * 1024 * 1024) {
          res.status(400).json({ error: 'File too large (max 8MB)' });
          return;
        }
        writeFileSync(path, buf);
        const host = req.get('host') || `${config.host}:${config.port}`;
        const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
        const url = `${protocol}://${host}/api/uploads/${name}`;
        res.json({ url, name });
      } catch (e) {
        log('gateway', 'error', (e as Error).message);
        res.status(500).json({ error: (e as Error).message });
      }
    }
  );
  app.get('/api/uploads/:name', (req: Request, res: Response) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    if (!name || !/^[a-f0-9]{16}\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
      res.status(400).json({ error: 'Invalid upload name' });
      return;
    }
    const path = join(uploadsDir, name);
    if (!existsSync(path)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path, { maxAge: 86400 * 7 }, (err) => {
      if (err) res.status(500).json({ error: (err as Error).message });
    });
  });

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    // Explicitly serve dashboard (new step-by-step OnboardingFlow) for /onboard so URL stays /onboard
    app.get('/onboard', (_req: Request, res: Response) => {
      res.sendFile(join(dashboardDist, 'index.html'));
    });
    app.get(/^\/(?!api|health|ws)/, (_req: Request, res: Response) => {
      res.sendFile(join(dashboardDist, 'index.html'));
    });
  } else {
    // Dashboard not built or not present. Serve a short message; API and /health still work.
    log('gateway', 'warn', 'Dashboard not found at dashboard/dist', { dashboardDist });
    const noDashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sulala — Dashboard not built</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;color:#374151;}
h1{font-size:1.25rem;}p{font-size:0.875rem;color:#6b7280;}code{background:#f3f4f6;padding:0.2em 0.4em;border-radius:4px;}
a{color:#2563eb;}</style></head>
<body>
<h1>Dashboard not built</h1>
<p>Build the dashboard from the agent directory: <code>npm run dashboard:build</code> then restart. Or install from npm: <code>curl -fsSL https://sulala.ai/install.sh | bash</code>.</p>
<p>API is available at <a href="/health">/health</a>.</p>
</body>
</html>`;
    app.get('/onboard', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(noDashboardHtml);
    });
    app.get(/^\/(?!api|health|ws|onboard)/, (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(noDashboardHtml);
    });
  }

  return app;
}

export function attachWebSocket(
  server: ReturnType<typeof createServer>,
  onConnection: (ws: WebSocket) => void = () => {}
): { wss: WebSocketServer; broadcast: (data: unknown) => void } {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = (data: unknown): void => {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(msg);
    });
  };
  wss.on('connection', (ws) => {
    onConnection(ws);
    ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
  });
  return { wss, broadcast };
}

export function startGateway(): { app: Express; server: ReturnType<typeof createServer> } {
  const app = createGateway();
  const server = createServer(app);
  const { broadcast } = attachWebSocket(server, (ws) => {
    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString()) as { type?: string };
        if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      } catch {
        // ignore
      }
    });
  });
  (app.locals as AppLocals).wsBroadcast = broadcast;
  server.listen(config.port, config.host, () => {
    console.log(`Sulala gateway http://${config.host}:${config.port} (WS /ws)`);
  });
  return { app, server };
}

if (process.argv[1]?.includes('server')) {
  (async () => {
    await initDb(config.dbPath);
    startGateway();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
