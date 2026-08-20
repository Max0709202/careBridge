import { ApiProperty } from '@nestjs/swagger';

import {
  BILLING_INTERVALS,
  BILLING_PAYERS,
  SUBSCRIPTION_STATUSES,
} from '../../domain/billing';
import { INVOICE_REASONS, INVOICE_STATUSES } from '../../domain/invoicing';

/**
 * The wire contract for money the *platform* is paid — as distinct from
 * `care.dto.ts`, which carries the money a family pays for a ride.
 *
 * Same two conventions as care.dto.ts, and for the same reason (the OpenAPI
 * document is generated from these decorators and the Dart client from that):
 * classes rather than interfaces, and every type written out.
 *
 * Amounts are integer cents. Nothing here is ever a float.
 */

export class SubscriptionSeatTierDto {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Total driver count this band covers, inclusive. Null on the final band, which is unbounded.',
  })
  upToSeats!: number | null;

  @ApiProperty({ type: 'integer' }) unitPriceCents!: number;
}

export class SubscriptionPlanDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;

  @ApiProperty({
    type: String,
    description:
      'Immutable price identity, stamped onto every period this plan bills — so a charge from eight months ago can still be explained.',
  })
  version!: string;

  @ApiProperty({ enum: BILLING_PAYERS, enumName: 'BillingPayer' }) payer!: string;
  @ApiProperty({ enum: BILLING_INTERVALS, enumName: 'BillingInterval' })
  interval!: string;

  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: 'integer' }) basePriceCents!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Drivers covered by the base price. Always 0 on a family plan.',
  })
  includedSeats!: number;

  @ApiProperty({ type: () => [SubscriptionSeatTierDto] })
  seatTiers!: SubscriptionSeatTierDto[];

  @ApiProperty({ type: [String] }) entitlements!: string[];
  @ApiProperty({ type: 'integer' }) trialDays!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'How long a failed payment keeps entitling. Not zero: cutting live tracking off the instant a card expires blanks the map mid-trip.',
  })
  graceDays!: number;
}

export class SubscriptionLineDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: 'integer' }) quantity!: number;
  @ApiProperty({ type: 'integer' }) unitPriceCents!: number;
  @ApiProperty({ type: 'integer' }) amountCents!: number;
}

export class SubscriptionQuoteDto {
  @ApiProperty({ type: String }) planCode!: string;
  @ApiProperty({ type: String }) planVersion!: string;
  @ApiProperty({ enum: BILLING_INTERVALS, enumName: 'BillingInterval' })
  interval!: string;
  @ApiProperty({ type: 'integer' }) seats!: number;
  @ApiProperty({ type: 'integer' }) billableSeats!: number;
  @ApiProperty({ type: () => [SubscriptionLineDto] }) lines!: SubscriptionLineDto[];
  @ApiProperty({ type: 'integer' }) totalCents!: number;
}

export class SubscriptionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: BILLING_PAYERS, enumName: 'BillingPayer' }) payer!: string;
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus' })
  status!: string;

  @ApiProperty({ enum: BILLING_INTERVALS, enumName: 'BillingInterval' })
  interval!: string;
  @ApiProperty({ type: String }) planCode!: string;
  @ApiProperty({ type: String }) planName!: string;
  @ApiProperty({ type: String }) planVersion!: string;

  @ApiProperty({
    type: 'integer',
    description: 'Drivers billed from the next renewal. Zero on a family subscription.',
  })
  seats!: number;

  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodEnd!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  trialEndsAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a payment first failed. Entitlements survive until this plus the plan grace window.',
  })
  pastDueSince!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelRequestedAt!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'What is switched on right now — resolved server-side from status, period and grace. The client renders it; it never derives it.',
  })
  entitlements!: string[];

  @ApiProperty({ type: 'integer' }) carriedCreditCents!: number;

  @ApiProperty({
    type: () => SubscriptionQuoteDto,
    description: 'What the next renewal will cost at the current driver count.',
  })
  renewalQuote!: SubscriptionQuoteDto;
}

