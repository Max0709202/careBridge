import {
  BILLING_INTERVALS,
  BILLING_PAYERS,
  DISPATCH_ENTITLEMENTS,
  FAMILY_ENTITLEMENTS,
  SUBSCRIPTION_STATUSES,
  activeEntitlements,
  assertEntitlementsMatchPayer,
  assertSubscriptionTransition,
  canTransitionSubscription,
  entitlementsForPayer,
  graceEndsAt,
  hasEntitlement,
  isEntitling,
  isTerminalSubscriptionStatus,
  periodEndFor,
  trialEndsAt,
  type Entitlement,
  type SubscriptionEntitlementState,
  type SubscriptionStatus,
} from './billing';
import { InvalidTransitionError, ValidationError } from '../common/errors';

const NOW = new Date('2026-06-15T12:00:00Z');

function state(
  overrides: Partial<SubscriptionEntitlementState> = {},
): SubscriptionEntitlementState {
  return {
    status: 'active',
    entitlements: ['requestTransport', 'liveTracking'],
    currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    pastDueSince: null,
    graceDays: 7,
    ...overrides,
  };
}

describe('billing vocabulary', () => {
  it('names exactly the two paying sides of the marketplace', () => {
    expect(BILLING_PAYERS).toEqual(['family', 'dispatchOrganization']);
  });

  it('offers monthly and annual, and nothing in between', () => {
    expect(BILLING_INTERVALS).toEqual(['monthly', 'annual']);
  });
});

describe('subscription status machine', () => {
  it('lists every status', () => {
    expect(SUBSCRIPTION_STATUSES).toHaveLength(6);
  });

  it('converts a trial and recovers a failed payment', () => {
    expect(canTransitionSubscription('trialing', 'active')).toBe(true);
    expect(canTransitionSubscription('active', 'pastDue')).toBe(true);
    expect(canTransitionSubscription('pastDue', 'active')).toBe(true);
    expect(canTransitionSubscription('pendingCancellation', 'active')).toBe(true);
  });

  it('sends a declined trial conversion into dunning rather than straight out', () => {
    // The tidy reading is that a trial which never paid simply expires. That
    // reading blanks the map on day fourteen, which is the exact failure the
    // grace window exists to prevent.
    expect(canTransitionSubscription('trialing', 'pastDue')).toBe(true);
  });

  it('never revives a subscription that ended', () => {
    // Re-subscribing creates a new row. What somebody was charged, under which
    // plan version, stays immutable.
    for (const to of SUBSCRIPTION_STATUSES) {
      expect(canTransitionSubscription('canceled', to)).toBe(false);
      expect(canTransitionSubscription('expired', to)).toBe(false);
    }
    expect(isTerminalSubscriptionStatus('canceled')).toBe(true);
    expect(isTerminalSubscriptionStatus('expired')).toBe(true);
    expect(isTerminalSubscriptionStatus('active')).toBe(false);
  });

  it('refuses the transitions nobody should be able to reach', () => {
    // An active subscription cannot silently expire: it goes past due first,
    // which is what sends the dunning mail.
    expect(canTransitionSubscription('active', 'expired')).toBe(false);
    expect(canTransitionSubscription('active', 'trialing')).toBe(false);
    expect(canTransitionSubscription('pastDue', 'pendingCancellation')).toBe(false);
    expect(canTransitionSubscription('pendingCancellation', 'expired')).toBe(false);
  });

  it('throws with both ends recorded, and says neither to the user', () => {
    expect(() => assertSubscriptionTransition('active', 'trialing')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertSubscriptionTransition('trialing', 'active')).not.toThrow();

    try {
      assertSubscriptionTransition('canceled', 'active');
      throw new Error('unreachable');
    } catch (error) {
      const failure = error as InvalidTransitionError;
      expect(failure.from).toBe('canceled');
      expect(failure.to).toBe('active');
      expect(failure.message).not.toContain('canceled');
    }
  });
});

describe('entitlement catalogue', () => {
  it('keeps the two sides disjoint', () => {
    for (const entitlement of FAMILY_ENTITLEMENTS) {
      expect(DISPATCH_ENTITLEMENTS).not.toContain(entitlement);
    }
    expect(entitlementsForPayer('family')).toBe(FAMILY_ENTITLEMENTS);
    expect(entitlementsForPayer('dispatchOrganization')).toBe(DISPATCH_ENTITLEMENTS);
  });

  it('refuses a plan that grants the other side’s features', () => {
    expect(() =>
      assertEntitlementsMatchPayer('family', ['liveTracking', 'dispatchConsole']),
    ).toThrow(ValidationError);
    expect(() =>
      assertEntitlementsMatchPayer('dispatchOrganization', ['liveTracking']),
    ).toThrow(ValidationError);
    expect(() =>
      assertEntitlementsMatchPayer('family', ['liveTracking', 'prioritySupport']),
    ).not.toThrow();
  });
});

