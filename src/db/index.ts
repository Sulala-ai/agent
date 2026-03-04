import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { InsertTaskPayload, AgentSessionRow, AgentMessageRow } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function initDb(path = './data/sulala.db'): Database.Database {
  if (db) return db;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(path);
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  // Migration: add usage and cost_usd columns to agent_messages if missing
  try {
    const info = db.prepare("PRAGMA table_info(agent_messages)").all() as { name: string }[];
    if (!info.some((c) => c.name === 'usage')) {
      db.exec('ALTER TABLE agent_messages ADD COLUMN usage TEXT');
    }
    if (!info.some((c) => c.name === 'cost_usd')) {
      db.exec('ALTER TABLE agent_messages ADD COLUMN cost_usd REAL');
    }
  } catch {
    // ignore
  }
  // Migration: agent_memory table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memory_scope_key ON agent_memory(scope, scope_key);
    `);
  } catch {
    // ignore
  }
  // Migration: scheduled_jobs table and columns
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        cron_expression TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'agent_job',
        payload TEXT,
        prompt TEXT,
        delivery TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_enabled ON scheduled_jobs(enabled);
    `);
    const jobCols = db.prepare("PRAGMA table_info(scheduled_jobs)").all() as { name: string }[];
    if (!jobCols.some((c) => c.name === 'name')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN name TEXT NOT NULL DEFAULT \'\'');
    if (!jobCols.some((c) => c.name === 'description')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN description TEXT NOT NULL DEFAULT \'\'');
    if (!jobCols.some((c) => c.name === 'prompt')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN prompt TEXT');
    if (!jobCols.some((c) => c.name === 'delivery')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN delivery TEXT');
    if (!jobCols.some((c) => c.name === 'provider')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN provider TEXT');
    if (!jobCols.some((c) => c.name === 'model')) db.exec('ALTER TABLE scheduled_jobs ADD COLUMN model TEXT');
  } catch {
    // ignore
  }
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized; call initDb first');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function log(
  source: string,
  level: string,
  message: string,
  meta: object | null | undefined = null
): void {
  const d = getDb();
  d.prepare(
    'INSERT INTO logs (source, level, message, meta, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(source, level, message, meta ? JSON.stringify(meta) : null, Date.now());
}

export function getChannelConfig(channel: string): string | null {
  const d = getDb();
  const row = d.prepare('SELECT config FROM channel_config WHERE channel = ?').get(channel) as { config: string } | undefined;
  return row?.config ?? null;
}

export function setChannelConfig(channel: string, config: string): void {
  const d = getDb();
  const now = Date.now();
  d.prepare(
    'INSERT INTO channel_config (channel, config, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel) DO UPDATE SET config = ?, updated_at = ?'
  ).run(channel, config, now, config, now);
}

export function insertTask(task: InsertTaskPayload): InsertTaskPayload {
  const d = getDb();
  const now = Date.now();
  d.prepare(`
    INSERT INTO tasks (id, type, payload, status, scheduled_at, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)
  `).run(
    task.id,
    task.type,
    task.payload ? JSON.stringify(task.payload) : null,
    task.scheduled_at ?? null,
    task.max_retries ?? 3,
    now,
    now
  );
  return task;
}

export function updateTaskStatus(id: string, status: string, error: string | null = null): void {
  const d = getDb();
  const now = Date.now();
  const finished = status === 'done' || status === 'failed' || status === 'cancelled';
  d.prepare(`
    UPDATE tasks SET status = ?, error = ?, updated_at = ?, finished_at = ?
    WHERE id = ?
  `).run(status, error, now, finished ? now : null, id);
}

export function setTaskPendingForRetry(id: string): void {
  const d = getDb();
  const now = Date.now();
  d.prepare(`
    UPDATE tasks SET status = 'pending', error = NULL, retry_count = 0, updated_at = ?, finished_at = NULL
    WHERE id = ?
  `).run(now, id);
}

export function upsertFileState(
  path: string,
  mtimeMs: number,
  size: number | null = null,
  hash: string | null = null,
  meta: Record<string, unknown> | null = null
): void {
  const d = getDb();
  const now = Date.now();
  d.prepare(`
    INSERT INTO file_states (path, mtime_ms, size, hash, last_seen, meta)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET mtime_ms = ?, size = ?, hash = ?, last_seen = ?, meta = ?
  `).run(
    path,
    mtimeMs,
    size,
    hash,
    now,
    meta ? JSON.stringify(meta) : null,
    mtimeMs,
    size,
    hash,
    now,
    meta ? JSON.stringify(meta) : null
  );
}

export function saveAiResult(record: {
  id: string;
  provider: string;
  model?: string | null;
  task_id?: string | null;
  request_meta?: unknown;
  response_meta?: unknown;
}): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO ai_results (id, provider, model, task_id, request_meta, response_meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.provider,
    record.model ?? null,
    record.task_id ?? null,
    record.request_meta ? JSON.stringify(record.request_meta) : null,
    record.response_meta ? JSON.stringify(record.response_meta) : null,
    Date.now()
  );
}

export interface FileStateRow {
  path: string;
  mtime_ms: number;
  size: number | null;
  hash: string | null;
  last_seen: number;
  meta: string | null;
}

export function getFileStates(limit = 200): FileStateRow[] {
  const d = getDb();
  return d.prepare('SELECT * FROM file_states ORDER BY last_seen DESC LIMIT ?').all(limit) as FileStateRow[];
}

// --- Agent sessions ---

export function createAgentSession(sessionKey: string, meta: Record<string, unknown> | null = null): AgentSessionRow {
  const d = getDb();
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  d.prepare(
    'INSERT INTO agent_sessions (id, session_key, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, sessionKey, meta ? JSON.stringify(meta) : null, now, now);
  return { id, session_key: sessionKey, meta: meta ? JSON.stringify(meta) : null, created_at: now, updated_at: now };
}

export function getAgentSessionById(id: string): AgentSessionRow | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as AgentSessionRow | undefined;
  return row ?? null;
}

export function getAgentSessionByKey(sessionKey: string): AgentSessionRow | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM agent_sessions WHERE session_key = ?').get(sessionKey) as AgentSessionRow | undefined;
  return row ?? null;
}

