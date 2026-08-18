import { Money } from './money';

describe('Money', () => {
  it('refuses a fraction of a cent', () => {
    // The constructor is the only place this can be caught. A Money holding
    // 10.5 cents produces totals that do not add up to their own line items,
    // and nothing downstream would notice.
    expect(() => new Money(10.5)).toThrow('Money must be whole cents.');
    expect(() => new Money(Number.NaN)).toThrow('Money must be whole cents.');
  });

  it('adds and subtracts without leaving cents', () => {
    expect(Money.zero().cents).toBe(0);
    expect(new Money(1250).plus(new Money(399)).cents).toBe(1649);
    expect(new Money(1250).minus(new Money(399)).cents).toBe(851);
    expect(Money.zero().minus(new Money(500)).cents).toBe(-500);
  });

  it('rounds half away from zero, in both directions', () => {
    // `Math.round` breaks ties towards positive infinity, so a rate applied to
    // a credit would round the opposite way from the same rate applied to a
    // charge. Dart's num.round() goes half away from zero; this matches it, and
    // a one-cent disagreement is a total that contradicts its own itemisation.
    expect(new Money(1).times(2.5).cents).toBe(3);
    expect(new Money(-1).times(2.5).cents).toBe(-3);
  });

  it('compares by cents', () => {
    expect(Money.max(new Money(500), new Money(700)).cents).toBe(700);
    expect(Money.max(new Money(700), new Money(700)).cents).toBe(700);
    expect(new Money(701).greaterThan(new Money(700))).toBe(true);
    expect(new Money(700).greaterThan(new Money(700))).toBe(false);
  });

  it('formats with two decimal places, including the awkward ones', () => {
    expect(new Money(0).format()).toBe('$0.00');
    expect(new Money(5).format()).toBe('$0.05');
    expect(new Money(1250).format()).toBe('$12.50');
    expect(new Money(100000).format()).toBe('$1000.00');
    expect(new Money(-1250).format()).toBe('-$12.50');
    expect(new Money(-5).format()).toBe('-$0.05');
  });
});