export class InvoiceLineDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: 'integer' }) quantity!: number;
  @ApiProperty({ type: 'integer' }) unitPriceCents!: number;
  @ApiProperty({ type: 'integer' }) amountCents!: number;
}

export class InvoiceDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;

  @ApiProperty({
    type: String,
    description:
      'Human-quotable. An invoice somebody rings up about has to be findable by the number printed on it.',
  })
  number!: string;

  @ApiProperty({
    enum: INVOICE_REASONS,
    enumName: 'InvoiceReason',
    description:
      'What raised it: a billed period, drivers added mid-period, or an interval switch.',
  })
  reason!: string;

  @ApiProperty({
    enum: INVOICE_STATUSES,
    enumName: 'InvoiceStatus',
    description:
      '`uncollectible` is owed and was pursued; `void` was never owed. They are not the same and are never merged.',
  })
  status!: string;

  @ApiProperty({ type: String }) currency!: string;
  @ApiProperty({ type: 'integer' }) subtotalCents!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Credit spent against this invoice.',
  })
  creditAppliedCents!: number;

  @ApiProperty({ type: 'integer' }) totalCents!: number;
  @ApiProperty({ type: 'integer' }) amountPaidCents!: number;

  @ApiProperty({ type: () => [InvoiceLineDto] }) lines!: InvoiceLineDto[];

  @ApiProperty({ type: String, format: 'date-time' }) issuedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'Charges attempted, including the first.',
  })
  attemptCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the next attempt is scheduled. Null once we have stopped trying.',
  })
  nextAttemptAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The processor's code for the last decline, for support to read.",
  })
  lastFailureCode!: string | null;
}

export class PaymentMethodDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;

  @ApiProperty({
    type: String,
    description: 'Card brand. Display only — no card number exists in this system.',
  })
  brand!: string;

  @ApiProperty({ type: String }) last4!: string;
  @ApiProperty({ type: 'integer' }) expMonth!: number;
  @ApiProperty({ type: 'integer' }) expYear!: number;

  @ApiProperty({
    type: Boolean,
    description: 'Which card renewals are charged against. At most one per account.',
  })
  isDefault!: boolean;
}

export class BillingAccountDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: BILLING_PAYERS, enumName: 'BillingPayer' }) payer!: string;
  @ApiProperty({ type: String }) billingEmail!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Set on an operator account, null on a family one.',
  })
  organizationId!: string | null;

  @ApiProperty({ type: () => SubscriptionDto, nullable: true })
  subscription!: SubscriptionDto | null;

  @ApiProperty({
    type: () => PaymentMethodDto,
    nullable: true,
    description: 'The card renewals are charged against, or null if there is none.',
  })
  paymentMethod!: PaymentMethodDto | null;

  @ApiProperty({
    type: 'integer',
    description:
      'Total owed across every open invoice. Zero when nothing is outstanding.',
  })
  amountDueCents!: number;
}

export class SeatLedgerEntryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) driverId!: string;
  @ApiProperty({ type: String }) driverDisplayName!: string;
  @ApiProperty({ type: String, enum: ['granted', 'released'], enumName: 'SeatChange' })
  change!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ type: 'integer' }) seatsAfter!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Charged immediately for the remainder of the period on a grant. Zero on a release — a released seat stays usable until the period that paid for it ends.',
  })
  prorationCents!: number;
}

export class OrganizationSeatsDto {
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;

  @ApiProperty({
    type: 'integer',
    description: 'Drivers on the road right now.',
  })
  activeDrivers!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Drivers the current subscription is billing for.',
  })
  billedSeats!: number;

  @ApiProperty({ type: () => SubscriptionQuoteDto, nullable: true })
  renewalQuote!: SubscriptionQuoteDto | null;

  @ApiProperty({ type: () => [SeatLedgerEntryDto] })
  ledger!: SeatLedgerEntryDto[];
}

export class OrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String }) timeZone!: string;

  @ApiProperty({
    type: String,
    enum: ['owner', 'admin', 'dispatcher', 'member'],
    enumName: 'OrgRole',
    description: "The caller's role in this organisation.",
  })
  role!: string;
}
