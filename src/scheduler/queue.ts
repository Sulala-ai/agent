import { getDb, log, updateTaskStatus } from '../db/index.js';
import type { TaskRow } from '../types.js';

const queue: string[] = [];
let processing = false;
let _concurrency = 1;
let taskHandler: ((task: {
  id: string;
  type: string;
  payload: unknown;
  retry_count: number;
  max_retries: number;
}) => Promise<void>) | null = null;

export function setTaskHandler(handler: (task: {
  id: string;
  type: string;
  payload: unknown;
  retry_count: number;
  max_retries: number;
}) => Promise<void>): void {
  taskHandler = handler;
}

export function setConcurrency(n: number): void {
  _concurrency = Math.max(1, parseInt(String(n), 10));
}

export function getConcurrency(): number {
  return _concurrency;
}

export function enqueue(taskId: string): void {
  if (queue.includes(taskId)) return;
  queue.push(taskId);
  processNext();
}

export function loadPendingFromDb(): number {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id FROM tasks WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY created_at ASC"
  ).all(Date.now()) as { id: string }[];
  rows.forEach((r) => enqueue(r.id));
  return rows.length;
}

function processNext(): void {
  if (processing || queue.length === 0) return;
  processing = true;
  const run = async (): Promise<void> => {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const db = getDb();
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
      if (!row || row.status !== 'pending') continue;
      const payload = row.payload ? JSON.parse(row.payload) : null;
      db.prepare(
        "UPDATE tasks SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?"
      ).run(Date.now(), Date.now(), id);
      try {
        if (taskHandler) {
          await taskHandler({
            id,
            type: row.type,
            payload,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
          });
        }
        updateTaskStatus(id, 'done');
        log('queue', 'info', `Task done: ${id}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const retryCount = (row.retry_count || 0) + 1;
        const maxRetries = row.max_retries ?? 3;
        if (retryCount < maxRetries) {
          db.prepare(
            'UPDATE tasks SET status = ?, retry_count = ?, updated_at = ?, error = ? WHERE id = ?'
          ).run('pending', retryCount, Date.now(), errMsg, id);
          enqueue(id);
          log('queue', 'warn', `Task retry ${retryCount}/${maxRetries}: ${id}`, { error: errMsg });
        } else {
          updateTaskStatus(id, 'failed', errMsg);
          log('queue', 'error', `Task failed: ${id}`, { error: errMsg });
        }
      }
    }
    processing = false;
  };
  run();
}

export function getQueueLength(): number {
  return queue.length;
}
