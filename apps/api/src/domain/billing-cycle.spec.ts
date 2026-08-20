import {
  decideCycleAction,
  periodsBehind,
  type SubscriptionCycleState,
} from './billing-cycle';
import { isEntitling } from './billing';

const NOW = new Date('2026-06-15T12:00:00Z');

function state(
  overrides: Partial<SubscriptionCycleState> = {},
): SubscriptionCycleState {
  return {
    status: 'active',
    entitlements: ['requestTransport', 'liveTracking'],
    currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    trialEndsAt: null,
    pastDueSince: null,
    graceDays: 7,
    ...overrides,
  };
}

describe('the trial actually ends', () => {
  // The bug this file exists for: `isEntitling` answers true for `trialing`
  // unconditionally, so before there was a clock a fourteen-day trial
  // entitled live tracking forever and nothing anywhere said otherwise.
  it('entitles during the trial and still entitles after it, until something moves the row', () => {
    const expired = state({
      status: 'trialing',
      trialEndsAt: new Date('2026-06-01T00:00:00Z'),
    });

    expect(isEntitling(expired, NOW)).toBe(true);
    expect(decideCycleAction(expired, NOW).kind).toBe('convertTrial');
  });

  it('does nothing while the trial is still running', () => {
    const action = decideCycleAction(
      state({ status: 'trialing', trialEndsAt: new Date('2026-06-20T00:00:00Z') }),
      NOW,
    );
    expect(action).toEqual({ kind: 'none', effectiveAt: null });
  });

  it('converts the moment the trial ends, not a tick before', () => {
    const endsAt = new Date('2026-06-15T12:00:00Z');
    const subscription = state({ status: 'trialing', trialEndsAt: endsAt });

    expect(decideCycleAction(subscription, new Date(endsAt.getTime() - 1)).kind).toBe(
      'none',
    );
    expect(decideCycleAction(subscription, endsAt).kind).toBe('convertTrial');
  });

  it('refuses to charge a card because a column was null', () => {
    const action = decideCycleAction(
      state({ status: 'trialing', trialEndsAt: null }),
      NOW,
    );
    expect(action.kind).toBe('none');
  });
});

describe('renewal', () => {
  it('does nothing inside the period already paid for', () => {
    expect(decideCycleAction(state({ status: 'active' }), NOW).kind).toBe('none');
  });

  it('renews once the period has ended', () => {
    const action = decideCycleAction(
      state({ status: 'active', currentPeriodEnd: new Date('2026-06-01T00:00:00Z') }),
      NOW,
    );
    expect(action.kind).toBe('renew');
  });

  // A sweep that runs late must not move the renewal date. Anchoring to `now`
  // instead would drift the anchor by the lateness of every single pass, and
  // a subscriber bought on the 1st would be billed on the 9th by December.
  it('anchors the new period to the scheduled boundary, never to when the sweep ran', () => {
    const boundary = new Date('2026-06-01T00:00:00Z');
    const lateSweep = new Date('2026-06-01T00:40:00Z');

    const action = decideCycleAction(
      state({ status: 'active', currentPeriodEnd: boundary }),
      lateSweep,
    );

    expect(action.effectiveAt).toEqual(boundary);
    expect(action.effectiveAt).not.toEqual(lateSweep);
  });

  it('anchors a converted trial to the trial end for the same reason', () => {
    const endsAt = new Date('2026-06-10T00:00:00Z');
    const action = decideCycleAction(
      state({ status: 'trialing', trialEndsAt: endsAt }),
      NOW,
    );
    expect(action.effectiveAt).toEqual(endsAt);
  });
});

describe('cancellation runs to the end of the period that was paid for', () => {
  it('keeps entitling until the boundary', () => {
    const subscription = state({ status: 'pendingCancellation' });
    expect(decideCycleAction(subscription, NOW).kind).toBe('none');
    expect(isEntitling(subscription, NOW)).toBe(true);
  });

  it('finishes at the boundary', () => {
    const boundary = new Date('2026-06-01T00:00:00Z');
    const action = decideCycleAction(
      state({ status: 'pendingCancellation', currentPeriodEnd: boundary }),
      NOW,
    );
    expect(action).toEqual({ kind: 'finishCancellation', effectiveAt: boundary });
  });
});

describe('a failed payment expires only once grace has closed', () => {
  it('does nothing inside the grace window', () => {
    const subscription = state({
      status: 'pastDue',
      pastDueSince: new Date('2026-06-12T00:00:00Z'),
      graceDays: 7,
    });

    expect(decideCycleAction(subscription, NOW).kind).toBe('none');
    // The whole point of the window: the map stays on while dunning runs.
    expect(isEntitling(subscription, NOW)).toBe(true);
  });

  it('expires when the window closes, at the moment it closes', () => {
    const subscription = state({
      status: 'pastDue',
      pastDueSince: new Date('2026-06-01T00:00:00Z'),
      graceDays: 7,
    });

    const action = decideCycleAction(subscription, NOW);
    expect(action).toEqual({
      kind: 'expire',
      effectiveAt: new Date('2026-06-08T00:00:00Z'),
    });
    expect(isEntitling(subscription, NOW)).toBe(false);
  });

  it('treats a pastDue row with no failure date as already out of grace', () => {
    // `graceEndsAt` reads a null `pastDueSince` as epoch, which under-entitles
    // rather than granting an unbounded free ride. Asserted here so that
    // reading cannot be softened without a test going red.
    const action = decideCycleAction(
      state({ status: 'pastDue', pastDueSince: null }),
      NOW,
    );
    expect(action.kind).toBe('expire');
  });
});

describe('terminal statuses stay terminal', () => {
  it.each(['canceled', 'expired'] as const)('%s is never acted on again', (status) => {
    expect(decideCycleAction(state({ status }), NOW)).toEqual({
      kind: 'none',
      effectiveAt: null,
    });
  });
});

describe('periodsBehind', () => {
  it('is zero for a current subscription', () => {
    expect(periodsBehind(state(), NOW, 'monthly')).toBe(0);
  });

  it('counts the period that just ended as one', () => {
    const subscription = state({ currentPeriodEnd: new Date('2026-06-01T00:00:00Z') });
    expect(periodsBehind(subscription, NOW, 'monthly')).toBe(1);
  });

  it('counts a sweep that has been down for a quarter', () => {
    const subscription = state({ currentPeriodEnd: new Date('2026-03-01T00:00:00Z') });
    expect(periodsBehind(subscription, NOW, 'monthly')).toBe(4);
  });

  it('measures an annual subscription in years', () => {
    const subscription = state({ currentPeriodEnd: new Date('2024-06-01T00:00:00Z') });
    expect(periodsBehind(subscription, NOW, 'annual')).toBe(3);
  });
});
