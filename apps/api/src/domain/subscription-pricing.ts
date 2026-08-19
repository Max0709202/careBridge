import { Money } from './money';
import { ValidationError } from '../common/errors';
import type { BillingInterval, BillingPayer, Entitlement } from './billing';

/**
 * What a subscription costs. Mirrors lib/domain/subscription_pricing.dart.
 *
 * The family side is a flat price per interval. The dispatch side is priced by
 * **drivers on the road**, which is the only number an operator already tracks
 * and the only one that moves with the value they get from us. Per-ride
 * platform pricing was the alternative and it is worse for both sides: it
 * makes our revenue rise exactly when an operator's margin is thinnest, and it
 * gives them a reason to route their busiest days around us.
 *
 * Everything here is pure and integer-cents. Nothing hard-codes an amount: a
 * `SubscriptionPlan` is a row, versioned, so an invoice from eight months ago
 * can still be explained to the person who paid it.
 */

/**
 * One band of the graduated seat price. `upToSeats` is a **total driver
 * count**, inclusive, because that is how the price is stated to the operator:
 * "the first 5 drivers are included, 6 to 20 are $18 each, 21 and up are $14".
 * The final tier carries `upToSeats: null`, meaning "and everything above".
 */
export interface SeatTier {
  upToSeats: number | null;
  unitPrice: Money;
}

export interface SubscriptionPlan {
  code: string;
  /** Immutable price identity, stamped onto every period it bills. */
  version: string;
  payer: BillingPayer;
  interval: BillingInterval;
  name: string;
  /** The fixed part. For a family plan this is the whole price. */
  basePrice: Money;
  /** Drivers covered by `basePrice`. Always 0 on a family plan. */
  includedSeats: number;
  /** Empty on a family plan: a household does not have seats. */
  seatTiers: readonly SeatTier[];
  entitlements: readonly Entitlement[];
  trialDays: number;
  /** How long a failed payment keeps entitling. See `activeEntitlements`. */
  graceDays: number;
}

export interface SubscriptionLine {
  label: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
}

export interface SubscriptionQuote {
  planCode: string;
  planVersion: string;
  interval: BillingInterval;
  /** Drivers counted. Zero for a family plan. */
  seats: number;
  /** Drivers actually charged for — seats beyond those the base price covers. */
  billableSeats: number;
  lines: readonly SubscriptionLine[];
  total: Money;
}

/**
 * Tiers must be ascending and must end unbounded. Validated here rather than
 * trusted from the row, because the failure mode of a mis-seeded ladder is a
 * silently under-billed operator — an error that is discovered by an
 * accountant, months later, and is unrecoverable by then.
 */
export function assertSeatTiersWellFormed(tiers: readonly SeatTier[]): void {
  if (tiers.length === 0) return;

  let previous = 0;
  for (const [index, tier] of tiers.entries()) {
    const isLast = index === tiers.length - 1;

    if (tier.upToSeats == null) {
      if (!isLast) {
        throw new ValidationError(
          'Only the final seat tier may be unbounded.',
          'seatTiers',
        );
      }
      continue;
    }

    if (isLast) {
      throw new ValidationError(
        'The final seat tier must be unbounded, or drivers above it are free.',
        'seatTiers',
      );
    }
    if (tier.upToSeats <= previous) {
      throw new ValidationError('Seat tiers must ascend.', 'seatTiers');
    }
    previous = tier.upToSeats;
  }
}

/**
 * Graduated, not volume: each driver is priced in the band they fall in, and
 * crossing a boundary never re-prices the drivers below it.
 *
 * Volume pricing — every seat at the rate the *total* reaches — was rejected
 * because it produces a bill that falls when an operator hires. Explaining to
 * a dispatcher that their invoice went down because they grew is a
 * conversation that ends in a spreadsheet nobody trusts again.
 */
export function seatCharges(
  plan: SubscriptionPlan,
  seats: number,
): readonly SubscriptionLine[] {
  if (!Number.isInteger(seats) || seats < 0) {
    throw new ValidationError('Seat count must be a whole number of drivers.', 'seats');
  }
  assertSeatTiersWellFormed(plan.seatTiers);

  const lines: SubscriptionLine[] = [];
  let floor = plan.includedSeats;

  for (const tier of plan.seatTiers) {
    const ceiling = Math.min(tier.upToSeats ?? Number.MAX_SAFE_INTEGER, seats);
    const quantity = Math.max(0, ceiling - floor);

    if (quantity > 0) {
      lines.push({
        label: seatTierLabel(floor + 1, tier.upToSeats),
        quantity,
        unitPrice: tier.unitPrice,
        amount: tier.unitPrice.times(quantity),
      });
    }

    floor = Math.max(floor, tier.upToSeats ?? floor);
    if (tier.upToSeats != null && seats <= tier.upToSeats) break;
  }

  return lines;
}

function seatTierLabel(from: number, upTo: number | null): string {
  return upTo == null ? `Drivers ${from} and above` : `Drivers ${from}–${upTo}`;
}

/** Drivers charged for: everything past what the base price already covers. */
export function billableSeats(plan: SubscriptionPlan, seats: number): number {
  return Math.max(0, seats - plan.includedSeats);
}

/**
 * The price of one period. Itemised, because an operator who cannot see which
 * band their twenty-first driver landed in has no way to check the bill, and a
 * bill nobody can check is a bill somebody eventually disputes.
 */
