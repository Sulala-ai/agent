import chokidar, { type FSWatcher } from 'chokidar';
import { statSync } from 'fs';
import type { Stats } from 'fs';
import { config } from '../config.js';
import { initDb, getDb, log, upsertFileState, insertTask } from '../db/index.js';
import { getWatchFoldersFromAutomations } from '../workspace-automations.js';
import { enqueue } from '../scheduler/queue.js';

export interface FileEventPayload {
  event: string;
  path: string;
  ts: number;
  mtimeMs?: number;
  size?: number;
}

let watcher: FSWatcher | null = null;
let eventCallback: ((payload: FileEventPayload) => void) | null = null;

export function setEventCallback(fn: (payload: FileEventPayload) => void): void {
  eventCallback = fn;
}

function normalizeEvent(event: string, path: string, stats: Stats | null = null): FileEventPayload {
  const payload: FileEventPayload = { event, path, ts: Date.now() };
  if (stats) {
    payload.mtimeMs = stats.mtimeMs;
    payload.size = stats.size;
  }
  return payload;
}

function emit(event: string, path: string, stats: Stats | null): FileEventPayload | void {
  const payload = normalizeEvent(event, path, stats);
  try {
    getDb();
    if (event !== 'unlink' && payload.mtimeMs != null) {
      upsertFileState(path, payload.mtimeMs, payload.size ?? null);
    }
    console.log('[watcher] File', event + ':', path);
    log('watcher', 'info', `${event}: ${path}`, payload);
    if (eventCallback) eventCallback(payload);
    return payload;
  } catch (e) {
    log('watcher', 'error', (e as Error).message, { path, stack: (e as Error).stack });
  }
}

export function startWatcher(
  folders: string[] | null = null,
  options: { ignoreInitial?: boolean } = {}
): FSWatcher | null {
  if (watcher) return watcher;
  initDb(config.dbPath);
  const paths = folders?.length ? folders : config.watchFolders;
  if (!paths.length) {
    console.log('[watcher] Not started — no watch folders configured');
    log('watcher', 'info', 'No watch folders configured; skipping file watcher');
    return null;
  }

  watcher = chokidar.watch(paths, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: options.ignoreInitial !== false,
    ...options,
  });

  watcher
    .on('add', (path: string) => {
      try {
        const stats = statSync(path);
        emit('add', path, stats);
      } catch {
        emit('add', path, null);
      }
    })
    .on('change', (path: string) => {
      try {
        const stats = statSync(path);
        emit('change', path, stats);
      } catch {
        emit('change', path, null);
      }
    })
    .on('unlink', (path: string) => emit('unlink', path, null))
    .on('error', (err: unknown) =>
      log('watcher', 'error', err instanceof Error ? err.message : String(err), err instanceof Error ? { stack: err.stack } : null)
    );

  console.log('[watcher] Started watching', paths.length, 'folder(s):', paths.join(', '));
  log('watcher', 'info', 'Watching folders', { paths });
  return watcher;
}

export function enqueueTaskOnEvent(payload: FileEventPayload): void {
  const taskId = `ev_${payload.ts}_${Math.random().toString(36).slice(2, 9)}`;
  insertTask({
    id: taskId,
    type: 'file_event',
    payload,
    max_retries: 2,
  });
  enqueue(taskId);
}

/** Add paths to the running watcher (e.g. after register_automation). If watcher was never started, starts it with all automation folders + config so new images trigger automations without restart. */
export function addWatchPaths(paths: string[]): void {
  if (!paths.length) return;
  if (!watcher) {
    const automationFolders = getWatchFoldersFromAutomations();
    const allPaths = [...new Set([...config.watchFolders, ...automationFolders])];
    if (!allPaths.length) {
      console.log('[watcher] register_automation: no paths to watch, watcher not started');
      return;
    }
    startWatcher(allPaths);
    console.log('[watcher] Started from register_automation — now watching', allPaths.length, 'folder(s):', allPaths.join(', '));
    log('watcher', 'info', 'Started watcher from register_automation', { paths: allPaths });
    return;
  }
  for (const p of paths) {
    if (p?.trim()) watcher.add(p.trim());
  }
  console.log('[watcher] Added', paths.length, 'path(s) to watcher:', paths.join(', '));
  log('watcher', 'info', 'Added watch paths', { paths });
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
