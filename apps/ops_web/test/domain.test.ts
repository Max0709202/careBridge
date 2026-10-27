/**
 * The rules the console mirrors. Ports of apps/ops_console/test/dispatch_test.dart,
 * models_test.dart, billing_test.dart and admin_test.dart.
 */
import { describe, expect, it } from 'vitest';

import {
  accountFromWire,
  candidateFromWire,
  driverFromWire,
  invoiceFromWire,
  queueFromWire,
  refundableFromWire,
  statsFromWire,
} from '../src/api/codec';
import { formatCents, parseDollars } from '../src/core/money';
import {
  actorLabel,
  completionRate,
  flagSummary,
  hasInFlightRefund,
  isEmptyFilter,
  isFullyRefunded,
  needsAttention,
  netRevenueCentsLast30Days,
  refundedCents,
  takesAwayBy,
  type AuditEntry,
  type FeatureFlag,
} from '../src/domain/admin';
import {
  hasExpired,
  hasFailed,
  isPayable,
  paymentMethodLabel,
  subscriptionNeedsAttention,
  willBillWithoutACard,
  type Invoice,
} from '../src/domain/billing';
import {
  DISPATCH_URGENCIES,
  DRIVER_STATUSES,
  INELIGIBILITY_REASONS,
  canTransitionDriver,
  isAssignable,
  nextStatusesFor,
  occupiesSeat,
  parseUrgency,
  reasonLabel,
  reasonRemedy,
  transitionNeedsReason,
  urgencyLabel,
  urgencyOrder,
} from '../src/domain/dispatch';
import {
  hasAnyoneAvailable,
  isAvailableNow,
  isReassignment,
  overdueCount,
  pendingAtRenewal,
  reasonLabels,
  strandedCount,
  vehicleLabel,
} from '../src/domain/models';
import {
  account,
  auditEntry,
  candidate,
  driver,
  invoice,
  queue,
  queueItem,
  refundable,
  stats,
  subscription,
} from './support/fixtures';

describe('urgency', () => {
  it('drops a band it does not recognise rather than guessing', () => {
    expect(parseUrgency('whenever')).toBeNull();
    for (const u of DISPATCH_URGENCIES) expect(parseUrgency(u)).toBe(u);
  });

  it('orders overdue first, matching the server', () => {
    const sorted = [...DISPATCH_URGENCIES].sort(
      (a, b) => urgencyOrder[a] - urgencyOrder[b],
    );
    expect(sorted).toEqual(['overdue', 'imminent', 'soon', 'later']);
  });

  it('labels every band, because colour alone is not a label', () => {
    for (const u of DISPATCH_URGENCIES)
      expect(urgencyLabel[u].length).toBeGreaterThan(0);
    expect(urgencyLabel.overdue).toBe('Overdue');
  });

  it('drops a queue item with an unknown band, so it cannot sort into the wrong place', () => {
    const q = queueFromWire(
      queue([queueItem(), queueItem({ rideId: 'x', urgency: 'someday' as never })]),
    );
    expect(q.items.map((i) => i.rideId)).toEqual(['ride-1']);
  });
});

describe('ineligibility', () => {
  it('names all four, so an empty candidate list is explainable', () => {
    for (const r of INELIGIBILITY_REASONS) expect(reasonLabel[r]).toBeTruthy();
  });

  it('offers a remedy only where there is one', () => {
    expect(reasonRemedy.offShift).toMatch(/on shift/);
    expect(reasonRemedy.noAccessibleVehicle).toBeNull();
  });

  it('keeps a reason it does not recognise rather than dropping it', () => {
    const c = candidateFromWire(
      candidate({ eligible: false, reasons: ['offShift', 'onHoliday'] }),
    );
    expect(c.reasons).toEqual(['offShift']);
    expect(reasonLabels(c)).toEqual(['Not on shift', 'onHoliday']);
  });
});

