/**
 * The life of a relay call. ADR-0014.
 *
 * A click-to-call bridge has two legs and the states follow them: the provider
 * rings the caller's own phone first; when they pick up, it rings the callee
 * and joins the two. Provider callbacks arrive out of order and more than once,
 * so the rule that matters is that **a call only moves forward** — a late
 * "ringing" after "completed" must not reopen it.
 */

export type CallStatusName =
  | 'initiating'
  | 'ringingCaller'
  | 'ringingCallee'
  | 'inProgress'
  | 'completed'
  | 'noAnswer'
  | 'busy'
  | 'failed'
  | 'canceled';

export const CALL_STATUSES: readonly CallStatusName[] = [
  'initiating',
  'ringingCaller',
  'ringingCallee',
  'inProgress',
  'completed',
  'noAnswer',
  'busy',
  'failed',
  'canceled',
];

const TERMINAL: ReadonlySet<CallStatusName> = new Set([
  'completed',
  'noAnswer',
  'busy',
  'failed',
  'canceled',
]);

const RANK: Record<CallStatusName, number> = {
  initiating: 0,
  ringingCaller: 1,
  ringingCallee: 2,
  inProgress: 3,
  completed: 4,
  noAnswer: 4,
  busy: 4,
  failed: 4,
  canceled: 4,
};

export function isTerminalCallStatus(status: CallStatusName): boolean {
  return TERMINAL.has(status);
}

/** Whether a callback reporting `to` should be applied to a call at `from`. */
export function canAdvanceCall(from: CallStatusName, to: CallStatusName): boolean {
  if (isTerminalCallStatus(from)) return false;
  return RANK[to] > RANK[from];
}

/**
 * Whether the callee missed it: their phone rang and nobody answered.
 *
 * A call that ended before the callee's phone ever rang — the caller did not
 * pick up their own leg, or hung up first — is not a missed call for the
 * callee, and telling them they missed one would be a lie with a push
 * notification attached.
 */
export function isMissedByCallee(
  reachedCallee: boolean,
  outcome: CallStatusName,
): boolean {
  return reachedCallee && (outcome === 'noAnswer' || outcome === 'busy');
}

/** The line written into the conversation when a call ends. Content-free by construction. */
export function callSummaryLine(
  outcome: CallStatusName,
  reachedCallee: boolean,
  durationSeconds: number | null,
): string | null {
  switch (outcome) {
    case 'completed': {
      const minutes = Math.max(1, Math.round((durationSeconds ?? 0) / 60));
      return `Call · ${minutes} min`;
    }
    case 'noAnswer':
    case 'busy':
      return reachedCallee ? 'Missed call' : null;
    case 'failed':
      return 'Call could not be connected';
    default:
      // A caller who hangs up on their own leg has not made a call worth recording.
      return null;
  }
}
