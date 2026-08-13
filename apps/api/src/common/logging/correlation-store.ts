import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  correlationId: string;
  userId?: string;
}

/**
 * Per-request state that every log line needs and no function signature should
 * have to carry.
 *
 * The alternative — threading a context object from the controller down to
 * whatever finally logs — works right up until someone adds a log line in a
 * helper three layers deep and does not want to change four signatures to do
 * it. They then log without a correlation id, and that one line is the one
 * support needs.
 */
const storage = new AsyncLocalStorage<RequestStore>();

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Recorded once the auth guard has resolved the caller, so log lines emitted
 * after authentication carry the actor. Never the email — the id only.
 */
export function setCurrentUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

export function currentUserId(): string | undefined {
  return storage.getStore()?.userId;
}
