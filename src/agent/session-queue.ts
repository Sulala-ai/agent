/**
 * Per-session lock: only one agent run per session at a time.
 * Concurrent requests for the same session are serialized.
 */
const sessionTails = new Map<string, Promise<void>>();

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionTails.get(sessionId) ?? Promise.resolve();
  const myRun = prev.then(
    () => fn(),
    () => fn()
  );
  const tail = myRun.then(
    () => {},
    () => {}
  );
  sessionTails.set(sessionId, tail);
  return myRun;
}