describe('driver status', () => {
  it('only an approved driver may be assigned or occupies a seat', () => {
    for (const s of DRIVER_STATUSES) {
      expect(isAssignable(s)).toBe(s === 'approved');
      expect(occupiesSeat(s)).toBe(s === 'approved');
    }
  });

  it('never offers approval straight from invited', () => {
    expect(canTransitionDriver('invited', 'approved')).toBe(false);
    expect(canTransitionDriver('pendingApproval', 'approved')).toBe(true);
  });

  it('offers no transition out of a terminal status', () => {
    expect(nextStatusesFor('offboarded')).toEqual([]);
  });

  it('insists on a reason for the two that end somebody earning', () => {
    expect(DRIVER_STATUSES.filter(transitionNeedsReason)).toEqual([
      'suspended',
      'offboarded',
    ]);
  });

  it('drops a driver whose status it does not know', () => {
    expect(driverFromWire(driver({ status: 'onLeave' as never }))).toBeNull();
  });

  it('is available only when approved, on shift and free', () => {
    const d = driverFromWire(driver())!;
    expect(isAvailableNow(d)).toBe(true);
    expect(isAvailableNow({ ...d, onShift: false })).toBe(false);
    expect(isAvailableNow({ ...d, activeRideCount: 1 })).toBe(false);
    expect(isAvailableNow({ ...d, status: 'suspended' })).toBe(false);
  });

  it('describes its vehicle the way a dispatcher would say it', () => {
    expect(vehicleLabel(driverFromWire(driver())!.vehicle)).toBe(
      'Silver Toyota Sienna',
    );
  });
});

describe('the queue', () => {
  it('counts the rides that need a phone call, not a tap', () => {
    const q = queueFromWire(
      queue([
        queueItem(),
        queueItem({
          rideId: 'r2',
          candidates: [candidate({ eligible: false, reasons: ['offShift'] })],
        }),
        queueItem({ rideId: 'r3', candidates: [] }),
      ]),
    );
    expect(strandedCount(q)).toBe(2);
    expect(hasAnyoneAvailable(q.items[0]!)).toBe(true);
  });

  it('counts the rides already past their pickup time', () => {
    const q = queueFromWire(
      queue([
        queueItem({ urgency: 'overdue' }),
        queueItem({ rideId: 'r2', urgency: 'imminent' }),
      ]),
    );
    expect(overdueCount(q)).toBe(1);
  });

  it('knows a reassignment from a first assignment', () => {
    const q = queueFromWire(queue([queueItem({ status: 'reassignmentRequired' })]));
    expect(isReassignment(q.items[0]!)).toBe(true);
  });
});

describe('seats', () => {
  it('explains the gap between drivers on the road and seats billed', () => {
    const base = { organizationId: 'o', renewalTotalCents: null, ledger: [] };
    expect(pendingAtRenewal({ ...base, activeDrivers: 12, billedSeats: 10 })).toBe(2);
    expect(pendingAtRenewal({ ...base, activeDrivers: 9, billedSeats: 10 })).toBe(-1);
  });
});

describe('money', () => {
  it('is formatted from cents', () => {
    expect(formatCents(123456)).toBe('$1234.56');
    expect(formatCents(5)).toBe('$0.05');
  });

  it('a credit keeps its sign in front of the currency', () => {
    expect(formatCents(-250)).toBe('-$2.50');
  });

  it('parses what a person types without passing through a float', () => {
    expect(parseDollars('0.29')).toBe(29);
    expect(parseDollars('24.5')).toBe(2450);
    expect(parseDollars('$1,024.99')).toBe(102499);
    expect(parseDollars('.5')).toBe(50);
    expect(parseDollars('12')).toBe(1200);
    expect(parseDollars('abc')).toBeNull();
    expect(parseDollars('1.234')).toBeNull();
    expect(parseDollars('')).toBeNull();
  });
});

describe('billing', () => {
  const inv = (o: Partial<Invoice>) => ({ ...invoiceFromWire(invoice())!, ...o });

  it('drops an invoice status it does not know rather than guessing', () => {
    expect(invoiceFromWire(invoice({ status: 'disputed' as never }))).toBeNull();
    expect(invoiceFromWire(invoice({ status: 'void' }))?.status).toBe('void');
  });

  it('open and never attempted has not failed; open after an attempt is in dunning', () => {
    expect(hasFailed(inv({ status: 'open', attemptCount: 0 }))).toBe(false);
    expect(hasFailed(inv({ status: 'open', attemptCount: 1 }))).toBe(true);
    expect(hasFailed(inv({ status: 'paid', attemptCount: 3 }))).toBe(false);
  });

  it('uncollectible can still be paid by hand; a cancelled invoice cannot', () => {
    expect(isPayable(inv({ status: 'uncollectible' }))).toBe(true);
    expect(isPayable(inv({ status: 'void' }))).toBe(false);
  });

  it('a card is spent the moment its month is over', () => {
    const card = {
      id: 'c',
      brand: 'Visa',
      last4: '4242',
      expMonth: 3,
      expYear: 2026,
      isDefault: true,
    };
    expect(hasExpired(card, new Date(2026, 2, 31, 23, 59))).toBe(false);
    expect(hasExpired(card, new Date(2026, 3, 1))).toBe(true);
    expect(paymentMethodLabel(card)).toBe('Visa •••• 4242');
  });

  it('a plan with no card is called out before the renewal; no plan and no card is not a warning', () => {
    expect(
      willBillWithoutACard(accountFromWire(account({ paymentMethod: null }))),
    ).toBe(true);
    expect(
      willBillWithoutACard(
        accountFromWire(account({ paymentMethod: null, subscription: null })),
      ),
    ).toBe(false);
  });

  it('a subscription it cannot decode collapses to no plan', () => {
    const a = accountFromWire(
      account({ subscription: subscription({ status: 'paused' as never }) }),
    );
    expect(a.subscription).toBeNull();
  });

  it('past due asks for attention; a pending cancellation does not, because it was a decision', () => {
    expect(subscriptionNeedsAttention('pastDue')).toBe(true);
    expect(subscriptionNeedsAttention('pendingCancellation')).toBe(false);
  });
});

