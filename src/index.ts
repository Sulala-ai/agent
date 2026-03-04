import 'dotenv/config';
import { createServer } from 'http';
import {
  getWatchFoldersFromAutomations,
  runMatchingAutomations,
} from './workspace-automations.js';
import { loadFullConfig } from './agent/skills-config.js';
import { config } from './config.js';
import { initDb, log, getChannelConfig } from './db/index.js';
import { createGateway, attachWebSocket } from './gateway/server.js';
import { startWatcher, setEventCallback, enqueueTaskOnEvent } from './watcher/index.js';
import { setTaskHandler, loadPendingFromDb, enqueue } from './scheduler/queue.js';
import { scheduleCronEphemeral, scheduleCronById } from './scheduler/cron.js';
import { loadSchedulesConfig } from './config.js';
import { listScheduledJobs } from './db/index.js';
import { loadAllPlugins, onFileEvent, onTask } from './plugins/index.js';
import { fireWebhooks } from './webhooks.js';
import { registerBuiltInTools } from './agent/tools.js';
import { startSkillsWatcher } from './agent/skills-watcher.js';
import { ensureOllamaInstalled } from './ollama-setup.js';
import { getOrCreateAgentSession } from './db/index.js';
import { runAgentTurn } from './agent/loop.js';
import { sendTelegramNotification, startTelegramChannel, resolveDefaultProviderAndModel } from './channels/telegram.js';
import type { AppLocals } from './types.js';

type DeliveryTarget = { channel: string; target?: string };

const JOB_DEFAULT_CHANNEL_KEY = 'job_default';

function parseJobDefaultConfig(raw: string | null): { defaultProvider?: string; defaultModel?: string } | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const defaultProvider = typeof o.defaultProvider === 'string' ? o.defaultProvider.trim() || undefined : undefined;
    const defaultModel = typeof o.defaultModel === 'string' ? o.defaultModel.trim() || undefined : undefined;
    if (!defaultProvider && !defaultModel) return null;
    return { defaultProvider, defaultModel };
  } catch {
    return null;
  }
}

async function runAgentJobAndNotify(payload: unknown): Promise<void> {
  const p = payload as { jobId?: string; name?: string; prompt?: string; delivery?: DeliveryTarget[]; provider?: string; model?: string } | null;
  if (!p?.prompt?.trim()) {
    log('worker', 'warn', 'agent_job missing prompt', { payload: p });
    return;
  }
  const jobName = p.name?.trim() || p.jobId || 'Scheduled job';
  const deliveryList = Array.isArray(p.delivery) ? p.delivery : [];
  const sessionKey = `job_${p.jobId ?? 'run'}_${Date.now()}`;
  const session = getOrCreateAgentSession(sessionKey);
  const jobProvider = typeof p.provider === 'string' ? p.provider.trim() || undefined : undefined;
  const jobModel = typeof p.model === 'string' ? p.model.trim() || undefined : undefined;
  const jobDefaultFromDb = parseJobDefaultConfig(getChannelConfig(JOB_DEFAULT_CHANNEL_KEY));
  const { provider, model } = resolveDefaultProviderAndModel({
    provider: jobProvider ?? jobDefaultFromDb?.defaultProvider,
    model: jobModel ?? jobDefaultFromDb?.defaultModel,
  });

  const sendNotification = async (text: string): Promise<void> => {
    for (const d of deliveryList) {
      if (d.channel === 'telegram') {
        await sendTelegramNotification(text);
      }
    }
  };

  try {
    const result = await runAgentTurn({
      sessionId: session.id,
      userMessage: p.prompt.trim(),
      provider,
      model,
      skipToolApproval: true,
    });
    const summary = result.finalContent?.trim()?.slice(0, 2000) || '(No output)';
    const message = `✅ Job «${jobName}» completed.\n\n${summary}`;
    await sendNotification(message);
    log('worker', 'info', `Agent job completed: ${jobName}`, { jobId: p.jobId });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const message = `❌ Job «${jobName}» failed.\n\n${errorMsg.slice(0, 1500)}`;
    await sendNotification(message);
    log('worker', 'error', `Agent job failed: ${jobName}`, { jobId: p.jobId, error: errorMsg });
    throw err;
  }
}

