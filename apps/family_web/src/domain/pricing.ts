/**
 * Fare estimation. Mirrors lib/domain/pricing.dart; the server's copy is the
 * one that charges. Prices are data, not constants: a rule is a versioned
 * record, so a historical charge can always be explained.
 */
import { multiplyCents } from '../core/money';

export interface PricingRule {
  version: string;
  baseFareCents: number;
  perMileCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
  wheelchairSurchargeCents: number;
  assistanceSurchargeCents: number;
}

export const standardPricingRule: PricingRule = {
  version: 'v1-pilot',
  baseFareCents: 1200,
  perMileCents: 225,
  perMinuteCents: 45,
  minimumFareCents: 1800,
  wheelchairSurchargeCents: 1500,
  assistanceSurchargeCents: 800,
};

export interface Surcharge {
  label: string;
  amountCents: number;
}

/** Itemised, so a family can see what they are paying for. */
export interface PriceEstimate {
  ruleVersion: string;
  distanceMiles: number;
  durationMinutes: number;
  baseCents: number;
  distanceChargeCents: number;
  timeChargeCents: number;
  surcharges: Surcharge[];
  totalCents: number;
  /** Shown, because an unexplained floor on a short trip reads as a billing error. */
  minimumApplied: boolean;
}

export function estimateFare(options: {
  rule: PricingRule;
  distanceMiles: number;
  durationMinutes: number;
  wheelchairAccessRequired?: boolean;
  assistanceRequired?: boolean;
}): PriceEstimate {
  const { rule, distanceMiles, durationMinutes } = options;
  if (distanceMiles < 0 || durationMinutes < 0) {
    throw new RangeError('Distance and duration must not be negative.');
  }

  const distanceChargeCents = multiplyCents(rule.perMileCents, distanceMiles);
  const timeChargeCents = multiplyCents(rule.perMinuteCents, durationMinutes);

  const surcharges: Surcharge[] = [
    ...(options.wheelchairAccessRequired
      ? [{ label: 'Wheelchair-accessible vehicle', amountCents: rule.wheelchairSurchargeCents }]
      : []),
    ...(options.assistanceRequired
      ? [{ label: 'Door-through-door assistance', amountCents: rule.assistanceSurchargeCents }]
      : []),
  ];

  const subtotal =
    rule.baseFareCents +
    distanceChargeCents +
    timeChargeCents +
    surcharges.reduce((sum, s) => sum + s.amountCents, 0);
  const totalCents = Math.max(subtotal, rule.minimumFareCents);

  return {
    ruleVersion: rule.version,
    distanceMiles,
    durationMinutes,
    baseCents: rule.baseFareCents,
    distanceChargeCents,
    timeChargeCents,
    surcharges,
    totalCents,
    minimumApplied: totalCents > subtotal,
  };
}
