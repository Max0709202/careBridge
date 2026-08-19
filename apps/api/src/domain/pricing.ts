import { Money } from './money';
import { ValidationError } from '../common/errors';

/**
 * Fare calculation. Mirrors lib/domain/pricing.dart.
 *
 * Prices are **data, not constants**: a rule is a versioned record so a
 * historical charge can always be explained ("this ride was priced under rule
 * v1-pilot, which had a $12 base"). Nothing here hard-codes an amount — the
 * rule is loaded from the `pricing_rules` table.
 */
export interface PricingRule {
  version: string;
  baseFare: Money;
  perMile: Money;
  perMinute: Money;
  minimumFare: Money;
  /**
   * Reflects the cost of operating a scarcer, more expensive vehicle. It is not
   * a charge for being disabled, and is shown as a named line item rather than
   * folded silently into the total.
   */
  wheelchairSurcharge: Money;
  /** Door-through-door assistance: time that per-mile pricing misses. */
  assistanceSurcharge: Money;

  /**
   * Our cut of a fare, in basis points, **when the transport operator is not
   * on a subscription**.
   *
   * It exists so an operator can be onboarded before they have signed
   * anything, not as a second revenue line stacked on top of their seats. An
   * operator paying per driver keeps the whole fare — see `settleFare`.
   */
  platformFeeBps: number;
  effectiveFrom: Date;
}

export interface Surcharge {
  label: string;
  amount: Money;
}

export interface PriceEstimate {
  ruleVersion: string;
  distanceMiles: number;
  durationMinutes: number;
  base: Money;
  distanceCharge: Money;
  timeCharge: Money;
  surcharges: Surcharge[];
  total: Money;
  /**
   * True when the minimum fare lifted the total. Shown to the family, because
   * an unexplained floor on a short trip reads as a billing error.
   */
  minimumApplied: boolean;
}

/**
 * Where the money a family pays for one ride actually goes.
 *
 * This is the "who pays the fees" question at its narrowest, and it is a
 * *domain* rule rather than an accounting detail, because the answer changes
 * behaviour: an operator on a per-driver subscription has already paid us for
 * the month, so taking a percentage of their fares as well would be charging
 * twice for the same relationship. It is the kind of thing an operator finds
 * in a spreadsheet six months in and never forgives.
 *
 * So the platform fee is funded exactly one way at a time:
 *
 *   - `operatorSubscription` — the operator has an entitling subscription. The
 *     whole fare passes through to them and our margin is their seats.
 *   - `perRide` — no subscription. The rule's basis points apply, which is
 *     what makes it possible to run a pilot operator before the contract.
 *
 * The family pays the same total either way. Which side of this branch a ride
 * landed on is stamped on the ride, alongside the pricing rule version, so a
 * payout can be explained months later.
 */
export type PlatformFunding = 'operatorSubscription' | 'perRide';

export interface FareSettlement {
  /** What the family is charged. Identical under both funding modes. */
  total: Money;
  /** Ours. */
  platformFee: Money;
  /** The operator's. */
  operatorPayout: Money;
  funding: PlatformFunding;
}

export function settleFare(input: {
  rule: PricingRule;
  total: Money;
  operatorSubscribed: boolean;
}): FareSettlement {
  const { rule, total, operatorSubscribed } = input;

  if (rule.platformFeeBps < 0 || rule.platformFeeBps > 10_000) {
    throw new ValidationError('Platform fee must be between 0 and 100 percent.');
  }

  const platformFee = operatorSubscribed
    ? Money.zero()
    : total.times(rule.platformFeeBps / 10_000);

  return {
    total,
    platformFee,
    operatorPayout: total.minus(platformFee),
    funding: operatorSubscribed ? 'operatorSubscription' : 'perRide',
  };
}

export function estimateFare(input: {
  rule: PricingRule;
  distanceMiles: number;
  durationMinutes: number;
  wheelchairAccessRequired?: boolean;
  assistanceRequired?: boolean;
}): PriceEstimate {
  const {
    rule,
    distanceMiles,
    durationMinutes,
    wheelchairAccessRequired = false,
    assistanceRequired = false,
  } = input;

  if (distanceMiles < 0 || durationMinutes < 0) {
    throw new ValidationError('Distance and duration must not be negative.');
  }

  const distanceCharge = rule.perMile.times(distanceMiles);
  const timeCharge = rule.perMinute.times(durationMinutes);

  const surcharges: Surcharge[] = [];
  if (wheelchairAccessRequired) {
    surcharges.push({
      label: 'Wheelchair-accessible vehicle',
      amount: rule.wheelchairSurcharge,
    });
  }
  if (assistanceRequired) {
    surcharges.push({
      label: 'Door-through-door assistance',
      amount: rule.assistanceSurcharge,
    });
  }

  let subtotal = rule.baseFare.plus(distanceCharge).plus(timeCharge);
  for (const s of surcharges) {
    subtotal = subtotal.plus(s.amount);
  }

  const total = Money.max(subtotal, rule.minimumFare);

  return {
    ruleVersion: rule.version,
    distanceMiles,
    durationMinutes,
    base: rule.baseFare,
    distanceCharge,
    timeCharge,
    surcharges,
    total,
    minimumApplied: total.greaterThan(subtotal),
  };
}
