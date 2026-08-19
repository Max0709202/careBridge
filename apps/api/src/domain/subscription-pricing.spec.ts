import { Money } from './money';
import { ValidationError } from '../common/errors';
import {
  assertSeatTiersWellFormed,
  billableSeats,
  periodPrice,
  prorate,
  quoteIntervalSwitch,
  quoteSeatChange,
  quoteSubscription,
  seatCharges,
  type SubscriptionPlan,
} from './subscription-pricing';

const familyMonthly: SubscriptionPlan = {
  code: 'family-standard',
  version: 'v1-pilot',
  payer: 'family',
  interval: 'monthly',
  name: 'Family plan',
  basePrice: new Money(2900),
  includedSeats: 0,
  seatTiers: [],
  entitlements: ['requestTransport', 'liveTracking', 'appointmentReminders'],
  trialDays: 14,
  graceDays: 7,
};

const familyAnnual: SubscriptionPlan = {
  ...familyMonthly,
  interval: 'annual',
  // Not 2900 × 12 in code. Two months free is a commercial decision that has
  // to be changeable without a deploy, and a multiplier hides the rounding.
  basePrice: new Money(29_000),
};

const dispatchMonthly: SubscriptionPlan = {
  code: 'dispatch-core',
  version: 'v1-pilot',
  payer: 'dispatchOrganization',
  interval: 'monthly',
  name: 'Dispatch core',
  basePrice: new Money(19_900),
  includedSeats: 5,
  seatTiers: [
    { upToSeats: 20, unitPrice: new Money(1800) },
    { upToSeats: null, unitPrice: new Money(1400) },
  ],
  entitlements: ['dispatchConsole', 'driverApp', 'bulkAssignment'],
  trialDays: 30,
  graceDays: 10,
};

const dispatchAnnual: SubscriptionPlan = {
  ...dispatchMonthly,
  interval: 'annual',
  basePrice: new Money(199_000),
  seatTiers: [
    { upToSeats: 20, unitPrice: new Money(18_000) },
    { upToSeats: null, unitPrice: new Money(14_000) },
  ],
};

const PERIOD_START = new Date('2026-06-01T00:00:00Z');
const PERIOD_END = new Date('2026-07-01T00:00:00Z');

describe('seat tier validation', () => {
  it('accepts an empty ladder, which is what a family plan has', () => {
    expect(() => assertSeatTiersWellFormed([])).not.toThrow();
  });

  it('requires the last tier to be unbounded', () => {
    // Otherwise every driver above the top band is free, and the mistake is
    // discovered by an accountant months later.
    expect(() =>
      assertSeatTiersWellFormed([{ upToSeats: 20, unitPrice: new Money(1800) }]),
    ).toThrow(ValidationError);
  });

  it('allows only the last tier to be unbounded', () => {
    expect(() =>
      assertSeatTiersWellFormed([
        { upToSeats: null, unitPrice: new Money(1800) },
        { upToSeats: null, unitPrice: new Money(1400) },
      ]),
    ).toThrow(ValidationError);
  });

  it('requires the ladder to ascend', () => {
    expect(() =>
      assertSeatTiersWellFormed([
        { upToSeats: 20, unitPrice: new Money(1800) },
        { upToSeats: 20, unitPrice: new Money(1400) },
        { upToSeats: null, unitPrice: new Money(1200) },
      ]),
    ).toThrow(ValidationError);
  });

  it('accepts a well-formed ladder', () => {
    expect(() => assertSeatTiersWellFormed(dispatchMonthly.seatTiers)).not.toThrow();
  });
});

