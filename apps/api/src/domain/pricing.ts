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
