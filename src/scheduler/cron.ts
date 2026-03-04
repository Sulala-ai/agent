import cron from 'node-cron';
import { log, insertTask } from '../db/index.js';
import { enqueue } from './queue.js';

const jobs = new Map<string, ReturnType<typeof cron.schedule>>();

export type TaskHandler = (task: {
  id: string;
  type: string;
  payload: unknown;
  retry_count: number;
  max_retries: number;
}) => Promise<void>;

/**
 * Schedule a cron expression to enqueue a task type (with optional payload).
 * Each run inserts a row into the DB and enqueues the task.
 */
export function scheduleCron(
  expression: string,
  type: string,
  payload: unknown = null
): ReturnType<typeof cron.schedule> {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const task = cron.schedule(expression, () => {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    insertTask({ id, type, payload, scheduled_at: Date.now() });
    enqueue(id);
    log('scheduler', 'info', `Cron enqueued: ${type}`, { id });
  });
  jobs.set(`${expression}:${type}`, task);
  return task;
}

/**
 * Schedule a cron job by id (for DB/config-driven jobs). Can be unscheduled with unscheduleJob(id).
 */
export function scheduleCronById(
  id: string,
  expression: string,
  type: string,
  payload: unknown = null
): ReturnType<typeof cron.schedule> {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const key = `job:${id}`;
  const existing = jobs.get(key);
  if (existing) {
    existing.stop();
    jobs.delete(key);
  }
  const task = cron.schedule(expression, () => {
    const taskId = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    insertTask({ id: taskId, type, payload, scheduled_at: Date.now() });
    enqueue(taskId);
    log('scheduler', 'info', `Scheduled job enqueued: ${id} -> ${type}`, { taskId });
  });
  jobs.set(key, task);
  return task;
}

/**
 * Remove a scheduled job by id (from scheduleCronById).
 */
export function unscheduleJob(id: string): void {
  const key = `job:${id}`;
  const task = jobs.get(key);
  if (task) {
    task.stop();
    jobs.delete(key);
  }
}

/**
 * Schedule a cron that runs the task handler directly without persisting to the DB.
 * Use for high-frequency types (e.g. heartbeat) to avoid filling the tasks table.
 */
export function scheduleCronEphemeral(
  expression: string,
  type: string,
  payload: unknown | (() => unknown) = null,
  handler: TaskHandler
): ReturnType<typeof cron.schedule> {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const key = `ephemeral:${expression}:${type}`;
  const task = cron.schedule(expression, () => {
    const id = `heartbeat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const payloadValue = typeof payload === 'function' ? (payload as () => unknown)() : payload;
    const synthetic = {
      id,
      type,
      payload: payloadValue,
      retry_count: 0,
      max_retries: 3,
    };
    handler(synthetic).catch((err) => {
      log('scheduler', 'error', `Ephemeral cron failed: ${type}`, { error: String(err) });
    });
  });
  jobs.set(key, task);
  return task;
}

export async function loadAndRunPending(): Promise<void> {
  const { loadPendingFromDb } = await import('./queue.js');
  const n = loadPendingFromDb();
  if (n > 0) log('scheduler', 'info', `Loaded ${n} pending tasks into queue`);
}

export function stopAll(): void {
  jobs.forEach((task) => task.stop());
  jobs.clear();
}