describe('what is switched on right now', () => {
  it('entitles a trial and an active subscription unconditionally', () => {
    expect(isEntitling(state({ status: 'trialing' }), NOW)).toBe(true);
    expect(isEntitling(state({ status: 'active' }), NOW)).toBe(true);
    expect(activeEntitlements(state(), NOW)).toEqual([
      'requestTransport',
      'liveTracking',
    ]);
  });

  it('keeps a cancelled subscription running until the period it paid for ends', () => {
    const cancelling = state({ status: 'pendingCancellation' });
    expect(isEntitling(cancelling, NOW)).toBe(true);
    expect(isEntitling(cancelling, new Date('2026-07-01T00:00:00Z'))).toBe(false);
  });

  it('does not cut a family off mid-trip when a card expires', () => {
    // The failure this guards against is concrete: a declined renewal blanking
    // the map while somebody's mother is in a stranger's car. Dunning happens
    // by email; the grace window is what makes that possible.
    const pastDue = state({
      status: 'pastDue',
      pastDueSince: new Date('2026-06-14T12:00:00Z'),
    });

    expect(isEntitling(pastDue, NOW)).toBe(true);
    expect(graceEndsAt(pastDue)).toEqual(new Date('2026-06-21T12:00:00Z'));
    expect(isEntitling(pastDue, new Date('2026-06-21T12:00:01Z'))).toBe(false);
  });

  it('treats a past-due row with no failure date as out of grace', () => {
    // Under-entitling is the safe reading of a malformed state; the opposite
    // is an unbounded free subscription nobody notices.
    const malformed = state({ status: 'pastDue', pastDueSince: null });
    expect(graceEndsAt(malformed)).toEqual(new Date(0));
    expect(isEntitling(malformed, NOW)).toBe(false);
  });

  it('switches everything off once the subscription has ended', () => {
    expect(activeEntitlements(state({ status: 'canceled' }), NOW)).toEqual([]);
    expect(activeEntitlements(state({ status: 'expired' }), NOW)).toEqual([]);
  });

  it('answers a single entitlement, and answers false for no subscription at all', () => {
    expect(hasEntitlement(state(), 'liveTracking', NOW)).toBe(true);
    expect(hasEntitlement(state(), 'prioritySupport', NOW)).toBe(false);
    expect(hasEntitlement(null, 'liveTracking', NOW)).toBe(false);
    expect(hasEntitlement(undefined, 'liveTracking', NOW)).toBe(false);
  });

  it('covers every status', () => {
    const seen = new Set<SubscriptionStatus>();
    for (const status of SUBSCRIPTION_STATUSES) {
      isEntitling(state({ status, pastDueSince: NOW }), NOW);
      seen.add(status);
    }
    expect(seen.size).toBe(SUBSCRIPTION_STATUSES.length);
  });
});

describe('period arithmetic', () => {
  it('walks the calendar rather than adding thirty days', () => {
    // A subscriber who signs up on the 31st renews on the 30th of a 30-day
    // month and back on the 31st after that — which is what their bank
    // statement shows. Fixed-length months drift the date backwards all year.
    expect(periodEndFor(new Date('2026-01-31T09:00:00Z'), 'monthly')).toEqual(
      new Date('2026-02-28T09:00:00Z'),
    );
    expect(periodEndFor(new Date('2026-03-31T09:00:00Z'), 'monthly')).toEqual(
      new Date('2026-04-30T09:00:00Z'),
    );
    expect(periodEndFor(new Date('2026-06-15T12:00:00Z'), 'monthly')).toEqual(
      new Date('2026-07-15T12:00:00Z'),
    );
  });

  it('handles the leap day on an annual renewal', () => {
    expect(periodEndFor(new Date('2028-02-29T00:00:00Z'), 'annual')).toEqual(
      new Date('2029-02-28T00:00:00Z'),
    );
    expect(periodEndFor(new Date('2026-06-15T12:00:00Z'), 'annual')).toEqual(
      new Date('2027-06-15T12:00:00Z'),
    );
  });

  it('reports no trial end when the plan has no trial', () => {
    expect(trialEndsAt(NOW, 0)).toBeNull();
    expect(trialEndsAt(NOW, -1)).toBeNull();
    expect(trialEndsAt(NOW, 14)).toEqual(new Date('2026-06-29T12:00:00Z'));
  });
});

describe('the catalogue is a closed set', () => {
  it('names every entitlement exactly once', () => {
    const all: Entitlement[] = [...FAMILY_ENTITLEMENTS, ...DISPATCH_ENTITLEMENTS];
    expect(new Set(all).size).toBe(all.length);
  });
});
