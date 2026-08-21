/**
 * A circuit breaker, as a pure state machine.
 *
 * No timers and no clock of its own — every method takes `now`. That is what
 * makes it testable without waiting, and it is also what makes it correct:
 * a breaker that reads the clock itself cannot be reasoned about at a
 * boundary, and the boundaries are the whole behaviour.
 *
 * What it is *for* here is narrower than the usual framing. The vendor being
 * down is not the problem — a failed routing call already falls back to a
 * straight-line estimate, so the family still sees a number. The problem is
 * the **five seconds each failed call takes**. A position report arrives every
 * few seconds per ride; with a hundred rides in the air, a vendor that hangs
 * turns into a hundred sockets waiting on a timeout, and the API stops being
 * able to do anything else. The breaker exists to make the second, third and
 * thousandth failure free.
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen';

export interface CircuitOptions {
  /**
   * Consecutive failures before the circuit opens.
   *
   * Consecutive rather than a rate: a routing vendor's failures are not
   * independent events. Either it is answering or it is not, and three in a
   * row is the difference between one dropped packet and an outage.
   */
  failureThreshold: number;

  /** How long to stop calling before letting one request through. */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT: CircuitOptions = {
  failureThreshold: 3,
  cooldownMs: 30_000,
};

/**
 * The breaker's whole state. Plain data, so a caller may hold it wherever it
 * likes — in a field, in a map keyed by vendor, or nowhere at all.
 */
export interface CircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  /** Epoch milliseconds of the failure that opened it, or null. */
  openedAt: number | null;
}

export function newCircuit(): CircuitSnapshot {
  return { state: 'closed', consecutiveFailures: 0, openedAt: null };
}

/**
 * Whether a call may go out, and the state to hold while it does.
 *
 * Returns a new snapshot as well as the answer because asking the question is
 * itself a transition: an open circuit whose cooldown has expired becomes
 * half-open by being asked, and that must be recorded or every caller in the
 * cooldown window would be let through at once — which is the stampede the
 * breaker exists to prevent.
 */
export function attempt(
  circuit: CircuitSnapshot,
  now: number,
  options: CircuitOptions = DEFAULT_CIRCUIT,
): { allowed: boolean; circuit: CircuitSnapshot } {
  if (circuit.state === 'closed') return { allowed: true, circuit };

  if (circuit.state === 'halfOpen') {
    // One trial request at a time. Anything else would send the full load at a
    // vendor that has just been failing, which is how a recovering service is
    // knocked over again.
    return { allowed: false, circuit };
  }

  // `openedAt` is always set alongside `open` by the functions here, but a
  // snapshot can arrive from anywhere. Treating a missing timestamp as "the
  // cooldown has passed" is the recoverable reading — the alternative, an
  // elapsed time of zero, is a breaker that never opens the door again.
  if (circuit.openedAt !== null && now - circuit.openedAt < options.cooldownMs) {
    return { allowed: false, circuit };
  }

  return {
    allowed: true,
    circuit: { ...circuit, state: 'halfOpen' },
  };
}

/** A call came back. The circuit closes, whatever it was. */
export function recordSuccess(_circuit: CircuitSnapshot): CircuitSnapshot {
  return newCircuit();
}

/**
 * A call failed.
 *
 * A failure while half-open re-opens immediately rather than counting towards
 * the threshold again: the trial request *was* the test, and failing it is a
 * complete answer.
 */
export function recordFailure(
  circuit: CircuitSnapshot,
  now: number,
  options: CircuitOptions = DEFAULT_CIRCUIT,
): CircuitSnapshot {
  if (circuit.state === 'halfOpen') {
    return {
      state: 'open',
      consecutiveFailures: circuit.consecutiveFailures + 1,
      openedAt: now,
    };
  }

  const consecutiveFailures = circuit.consecutiveFailures + 1;
  if (consecutiveFailures >= options.failureThreshold) {
    return { state: 'open', consecutiveFailures, openedAt: now };
  }

  return { state: 'closed', consecutiveFailures, openedAt: null };
}
