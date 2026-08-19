import type { Prisma } from '@prisma/client';

import { Money } from '../../domain/money';
import type { Entitlement, SubscriptionEntitlementState } from '../../domain/billing';
import type {
  SubscriptionPlan,
  SubscriptionQuote,
} from '../../domain/subscription-pricing';
import type {
  SubscriptionPlanDto,
  SubscriptionQuoteDto,
  SeatLedgerEntryDto,
} from './billing.dto';

/**
 * Rows in, rules out.
 *
 * The domain types below carry `Money` and a closed `Entitlement` union; the
 * database carries integers and `String[]`. This file is the one place the two
 * meet, which is what keeps `src/domain/` free of Prisma — see the boundary
 * rule in packages/eslint-config/boundaries.js.
 */

export const PLAN_INCLUDE = {
  seatTiers: { orderBy: { position: 'asc' } },
} satisfies Prisma.SubscriptionPlanInclude;

export type PlanRow = Prisma.SubscriptionPlanGetPayload<{
  include: typeof PLAN_INCLUDE;
}>;

export const SUBSCRIPTION_INCLUDE = {
  plan: { include: PLAN_INCLUDE },
  billingAccount: true,
} satisfies Prisma.SubscriptionInclude;

export type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

export function toPlanDomain(row: PlanRow): SubscriptionPlan {
  return {
    code: row.code,
    version: row.version,
    payer: row.payer,
    interval: row.interval,
    name: row.name,
    basePrice: new Money(row.basePriceCents),
    includedSeats: row.includedSeats,
    seatTiers: row.seatTiers.map((tier) => ({
      upToSeats: tier.upToSeats,
      unitPrice: new Money(tier.unitPriceCents),
    })),
    // Written through `assertEntitlementsMatchPayer`, so the cast reflects a
    // constraint the write path enforces rather than a hope about the column.
    entitlements: row.entitlements as Entitlement[],
    trialDays: row.trialDays,
    graceDays: row.graceDays,
  };
}

export function toEntitlementState(row: SubscriptionRow): SubscriptionEntitlementState {
  return {
    status: row.status,
    entitlements: row.plan.entitlements as Entitlement[],
    currentPeriodEnd: row.currentPeriodEnd,
    pastDueSince: row.pastDueSince,
    graceDays: row.plan.graceDays,
  };
}

export function toPlanDto(row: PlanRow): SubscriptionPlanDto {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    payer: row.payer,
    interval: row.interval,
    name: row.name,
    description: row.description,
    basePriceCents: row.basePriceCents,
    includedSeats: row.includedSeats,
    seatTiers: row.seatTiers.map((tier) => ({
      upToSeats: tier.upToSeats,
      unitPriceCents: tier.unitPriceCents,
    })),
    entitlements: row.entitlements,
    trialDays: row.trialDays,
    graceDays: row.graceDays,
  };
}

export function toQuoteDto(quote: SubscriptionQuote): SubscriptionQuoteDto {
  return {
    planCode: quote.planCode,
    planVersion: quote.planVersion,
    interval: quote.interval,
    seats: quote.seats,
    billableSeats: quote.billableSeats,
    lines: quote.lines.map((line) => ({
      label: line.label,
      quantity: line.quantity,
      unitPriceCents: line.unitPrice.cents,
      amountCents: line.amount.cents,
    })),
    totalCents: quote.total.cents,
  };
}

/** The itemisation stored on a period, so an invoice can be reprinted. */
export function toStoredLines(quote: SubscriptionQuote): Prisma.InputJsonValue {
  return quote.lines.map((line) => ({
    label: line.label,
    quantity: line.quantity,
    unitPriceCents: line.unitPrice.cents,
    amountCents: line.amount.cents,
  }));
}

export function toSeatLedgerDto(
  row: Prisma.SeatLedgerEntryGetPayload<{ include: { driver: true } }>,
): SeatLedgerEntryDto {
  return {
    id: row.id,
    driverId: row.driverId,
    driverDisplayName: row.driver.displayName,
    change: row.change,
    at: row.at.toISOString(),
    seatsAfter: row.seatsAfter,
    prorationCents: row.prorationCents,
  };
}
