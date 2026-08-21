import {
  DEFAULT_CIRCUIT,
  attempt,
  newCircuit,
  recordFailure,
  recordSuccess,
  type CircuitSnapshot,
} from './circuit-breaker';

/**
 * The breaker.
 *
 * Two properties carry the weight, and both are about what happens *after*
 * things go wrong rather than during. A vendor that hangs must stop costing
 * five seconds a call, and a vendor that has just recovered must not be handed
 * the entire backlog at once.
 */

const T0 = 1_000_000;

function afterFailures(count: number, at = T0): CircuitSnapshot {
  let circuit = newCircuit();
  for (let i = 0; i < count; i++) circuit = recordFailure(circuit, at);
  return circuit;
}

describe('while everything is working', () => {
  it('lets calls through', () => {
    expect(attempt(newCircuit(), T0).allowed).toBe(true);
  });

  it('forgets an isolated failure once a call succeeds', () => {
    // Consecutive, not cumulative. One dropped packet an hour is not an
    // outage, and a breaker that counted them all would eventually open on a
    // perfectly healthy vendor.
    let circuit = recordFailure(newCircuit(), T0);
    circuit = recordFailure(circuit, T0);
    circuit = recordSuccess(circuit);

    expect(circuit.consecutiveFailures).toBe(0);
    expect(circuit.state).toBe('closed');
  });

  it('stays closed below the threshold', () => {
    const circuit = afterFailures(DEFAULT_CIRCUIT.failureThreshold - 1);
    expect(circuit.state).toBe('closed');
    expect(attempt(circuit, T0).allowed).toBe(true);
  });
});

describe('once the vendor is down', () => {
  it('opens on the threshold failure', () => {
    const circuit = afterFailures(DEFAULT_CIRCUIT.failureThreshold);
    expect(circuit.state).toBe('open');
    expect(circuit.openedAt).toBe(T0);
  });

  it('makes every subsequent call free', () => {
    // The entire point. A failed call costs a five-second timeout; with a
    // hundred rides in the air that is a hundred sockets waiting, and the API
    // stops being able to do anything else.
    const circuit = afterFailures(DEFAULT_CIRCUIT.failureThreshold);
    expect(attempt(circuit, T0 + 1_000).allowed).toBe(false);
    expect(attempt(circuit, T0 + 5_000).allowed).toBe(false);
  });

  it('does not reopen the cooldown by being asked', () => {
    // Asking must not extend the wait, or a busy system never retries at all.
    const circuit = afterFailures(DEFAULT_CIRCUIT.failureThreshold);
    const asked = attempt(circuit, T0 + 1_000).circuit;

    expect(asked.openedAt).toBe(T0);
  });
});

describe('trying again', () => {
  const open = afterFailures(DEFAULT_CIRCUIT.failureThreshold);
  const afterCooldown = T0 + DEFAULT_CIRCUIT.cooldownMs;

  it('lets exactly one request through when the cooldown expires', () => {
    const first = attempt(open, afterCooldown);
    expect(first.allowed).toBe(true);
    expect(first.circuit.state).toBe('halfOpen');

    // The second caller in the same window is refused. Otherwise the whole
    // backlog arrives at a vendor that has just been failing, which is how a
    // recovering service is knocked over again.
    expect(attempt(first.circuit, afterCooldown).allowed).toBe(false);
  });

  it('closes when the trial succeeds', () => {
    const trial = attempt(open, afterCooldown).circuit;
    const recovered = recordSuccess(trial);

    expect(recovered.state).toBe('closed');
    expect(attempt(recovered, afterCooldown).allowed).toBe(true);
  });

  it('re-opens immediately when the trial fails', () => {
    // The trial *was* the test. Counting it towards the threshold again would
    // send two more real requests at a vendor that has just answered the
    // question.
    const trial = attempt(open, afterCooldown).circuit;
    const failed = recordFailure(trial, afterCooldown);

    expect(failed.state).toBe('open');
    expect(failed.openedAt).toBe(afterCooldown);
    expect(attempt(failed, afterCooldown + 1).allowed).toBe(false);
  });

  it('waits the full cooldown again after a failed trial', () => {
    const trial = attempt(open, afterCooldown).circuit;
    const failed = recordFailure(trial, afterCooldown);

    expect(
      attempt(failed, afterCooldown + DEFAULT_CIRCUIT.cooldownMs - 1).allowed,
    ).toBe(false);
    expect(attempt(failed, afterCooldown + DEFAULT_CIRCUIT.cooldownMs).allowed).toBe(
      true,
    );
  });
});

describe('the state it carries', () => {
  it('is plain data a caller can hold anywhere', () => {
    // No timers and no clock of its own, which is what lets one process hold a
    // breaker per vendor in a map and a test drive it without waiting.
    const circuit = newCircuit();
    expect(JSON.parse(JSON.stringify(circuit))).toEqual(circuit);
  });

  it('never mutates the snapshot it was given', () => {
    const circuit = newCircuit();
    recordFailure(circuit, T0);
    attempt(circuit, T0);

    expect(circuit).toEqual(newCircuit());
  });

  it('respects options a caller supplies', () => {
    const options = { failureThreshold: 1, cooldownMs: 5 };
    const circuit = recordFailure(newCircuit(), T0, options);

    expect(circuit.state).toBe('open');
    expect(attempt(circuit, T0 + 4, options).allowed).toBe(false);
    expect(attempt(circuit, T0 + 5, options).allowed).toBe(true);
  });

  it('treats an open circuit with no recorded time as ready to retry', () => {
    // Not reachable through the functions here, but a snapshot could arrive
    // from anywhere. Refusing forever on malformed state would be a breaker
    // that never closes; letting one trial through is the recoverable answer.
    const malformed: CircuitSnapshot = {
      state: 'open',
      consecutiveFailures: 9,
      openedAt: null,
    };
    expect(attempt(malformed, T0).allowed).toBe(true);
  });
});
