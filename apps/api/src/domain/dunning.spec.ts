import {
  DUNNING_SCHEDULE_DAYS,
  MAX_PAYMENT_ATTEMPTS,
  SHORTEST_GRACE_DAYS,
  classifyDecline,
  isAttemptDue,
  isExhausted,
  nextAttemptAt,
  type DunningState,
} from './dunning';

const FIRST_FAILURE = new Date('2026-06-01T09:00:00Z');

function state(overrides: Partial<DunningState> = {}): DunningState {
  return {
    attempts: 1,
    firstFailedAt: FIRST_FAILURE,
    decline: 'retryable',
    ...overrides,
  };
}

describe('the schedule', () => {
  it('retries three times over six days after the first failure', () => {
    expect(DUNNING_SCHEDULE_DAYS).toEqual([1, 3, 6]);
    expect(MAX_PAYMENT_ATTEMPTS).toBe(4);
  });

  // The cycle sweep expires a subscription the moment its grace window closes.
  // A retry scheduled past that would be a charge silently never attempted, on
  // the one account that most needed the reminder.
  it('fits every attempt inside the shortest grace window any plan offers', () => {
    const last = DUNNING_SCHEDULE_DAYS[DUNNING_SCHEDULE_DAYS.length - 1] ?? 0;
    expect(last).toBeLessThan(SHORTEST_GRACE_DAYS);
  });

  it('spaces each retry from the first failure, not from the previous attempt', () => {
    // Anchoring each retry to the one before it would let a late sweep stretch
    // the whole schedule, and the last attempt would land weeks out — long
    // after the grace window that keeps the family's map on has closed.
    expect(nextAttemptAt(state({ attempts: 1 }))).toEqual(
      new Date('2026-06-02T09:00:00Z'),
    );
    expect(nextAttemptAt(state({ attempts: 2 }))).toEqual(
      new Date('2026-06-04T09:00:00Z'),
    );
    expect(nextAttemptAt(state({ attempts: 3 }))).toEqual(
      new Date('2026-06-07T09:00:00Z'),
    );
  });

  it('stops after the last scheduled retry', () => {
    expect(nextAttemptAt(state({ attempts: 4 }))).toBeNull();
    expect(nextAttemptAt(state({ attempts: 9 }))).toBeNull();
  });

  it('knows when it is exhausted', () => {
    expect(isExhausted(3)).toBe(false);
    expect(isExhausted(4)).toBe(true);
    expect(isExhausted(5)).toBe(true);
  });
});

describe('classifying a decline', () => {
  it.each([
    'card_declined_stolen_card',
    'card_declined_lost_card',
    'card_declined_pickup_card',
    'card_declined_revocation_of_authorization',
    'invalid_account',
    'account_closed',
  ])('stops on %s, which will never succeed', (code) => {
    expect(classifyDecline(code)).toBe('terminal');
  });

  it.each(['insufficient_funds', 'processing_error', 'expired_card'])(
    'retries %s',
    (code) => {
      expect(classifyDecline(code)).toBe('retryable');
    },
  );

  // One wasted retry costs a network fee. Cancelling a subscription that would
  // have paid costs the customer, so an unrecognised code is retried.
  it.each([null, undefined, '', 'some_code_stripe_added_last_tuesday'])(
    'treats %p as retryable, because the safe reading is that it might work later',
    (code) => {
      expect(classifyDecline(code)).toBe('retryable');
    },
  );

  it('makes no further attempt after a terminal decline, however early in the schedule', () => {
    expect(nextAttemptAt(state({ attempts: 1, decline: 'terminal' }))).toBeNull();
  });
});

describe('when an attempt is due', () => {
  it('is not due before its scheduled instant', () => {
    expect(isAttemptDue(state(), new Date('2026-06-02T08:59:59Z'))).toBe(false);
  });

  it('is due at its scheduled instant and after', () => {
    expect(isAttemptDue(state(), new Date('2026-06-02T09:00:00Z'))).toBe(true);
    expect(isAttemptDue(state(), new Date('2026-06-03T00:00:00Z'))).toBe(true);
  });

  // `now >= null` coerces to a comparison against zero, which would report
  // every finished schedule as permanently due and retry a dead card forever.
  it('is never due once the schedule is over, however far in the future', () => {
    expect(isAttemptDue(state({ attempts: 4 }), new Date('2030-01-01T00:00:00Z'))).toBe(
      false,
    );
  });

  it('is never due after a terminal decline', () => {
    expect(
      isAttemptDue(state({ decline: 'terminal' }), new Date('2030-01-01T00:00:00Z')),
    ).toBe(false);
  });
});