describe('per-driver pricing', () => {
  it('charges nothing until the included drivers are used up', () => {
    expect(seatCharges(dispatchMonthly, 0)).toEqual([]);
    expect(seatCharges(dispatchMonthly, 5)).toEqual([]);
    expect(billableSeats(dispatchMonthly, 3)).toBe(0);
    expect(billableSeats(dispatchMonthly, 9)).toBe(4);
  });

  it('prices each driver in the band they fall in, not the band the total reaches', () => {
    // Graduated, not volume. Volume pricing makes an operator's bill *fall*
    // when they hire, and explaining that ends in a spreadsheet nobody trusts.
    const lines = seatCharges(dispatchMonthly, 25);

    expect(lines).toEqual([
      {
        label: 'Drivers 6–20',
        quantity: 15,
        unitPrice: new Money(1800),
        amount: new Money(27_000),
      },
      {
        label: 'Drivers 21 and above',
        quantity: 5,
        unitPrice: new Money(1400),
        amount: new Money(7000),
      },
    ]);
  });

  it('stops at the band the driver count lands in', () => {
    expect(seatCharges(dispatchMonthly, 20)).toHaveLength(1);
    expect(seatCharges(dispatchMonthly, 21)).toHaveLength(2);
  });

  it('never re-prices downwards as an operator grows', () => {
    let previous = -1;
    for (let seats = 0; seats <= 60; seats += 1) {
      const total = periodPrice(dispatchMonthly, seats).cents;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it('refuses a seat count that is not a whole number of drivers', () => {
    expect(() => seatCharges(dispatchMonthly, 2.5)).toThrow(ValidationError);
    expect(() => seatCharges(dispatchMonthly, -1)).toThrow(ValidationError);
  });
});

describe('quoting a period', () => {
  it('itemises a family plan as one line', () => {
    const quote = quoteSubscription({ plan: familyMonthly });

    expect(quote.total).toEqual(new Money(2900));
    expect(quote.lines).toHaveLength(1);
    expect(quote.seats).toBe(0);
    expect(quote.planVersion).toBe('v1-pilot');
    expect(quote.interval).toBe('monthly');
  });

  it('itemises a dispatch plan so the operator can check the bill', () => {
    const quote = quoteSubscription({ plan: dispatchMonthly, seats: 25 });

    expect(quote.lines.map((l) => l.label)).toEqual([
      'Dispatch core',
      'Drivers 6–20',
      'Drivers 21 and above',
    ]);
    expect(quote.billableSeats).toBe(20);
    expect(quote.total).toEqual(new Money(19_900 + 27_000 + 7000));
  });

  it('refuses to price a household by seats', () => {
    expect(() => quoteSubscription({ plan: familyMonthly, seats: 3 })).toThrow(
      ValidationError,
    );
  });

  it('makes annual a row rather than a multiplier', () => {
    expect(periodPrice(familyAnnual).cents).toBeLessThan(
      periodPrice(familyMonthly).cents * 12,
    );
  });
});

describe('proration', () => {
  it('charges the unused remainder of the period', () => {
    const halfway = new Date('2026-06-16T00:00:00Z');
    expect(
      prorate({
        amount: new Money(3000),
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: halfway,
      }),
    ).toEqual(new Money(1500));
  });

  it('clamps outside the period rather than producing a negative charge', () => {
    expect(
      prorate({
        amount: new Money(3000),
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toEqual(new Money(0));

    expect(
      prorate({
        amount: new Money(3000),
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: new Date('2026-05-01T00:00:00Z'),
      }),
    ).toEqual(new Money(3000));
  });

  it('rounds half away from zero, matching the client preview', () => {
    expect(
      prorate({
        amount: new Money(1),
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: new Date('2026-06-16T00:00:00Z'),
      }),
    ).toEqual(new Money(1));
  });

  it('refuses a period that does not move forward', () => {
    expect(() =>
      prorate({
        amount: new Money(100),
        periodStart: PERIOD_END,
        periodEnd: PERIOD_START,
        effectiveAt: PERIOD_START,
      }),
    ).toThrow(ValidationError);
  });
});

describe('changing the number of drivers mid-period', () => {
  it('charges an added driver for the rest of the period, immediately', () => {
    const quote = quoteSeatChange({
      plan: dispatchMonthly,
      seatsPaidFor: 10,
      seatsAfter: 12,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: new Date('2026-06-16T00:00:00Z'),
    });

    expect(quote.effect).toBe('immediately');
    // Two drivers at $18, half a month.
    expect(quote.dueNow).toEqual(new Money(1800));
    expect(quote.seatsFromNextRenewal).toBe(12);
  });

  it('releases a driver at renewal without a refund, and says so', () => {
    // The asymmetry is the point: the seat stays usable until the period they
    // paid for ends. What it removes is the option to churn seats daily around
    // a renewal date.
    const quote = quoteSeatChange({
      plan: dispatchMonthly,
      seatsPaidFor: 12,
      seatsAfter: 8,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: new Date('2026-06-16T00:00:00Z'),
    });

    expect(quote.effect).toBe('nextRenewal');
    expect(quote.dueNow).toEqual(Money.zero());
    expect(quote.seatsFromNextRenewal).toBe(8);
    // The mark does not follow the reduction down, which is what stops the
    // seats being charged for twice if they come back.
    expect(quote.seatsPaidForAfter).toBe(12);
  });

  it('does not charge twice for a seat that leaves and comes back in one period', () => {
    // Twelve drivers, drop to eight, hire back to twelve, all inside June.
    // They have already paid for twelve. Comparing against the head count
    // instead of the high-water mark would bill four seats a second time —
    // and would do it to the operator whose staffing is least stable.
    const period = {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: new Date('2026-06-20T00:00:00Z'),
    };

    const back = quoteSeatChange({
      plan: dispatchMonthly,
      seatsPaidFor: 12,
      seatsAfter: 12,
      ...period,
    });

    expect(back.dueNow).toEqual(Money.zero());
    expect(back.seatsFromNextRenewal).toBe(12);

    // A thirteenth driver is new, and is charged for the rest of the period.
    const thirteenth = quoteSeatChange({
      plan: dispatchMonthly,
      seatsPaidFor: 12,
      seatsAfter: 13,
      ...period,
    });

    expect(thirteenth.dueNow.cents).toBeGreaterThan(0);
    expect(thirteenth.seatsPaidForAfter).toBe(13);
  });

  it('treats no change as no charge', () => {
    const quote = quoteSeatChange({
      plan: dispatchMonthly,
      seatsPaidFor: 8,
      seatsAfter: 8,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: new Date('2026-06-16T00:00:00Z'),
    });
    expect(quote.dueNow).toEqual(Money.zero());
    expect(quote.seatsPaidFor).toBe(8);
  });
});

describe('switching between monthly and annual', () => {
  it('credits the unused month against the year', () => {
    const quote = quoteIntervalSwitch({
      from: familyMonthly,
      to: familyAnnual,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: new Date('2026-06-16T00:00:00Z'),
    });

    expect(quote.credit).toEqual(new Money(1450));
    expect(quote.charge).toEqual(new Money(29_000));
    expect(quote.dueNow).toEqual(new Money(27_550));
    expect(quote.carriedCredit).toEqual(Money.zero());
    expect(quote.fromPlanCode).toBe('family-standard');
    expect(quote.toPlanCode).toBe('family-standard');
  });

  it('carries the surplus forward rather than refunding it', () => {
    // Annual → monthly one month in. Money already taken stays taken and is
    // spent down against renewals; refunding would make an annual plan a free
    // interest-bearing account.
    const quote = quoteIntervalSwitch({
      from: familyAnnual,
      to: familyMonthly,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2027-01-01T00:00:00Z'),
      effectiveAt: new Date('2026-02-01T00:00:00Z'),
    });

    expect(quote.dueNow).toEqual(Money.zero());
    expect(quote.carriedCredit.cents).toBeGreaterThan(0);
  });

  it('prices the switch at the current driver count', () => {
    const quote = quoteIntervalSwitch({
      from: dispatchMonthly,
      to: dispatchAnnual,
      seats: 25,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      effectiveAt: PERIOD_START,
    });

    expect(quote.credit).toEqual(new Money(53_900));
    expect(quote.charge).toEqual(new Money(199_000 + 15 * 18_000 + 5 * 14_000));
  });

  it('refuses to move a subscription to the other side of the marketplace', () => {
    expect(() =>
      quoteIntervalSwitch({
        from: familyMonthly,
        to: dispatchAnnual,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: PERIOD_START,
      }),
    ).toThrow(ValidationError);
  });

  it('refuses a switch to the interval already in force', () => {
    expect(() =>
      quoteIntervalSwitch({
        from: familyMonthly,
        to: familyMonthly,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        effectiveAt: PERIOD_START,
      }),
    ).toThrow(ValidationError);
  });
});
