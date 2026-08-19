import { Money } from './money';
import { estimateFare, settleFare, type PricingRule } from './pricing';
import { ValidationError } from '../common/errors';

const rule: PricingRule = {
  version: 'v1-pilot',
  baseFare: new Money(1200),
  perMile: new Money(225),
  perMinute: new Money(45),
  minimumFare: new Money(1800),
  wheelchairSurcharge: new Money(1500),
  assistanceSurcharge: new Money(800),
  platformFeeBps: 1500,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
};

describe('money', () => {
  it('refuses fractional cents at construction', () => {
    expect(() => new Money(12.5)).toThrow();
  });

  it('rounds half away from zero, matching Dart', () => {
    // The client reconstructs the same totals from the same integers; a
    // rounding rule that differed by a cent would show up as a fare that does
    // not match the receipt.
    expect(new Money(100).times(0.005).cents).toBe(1);
    expect(new Money(-100).times(0.005).cents).toBe(-1);
    expect(new Money(1).times(0.5).cents).toBe(1);
    expect(new Money(-1).times(0.5).cents).toBe(-1);
  });

  it('formats as currency without ever touching a float', () => {
    expect(new Money(3688).format()).toBe('$36.88');
    expect(new Money(0).format()).toBe('$0.00');
    expect(new Money(5).format()).toBe('$0.05');
    expect(new Money(-250).format()).toBe('-$2.50');
  });
});

describe('fare estimation', () => {
  it('itemises base, distance and time', () => {
    const estimate = estimateFare({
      rule,
      distanceMiles: 4.1,
      durationMinutes: 17,
    });

    expect(estimate.base.cents).toBe(1200);
    // 225 × 4.1 is 922.4999… in IEEE-754, not 922.5, so it rounds down. Pinned
    // deliberately: Dart's `num.round()` does the same thing with the same
    // inputs, and a client that disagreed by a cent would show a fare that did
    // not match the receipt.
    expect(estimate.distanceCharge.cents).toBe(922);
    expect(estimate.timeCharge.cents).toBe(765); // 45 × 17
    expect(estimate.total.cents).toBe(2887);
    expect(estimate.minimumApplied).toBe(false);
    expect(estimate.ruleVersion).toBe('v1-pilot');
  });

  it('names each surcharge rather than folding it into the total', () => {
    // A wheelchair surcharge reflects the cost of a scarcer vehicle. Hiding it
    // inside the total would make it look like a charge for being disabled.
    const estimate = estimateFare({
      rule,
      distanceMiles: 4.1,
      durationMinutes: 17,
      wheelchairAccessRequired: true,
      assistanceRequired: true,
    });

    expect(estimate.surcharges.map((s) => s.label)).toEqual([
      'Wheelchair-accessible vehicle',
      'Door-through-door assistance',
    ]);
    expect(estimate.total.cents).toBe(2887 + 1500 + 800);
  });

  it('applies the minimum fare and says that it did', () => {
    // An unexplained floor on a short trip reads as a billing error.
    const estimate = estimateFare({
      rule,
      distanceMiles: 0.4,
      durationMinutes: 2,
    });

    expect(estimate.total.cents).toBe(1800);
    expect(estimate.minimumApplied).toBe(true);
  });

  it('does not claim a minimum was applied when the fare already cleared it', () => {
    const estimate = estimateFare({
      rule,
      distanceMiles: 10,
      durationMinutes: 30,
    });
    expect(estimate.minimumApplied).toBe(false);
    expect(estimate.total.cents).toBeGreaterThan(rule.minimumFare.cents);
  });

  it('prices a zero-distance trip at the minimum rather than inventing one', () => {
    // This is the no-coordinates case: better an honest floor than a number
    // that looks precise and is not.
    const estimate = estimateFare({ rule, distanceMiles: 0, durationMinutes: 0 });
    expect(estimate.total.cents).toBe(1800);
    expect(estimate.minimumApplied).toBe(true);
  });

  it('rejects negative inputs', () => {
    expect(() =>
      estimateFare({ rule, distanceMiles: -1, durationMinutes: 10 }),
    ).toThrow(ValidationError);
    expect(() =>
      estimateFare({ rule, distanceMiles: 1, durationMinutes: -10 }),
    ).toThrow(ValidationError);
  });
});

describe('who the fare is split between', () => {
  it('takes nothing from an operator who already pays for their drivers', () => {
    // Charging a per-ride percentage *and* a per-driver subscription is
    // charging twice for the same relationship. An operator finds that in a
    // spreadsheet six months in and never forgives it.
    const settlement = settleFare({
      rule,
      total: new Money(4000),
      operatorSubscribed: true,
    });

    expect(settlement.funding).toBe('operatorSubscription');
    expect(settlement.platformFee).toEqual(Money.zero());
    expect(settlement.operatorPayout).toEqual(new Money(4000));
  });

  it('falls back to basis points for an operator who is not yet on a plan', () => {
    // This is what makes it possible to run a pilot operator before the
    // contract is signed, rather than blocking the first ride on procurement.
    const settlement = settleFare({
      rule,
      total: new Money(4000),
      operatorSubscribed: false,
    });

    expect(settlement.funding).toBe('perRide');
    expect(settlement.platformFee).toEqual(new Money(600));
    expect(settlement.operatorPayout).toEqual(new Money(3400));
  });

  it('charges the family the same total either way', () => {
    const subscribed = settleFare({
      rule,
      total: new Money(4000),
      operatorSubscribed: true,
    });
    const not = settleFare({ rule, total: new Money(4000), operatorSubscribed: false });

    expect(subscribed.total).toEqual(not.total);
    expect(subscribed.platformFee.plus(subscribed.operatorPayout)).toEqual(
      subscribed.total,
    );
    expect(not.platformFee.plus(not.operatorPayout)).toEqual(not.total);
  });

  it('refuses a rule that would take more than the whole fare', () => {
    expect(() =>
      settleFare({
        rule: { ...rule, platformFeeBps: 10_001 },
        total: new Money(4000),
        operatorSubscribed: false,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      settleFare({
        rule: { ...rule, platformFeeBps: -1 },
        total: new Money(4000),
        operatorSubscribed: false,
      }),
    ).toThrow(ValidationError);
  });
});