export function listAgentSessions(limit = 50): AgentSessionRow[] {
  const d = getDb();
  return d.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as AgentSessionRow[];
}

export function getOrCreateAgentSession(sessionKey: string, meta?: Record<string, unknown> | null): AgentSessionRow {
  const existing = getAgentSessionByKey(sessionKey);
  if (existing) return existing;
  return createAgentSession(sessionKey, meta ?? null);
}

export function appendAgentMessage(msg: {
  session_id: string;
  role: string;
  content?: string | null;
  tool_calls?: string | null;
  tool_call_id?: string | null;
  name?: string | null;
  usage?: Record<string, number> | null;
  model?: string | null;
  cost_usd?: number | null;
}): AgentMessageRow {
  const d = getDb();
  const now = Date.now();
  d.prepare(
    'UPDATE agent_sessions SET updated_at = ? WHERE id = ?'
  ).run(now, msg.session_id);
  const usageJson = msg.usage != null ? JSON.stringify(msg.usage) : null;
  const costUsd = msg.cost_usd ?? null;
  d.prepare(
    `INSERT INTO agent_messages (session_id, role, content, tool_calls, tool_call_id, name, created_at, usage, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.session_id,
    msg.role,
    msg.content ?? null,
    msg.tool_calls ?? null,
    msg.tool_call_id ?? null,
    msg.name ?? null,
    now,
    usageJson,
    costUsd
  );
  const row = d.prepare('SELECT * FROM agent_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1')
    .get(msg.session_id) as AgentMessageRow & { id: number };
  return { ...row, created_at: row.created_at };
}

export function getAgentMessages(sessionId: string, limit = 100): AgentMessageRow[] {
  const d = getDb();
  return d.prepare(
    'SELECT * FROM agent_messages WHERE session_id = ? ORDER BY id ASC LIMIT ?'
  ).all(sessionId, limit) as (AgentMessageRow & { id: number })[];
}

/** Update content of the tool message for this tool_call_id (used when replacing pending-approval placeholder with real result). */
export function updateAgentMessageToolResult(
  sessionId: string,
  toolCallId: string,
  content: string,
): boolean {
  const d = getDb();
  const result = d.prepare(
    'UPDATE agent_messages SET content = ? WHERE session_id = ? AND role = ? AND tool_call_id = ?'
  ).run(content, sessionId, 'tool', toolCallId);
  return (result as { changes: number }).changes > 0;
}

// --- Agent memory (session + shared) ---

export interface AgentMemoryRow {
  id: number;
  scope: string;
  scope_key: string;
  content: string;
  created_at: number;
}

export function appendAgentMemory(scope: 'session' | 'shared', scopeKey: string, content: string): AgentMemoryRow {
  const d = getDb();
  const now = Date.now();
  d.prepare(
    'INSERT INTO agent_memory (scope, scope_key, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(scope, scopeKey, content.trim(), now);
  const row = d.prepare('SELECT * FROM agent_memory WHERE id = last_insert_rowid()').get() as AgentMemoryRow;
  return row;
}

export function listAgentMemories(
  scope: 'session' | 'shared',
  scopeKey: string,
  limit = 50
): AgentMemoryRow[] {
  const d = getDb();
  return d.prepare(
    'SELECT * FROM agent_memory WHERE scope = ? AND scope_key = ? ORDER BY id DESC LIMIT ?'
  ).all(scope, scopeKey, limit) as AgentMemoryRow[];
}

/** Returns a single string suitable for injection into the system prompt (bullets or markdown). */
export function getAgentMemoryForContext(
  scope: 'session' | 'shared',
  scopeKey: string,
  options: { limit?: number; maxChars?: number } = {}
): string {
  const limit = options.limit ?? (scope === 'session' ? 20 : 30);
  const maxChars = options.maxChars ?? (scope === 'session' ? 2000 : 3000);
  const rows = listAgentMemories(scope, scopeKey, limit);
  const lines: string[] = [];
  let total = 0;
  for (let i = rows.length - 1; i >= 0 && total < maxChars; i--) {
    const line = rows[i].content.trim();
    if (line) {
      lines.push(`- ${line}`);
      total += line.length + 4;
    }
  }
  return lines.join('\n');
}

/** Distinct scope_key values per scope (for UI: list which sessions/keys have memory). */
export function listAgentMemoryScopeKeys(): { session: string[]; shared: string[] } {
  const d = getDb();
  const session = d.prepare(
    "SELECT DISTINCT scope_key FROM agent_memory WHERE scope = 'session' ORDER BY scope_key"
  ).all() as { scope_key: string }[];
  const shared = d.prepare(
    "SELECT DISTINCT scope_key FROM agent_memory WHERE scope = 'shared' ORDER BY scope_key"
  ).all() as { scope_key: string }[];
  return {
    session: session.map((r) => r.scope_key),
    shared: shared.map((r) => r.scope_key),
  };
}

// --- Scheduled jobs ---

export interface ScheduledJobRow {
  id: string;
  name: string;
  description: string;
  cron_expression: string;
  task_type: string;
  payload: string | null;
  prompt: string | null;
  delivery: string | null;
  provider: string | null;
  model: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export function listScheduledJobs(enabledOnly = false): ScheduledJobRow[] {
  const d = getDb();
  if (enabledOnly) {
    return d.prepare('SELECT * FROM scheduled_jobs WHERE enabled = 1 ORDER BY created_at ASC').all() as ScheduledJobRow[];
  }
  return d.prepare('SELECT * FROM scheduled_jobs ORDER BY created_at ASC').all() as ScheduledJobRow[];
}

export function getScheduledJob(id: string): ScheduledJobRow | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as ScheduledJobRow | undefined;
  return row ?? null;
}

export function insertScheduledJob(row: {
  id: string;
  name?: string;
  description?: string;
  cron_expression: string;
  task_type?: string;
  payload?: string | null;
  prompt?: string | null;
  delivery?: string | null;
  provider?: string | null;
  model?: string | null;
  enabled?: number;
}): ScheduledJobRow {
  const d = getDb();
  const now = Date.now();
  d.prepare(`
    INSERT INTO scheduled_jobs (id, name, description, cron_expression, task_type, payload, prompt, delivery, provider, model, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.name ?? '',
    row.description ?? '',
    row.cron_expression,
    row.task_type ?? 'agent_job',
    row.payload ?? null,
    row.prompt ?? null,
    row.delivery ?? null,
    row.provider ?? null,
    row.model ?? null,
    row.enabled ?? 1,
    now,
    now
  );
  return getScheduledJob(row.id)!;
}

export function updateScheduledJob(
  id: string,
  updates: {
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
  }
): void {
  const d = getDb();
  const now = Date.now();
  const current = getScheduledJob(id);
  if (!current) return;
  const name = updates.name !== undefined ? updates.name : current.name;
  const description = updates.description !== undefined ? updates.description : current.description;
  const cron_expression = updates.cron_expression ?? current.cron_expression;
  const task_type = updates.task_type ?? current.task_type;
  const payload = updates.payload !== undefined ? updates.payload : current.payload;
  const prompt = updates.prompt !== undefined ? updates.prompt : current.prompt;
  const delivery = updates.delivery !== undefined ? updates.delivery : current.delivery;
  const provider = updates.provider !== undefined ? updates.provider : (current as { provider?: string | null }).provider ?? null;
  const model = updates.model !== undefined ? updates.model : (current as { model?: string | null }).model ?? null;
  const enabled = updates.enabled !== undefined ? updates.enabled : current.enabled;
  d.prepare(`
    UPDATE scheduled_jobs SET name = ?, description = ?, cron_expression = ?, task_type = ?, payload = ?, prompt = ?, delivery = ?, provider = ?, model = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(name, description, cron_expression, task_type, payload, prompt, delivery, provider, model, enabled, now, id);
}

export function deleteScheduledJob(id: string): void {
  const d = getDb();
  d.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
}

/** Get recent task runs for a scheduled job (agent_job tasks with matching jobId in payload). */
export function getTasksForJob(jobId: string, limit = 50): Array<{
  id: string;
  type: string;
  payload: string | null;
  status: string;
  scheduled_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  retry_count: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}> {
  const d = getDb();
  const pattern = `%"jobId":"${jobId.replace(/"/g, '""')}"%`;
  return d.prepare(
    `SELECT id, type, payload, status, scheduled_at, started_at, finished_at, retry_count, error, created_at, updated_at
     FROM tasks WHERE type = 'agent_job' AND payload LIKE ? ORDER BY created_at DESC LIMIT ?`
  ).all(pattern, limit) as Array<{
    id: string;
    type: string;
    payload: string | null;
    status: string;
    scheduled_at: number | null;
    started_at: number | null;
    finished_at: number | null;
    retry_count: number;
    error: string | null;
    created_at: number;
    updated_at: number;
  }>;
}