async function main(): Promise<void> {
  await initDb(config.dbPath);
  if (process.env.SULALA_OLLAMA_AUTO_INSTALL === '1') {
    ensureOllamaInstalled();
  } else {
    // Don't auto-install Ollama on startup; user must confirm via UI
    console.log('[Ollama] Auto-install disabled. Install from Settings or ollama.com when needed.');
  }
  // Inject skill config into process.env so run_command (e.g. curl with $PERIGON_API_KEY) sees them
  const full = loadFullConfig();
  const entries = full.skills?.entries;
  if (entries && typeof entries === 'object') {
    for (const entry of Object.values(entries)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'enabled') continue;
        if (typeof value === 'string' && value.trim() && !process.env[key]) process.env[key] = value;
      }
    }
  }
  // Merge allowedBinaries from config into ALLOWED_BINARIES (skills using curl, git, etc.)
  const configBins = full.allowedBinaries;
  if (Array.isArray(configBins) && configBins.length > 0) {
    const envBins = (process.env.ALLOWED_BINARIES || '').split(',').map((b) => b.trim()).filter(Boolean);
    const merged = [...new Set([...envBins, ...configBins.map((b) => String(b).trim().toLowerCase()).filter(Boolean)])];
    process.env.ALLOWED_BINARIES = merged.join(',');
  }
  log('main', 'info', 'Starting Sulala Agent', { port: config.port });

  registerBuiltInTools(enqueue);

  const app = createGateway();
  (app.locals as AppLocals).enqueueTaskId = enqueue;
  const http = createServer(app);
  const { broadcast } = attachWebSocket(http);
  (app.locals as AppLocals).wsBroadcast = broadcast;
  const server = http.listen(config.port, config.host, () => {
    console.log(`Gateway http://${config.host}:${config.port} (WS /ws)`);
  });
  const shutdown = () => {
    log('main', 'info', 'Shutting down');
    server.close(() => {
      log('main', 'info', 'Gateway closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await loadAllPlugins();

  setEventCallback((payload) => {
    onFileEvent(payload);
    enqueueTaskOnEvent(payload);
    broadcast({ type: 'file_event', payload });
    fireWebhooks('file_event', payload);
  });
  const automationFolders = getWatchFoldersFromAutomations();
  const allWatchFolders = [...new Set([...config.watchFolders, ...automationFolders])];
  startWatcher(allWatchFolders.length ? allWatchFolders : null);
  startSkillsWatcher(config, (ev) => broadcast(ev));

  const taskHandler = async (task: {
    id: string;
    type: string;
    payload: unknown;
    retry_count: number;
    max_retries: number;
  }) => {
    const handled = await onTask(task);
    if (handled) return;
    if (task.type === 'agent_job') {
      try {
        await runAgentJobAndNotify(task.payload);
      } catch {
        // already logged and notified; rethrow so queue marks task failed
        throw new Error('Agent job failed');
      }
      broadcast({ type: 'task_done', taskId: task.id });
      fireWebhooks('task_done', { taskId: task.id, type: task.type });
      return;
    }
    if (task.type === 'file_event') {
      const payload = task.payload as { event?: string; path?: string } | null;
      log('worker', 'info', 'File event task', (task.payload ?? null) as Record<string, unknown> | null);
      if (payload?.event && payload?.path) {
        runMatchingAutomations(payload.event, payload.path);
      }
    }
    broadcast({ type: 'task_done', taskId: task.id });
    fireWebhooks('task_done', { taskId: task.id, type: task.type });
  };
  setTaskHandler(taskHandler);

  loadPendingFromDb();
  // Heartbeat runs every minute; ephemeral = no DB row to avoid filling tasks table
  scheduleCronEphemeral('* * * * *', 'heartbeat', () => ({ ts: Date.now() }), taskHandler);

  // Config-driven schedules (config/schedules.json)
  const configSchedules = loadSchedulesConfig();
  configSchedules.forEach((entry, i) => {
    try {
      scheduleCronById(`config_${i}`, entry.cron, entry.type, entry.payload ?? null);
      log('main', 'info', `Scheduled job from config: ${entry.type}`, { cron: entry.cron });
    } catch (e) {
      log('main', 'error', `Invalid schedule config at index ${i}: ${(e as Error).message}`, { cron: entry.cron, type: entry.type });
    }
  });

  // DB-driven schedules (dashboard Jobs): agent jobs (prompt) or legacy (task_type + payload)
  const dbSchedules = listScheduledJobs(true);
  dbSchedules.forEach((row) => {
    try {
      if (row.prompt?.trim()) {
        const delivery = row.delivery?.trim() ? JSON.parse(row.delivery) as DeliveryTarget[] : [];
        const r = row as { provider?: string | null; model?: string | null };
        const payload = {
          jobId: row.id,
          name: row.name || row.id,
          prompt: row.prompt,
          delivery,
          provider: r.provider?.trim() || undefined,
          model: r.model?.trim() || undefined,
        };
        scheduleCronById(row.id, row.cron_expression, 'agent_job', payload);
        log('main', 'info', `Scheduled agent job from DB: ${row.name || row.id}`, { id: row.id });
      } else {
        const payload = row.payload ? JSON.parse(row.payload) : null;
        scheduleCronById(row.id, row.cron_expression, row.task_type, payload);
        log('main', 'info', `Scheduled job from DB: ${row.task_type}`, { id: row.id });
      }
    } catch (e) {
      log('main', 'error', `Invalid scheduled job ${row.id}: ${(e as Error).message}`);
    }
  });

  // Start Telegram bot if enabled and configured (so it stays connected without opening Settings)
  startTelegramChannel();

  log('main', 'info', 'Sulala Agent ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
