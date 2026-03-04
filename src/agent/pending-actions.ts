/**
 * Execution preview: store pending tool actions that require user approval.
 * In-memory store; pending actions are lost on process restart.
 */
import { randomBytes } from 'crypto';

export type PendingActionStatus = 'pending' | 'approved' | 'rejected';

export type PendingAction = {
  id: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: PendingActionStatus;
  createdAt: number;
  result?: unknown;
};

const store = new Map<string, PendingAction>();

function generateId(): string {
  return randomBytes(8).toString('hex');
}

/** Redact secret-like keys from args for API display only. */
export function sanitizeArgsForDisplay(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const secretPattern = /password|secret|key|token|auth/i;
  for (const [k, v] of Object.entries(args)) {
    if (secretPattern.test(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? '[REDACTED]' : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createPendingAction(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): string {
  const id = generateId();
  store.set(id, {
    id,
    sessionId,
    toolCallId,
    toolName,
    args: { ...args },
    status: 'pending',
    createdAt: Date.now(),
  });
  return id;
}

export function getPendingAction(id: string): PendingAction | undefined {
  return store.get(id);
}

export function listPendingActions(sessionId?: string): PendingAction[] {
  const list = [...store.values()].filter((a) => a.status === 'pending');
  if (sessionId) return list.filter((a) => a.sessionId === sessionId);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export function setPendingActionApproved(id: string, result: unknown): void {
  const a = store.get(id);
  if (a) {
    a.status = 'approved';
    a.result = result;
  }
}

export function setPendingActionRejected(id: string): void {
  const a = store.get(id);
  if (a) a.status = 'rejected';
}

/** Get pending action for replay (execute tool on approve). Returns original args. */
export function getPendingActionForReplay(id: string): PendingAction | null {
  const a = store.get(id);
  if (!a || a.status !== 'pending') return null;
  return a;
}
