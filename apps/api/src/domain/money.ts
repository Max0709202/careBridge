/**
 * Money held as integer minor units (cents).
 *
 * Never use a float for money: 0.1 + 0.2 !== 0.3 in binary floating point, and
 * a fare assembled from a base, a per-mile rate and a surcharge accumulates
 * exactly that kind of error. Everything here stays in cents and rounds
 * explicitly at the one point where rounding is unavoidable.
 *
 * Mirrors lib/core/money.dart.
 */
export class Money {
  constructor(readonly cents: number) {
    if (!Number.isInteger(cents)) {
      throw new Error('Money must be whole cents.');
    }
  }

  static zero(): Money {
    return new Money(0);
  }

  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  minus(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  /**
   * Multiply by a rate (miles, minutes). Rounds half away from zero at the
   * moment of conversion, which is the only place precision is lost.
   */
  times(factor: number): Money {
    return new Money(roundHalfAwayFromZero(this.cents * factor));
  }

  static max(a: Money, b: Money): Money {
    return a.cents >= b.cents ? a : b;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  format(): string {
    const negative = this.cents < 0;
    const abs = Math.abs(this.cents);
    const dollars = Math.trunc(abs / 100);
    const remainder = String(abs % 100).padStart(2, '0');
    return `${negative ? '-' : ''}$${dollars}.${remainder}`;
  }
}

/**
 * `Math.round` breaks ties towards positive infinity, so -0.5 rounds to -0 and
 * a negative adjustment would round the opposite way from its positive twin.
 * Dart's `num.round()` rounds half away from zero; matching it keeps client and
 * server totals identical to the cent.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