export function quoteSubscription(input: {
  plan: SubscriptionPlan;
  seats?: number;
}): SubscriptionQuote {
  const { plan } = input;
  const seats = input.seats ?? 0;

  if (plan.payer === 'family' && seats !== 0) {
    throw new ValidationError('A family plan is not priced by seats.', 'seats');
  }

  const lines: SubscriptionLine[] = [
    {
      label: plan.name,
      quantity: 1,
      unitPrice: plan.basePrice,
      amount: plan.basePrice,
    },
    ...seatCharges(plan, seats),
  ];

  let total = Money.zero();
  for (const line of lines) total = total.plus(line.amount);

  return {
    planCode: plan.code,
    planVersion: plan.version,
    interval: plan.interval,
    seats,
    billableSeats: billableSeats(plan, seats),
    lines,
    total,
  };
}

/** Recurring price of a plan at a seat count, without the itemisation. */
export function periodPrice(plan: SubscriptionPlan, seats = 0): Money {
  return quoteSubscription({ plan, seats }).total;
}

// ─── mid-period changes ──────────────────────────────────────────────────────

/**
 * The unused fraction of a period, as an amount.
 *
 * Rounded by `Money.times`, which rounds half away from zero and matches the
 * client — a one-cent disagreement between the proration we charge and the one
 * the app previewed is a support ticket, not a rounding detail.
 */
export function prorate(input: {
  amount: Money;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
}): Money {
  const { amount, periodStart, periodEnd, effectiveAt } = input;

  const span = periodEnd.getTime() - periodStart.getTime();
  if (span <= 0) {
    throw new ValidationError(
      'A billing period must end after it starts.',
      'periodEnd',
    );
  }

  const remaining = periodEnd.getTime() - effectiveAt.getTime();
  const fraction = Math.min(1, Math.max(0, remaining / span));
  return amount.times(fraction);
}

export type SeatChangeEffect = 'immediately' | 'nextRenewal';

export interface SeatChangeQuote {
  /** The high-water mark this quote was measured against. */
  seatsPaidFor: number;
  seatsAfter: number;
  /** Charged now, prorated for the rest of the period. Zero on a reduction. */
  dueNow: Money;
  /** What the next renewal will be quoted at. */
  seatsFromNextRenewal: number;
  /** The high-water mark after this change. Never decreases within a period. */
  seatsPaidForAfter: number;
  effect: SeatChangeEffect;
}

/**
 * Adding a driver is charged immediately for the remainder of the period;
 * removing one takes effect at renewal and is not refunded.
 *
 * The asymmetry is deliberate and is stated on the pricing page rather than
 * discovered on an invoice. The seat an operator releases stays usable until
 * the period they paid for ends, so what they lose is the option to churn
 * seats daily around a renewal date — which is the failure this rule exists
 * for, not a fee.
 *
 * Which is exactly why the comparison is against `seatsPaidFor` — the **high
 * water mark for the period** — and not against the current head count. An
 * operator who drops from twelve drivers to ten and back to twelve inside one
 * month has already paid for twelve; charging the proration again on the way
 * back up would bill the same two seats twice, and would do it precisely to
 * the operator whose staffing is least stable. The mark resets at renewal,
 * which is the moment the reduction actually takes effect.
 */
export function quoteSeatChange(input: {
  plan: SubscriptionPlan;
  /** The highest seat count already charged for in the current period. */
  seatsPaidFor: number;
  seatsAfter: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
}): SeatChangeQuote {
  const { plan, seatsPaidFor, seatsAfter, periodStart, periodEnd, effectiveAt } = input;

  if (seatsAfter <= seatsPaidFor) {
    return {
      seatsPaidFor,
      seatsAfter,
      dueNow: Money.zero(),
      seatsFromNextRenewal: seatsAfter,
      seatsPaidForAfter: seatsPaidFor,
      effect: 'nextRenewal',
    };
  }

  const increase = periodPrice(plan, seatsAfter).minus(periodPrice(plan, seatsPaidFor));

  return {
    seatsPaidFor,
    seatsAfter,
    dueNow: prorate({ amount: increase, periodStart, periodEnd, effectiveAt }),
    seatsFromNextRenewal: seatsAfter,
    seatsPaidForAfter: seatsAfter,
    effect: 'immediately',
  };
}

export interface IntervalSwitchQuote {
  fromPlanCode: string;
  toPlanCode: string;
  /** Unused portion of what they already paid. */
  credit: Money;
  /** Full price of the period they are moving to. */
  charge: Money;
  /** What they owe today: the charge less the credit, floored at zero. */
  dueNow: Money;
  /** Credit that outran the charge, held against the next renewal. */
  carriedCredit: Money;
}

/**
 * Monthly ⇄ annual. The current period is credited for its unused remainder
 * and a fresh period starts today.
 *
 * Annual → monthly therefore usually produces a *credit*, not a refund: money
 * already taken stays taken and is spent down against renewals. Refunding it
 * would make an annual plan a free interest-bearing account, and saying so
 * plainly is better than the alternative, which is a support queue asking why
 * the refund has not arrived.
 */
export function quoteIntervalSwitch(input: {
  from: SubscriptionPlan;
  to: SubscriptionPlan;
  seats?: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
}): IntervalSwitchQuote {
  const { from, to, periodStart, periodEnd, effectiveAt } = input;
  const seats = input.seats ?? 0;

  if (from.payer !== to.payer) {
    throw new ValidationError(
      'A subscription cannot change which side of the marketplace pays for it.',
      'planCode',
    );
  }
  if (from.interval === to.interval) {
    throw new ValidationError('That is already the billing interval.', 'interval');
  }

  const credit = prorate({
    amount: periodPrice(from, seats),
    periodStart,
    periodEnd,
    effectiveAt,
  });
  const charge = periodPrice(to, seats);
  const balance = charge.minus(credit);

  return {
    fromPlanCode: from.code,
    toPlanCode: to.code,
    credit,
    charge,
    dueNow: Money.max(balance, Money.zero()),
    carriedCredit: Money.max(credit.minus(charge), Money.zero()),
  };
}