describe('administration', () => {
  it('says nothing needs a person when no queue has anything in it', () => {
    expect(needsAttention(statsFromWire(stats()))).toBe(false);
    expect(needsAttention(statsFromWire(stats({ invoicesPastDue: 1 })))).toBe(true);
  });

  it('a week in which nothing ended has no completion rate at all', () => {
    expect(
      completionRate(statsFromWire(stats({ ridesCompletedLast7Days: 0 }))),
    ).toBeNull();
    expect(
      completionRate(
        statsFromWire(stats({ ridesCompletedLast7Days: 3, ridesNoShowLast7Days: 1 })),
      ),
    ).toBe(0.75);
  });

  it('what was kept is what settled less what went back', () => {
    expect(netRevenueCentsLast30Days(statsFromWire(stats()))).toBe(97500);
  });

  const flag: FeatureFlag = {
    key: 'k',
    description: 'd',
    enabled: true,
    rolloutPercent: 50,
    updatedAt: new Date(),
    updatedByName: null,
  };

  it('widening takes nothing away; narrowing and switching off do', () => {
    expect(takesAwayBy(flag, { enabled: true, percent: 80 })).toBe(false);
    expect(takesAwayBy(flag, { enabled: true, percent: 20 })).toBe(true);
    expect(takesAwayBy(flag, { enabled: false, percent: 50 })).toBe(true);
    expect(
      takesAwayBy({ ...flag, enabled: false }, { enabled: false, percent: 0 }),
    ).toBe(false);
  });

  it('says what a flag does in a sentence', () => {
    expect(flagSummary({ ...flag, enabled: false })).toBe('Off for everybody');
    expect(flagSummary(flag)).toBe('On for 50% of subjects');
    expect(flagSummary({ ...flag, rolloutPercent: 0 })).toBe(
      'On, but rolled out to nobody',
    );
  });

  it('names the system when nobody did it', () => {
    const system = {
      ...auditEntry(),
      actorUserId: null,
      actorName: null,
    } as unknown as AuditEntry;
    expect(actorLabel(system)).toBe('CareBridge');
  });

  it('blank fields count as no filter at all', () => {
    expect(isEmptyFilter({ action: '', entityType: '', entityId: '' })).toBe(true);
    expect(isEmptyFilter({ action: 'driver.' })).toBe(false);
  });

  it('what was refunded is the payment less what is left', () => {
    const r = refundableFromWire(refundable({ refundableCents: 7900 }));
    expect(refundedCents(r)).toBe(20000);
    expect(
      isFullyRefunded(refundableFromWire(refundable({ refundableCents: 0 }))),
    ).toBe(true);
  });

  it('a pending refund is money that may still be moving; one with an unknown status is dropped', () => {
    const base = {
      id: 'rf',
      invoiceId: 'inv-1',
      invoiceNumber: 'CB-0001',
      amountCents: 100,
      currency: 'usd',
      reason: 'dup',
      failureMessage: null,
      requestedByName: 'Priya',
      createdAt: '2026-06-01T00:00:00Z',
      settledAt: null,
    };
    const r = refundableFromWire(
      refundable({
        refunds: [
          { ...base, status: 'pending' },
          { ...base, id: 'rf2', status: 'reversed' as never },
        ],
      }),
    );
    expect(r.refunds).toHaveLength(1);
    expect(hasInFlightRefund(r)).toBe(true);
  });
});
