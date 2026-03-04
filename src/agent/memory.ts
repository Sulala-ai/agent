/**
 * Agent memory: session-scoped and optional shared (cross-session) durable notes.
 * Used for prompt injection and by write_memory / read_memory tools.
 */
import {
  getAgentMemoryForContext,
  appendAgentMemory,
  listAgentMemories,
  getAgentSessionById,
} from '../db/index.js';
import { config } from '../config.js';

export type MemoryScope = 'session' | 'shared';

/** Resolve the scope_key for shared memory: config override or session's session_key. */
export function getSharedScopeKeyForSession(sessionId: string): string | null {
  const session = getAgentSessionById(sessionId);
  if (!session) return null;
  if (config.agentSharedMemoryKey) return config.agentSharedMemoryKey;
  return session.session_key;
}

/** Get memory content for prompt injection (bullets, newest within limit/maxChars). */
export function getMemoryForContext(
  scope: MemoryScope,
  scopeKey: string,
  options: { limit?: number; maxChars?: number } = {}
): string {
  return getAgentMemoryForContext(scope, scopeKey, options);
}

/** Append one memory entry (used by write_memory tool). */
export function appendMemory(
  scope: MemoryScope,
  scopeKey: string,
  content: string
): { id: number; scope: string; scope_key: string } {
  const row = appendAgentMemory(scope, scopeKey, content);
  return { id: row.id, scope: row.scope, scope_key: row.scope_key };
}

/** List recent memory entries (used by read_memory tool). */
export function listMemories(
  scope: MemoryScope,
  scopeKey: string,
  limit = 50
): Array<{ id: number; content: string; created_at: number }> {
  return listAgentMemories(scope, scopeKey, limit).map((r) => ({
    id: r.id,
    content: r.content,
    created_at: r.created_at,
  }));
}
