import { ApiProperty } from '@nestjs/swagger';

/**
 * The administration wire contract.
 *
 * One rule shapes all of it: **these responses describe actions, never
 * content**. An audit row says that a named person viewed a named document at
 * a given time; it does not say what was in it. That is the same restraint the
 * `changedFields` column has carried since Stage 1 — field names, never values
 * — and it is what lets the audit log be read by support staff who are not
 * entitled to the underlying records.
 */

export class AuditEntryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The actor’s name, resolved for display. Absent for actions the system took on its own.',
  })
  actorName!: string | null;

  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String }) entityType!: string;

  @ApiProperty({ type: String, nullable: true }) entityId!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Field **names** only, never values — the whole reason this log can be read by somebody who may not read the records it describes.',
  })
  changedFields!: string[];

  @ApiProperty({ type: String, nullable: true }) correlationId!: string | null;
  @ApiProperty({ type: String, nullable: true }) ip!: string | null;
}

export class AuditPageDto {
  @ApiProperty({ type: () => [AuditEntryDto] }) entries!: AuditEntryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass as `cursor` for the next page. Keyset rather than an offset: an audit log is appended to constantly, and an offset would skip or repeat rows between pages.',
  })
  nextCursor!: string | null;
}

export class FeatureFlagDto {
  @ApiProperty({ type: String }) key!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: Boolean }) enabled!: boolean;

  @ApiProperty({
    type: 'integer',
    description:
      'Applied to a stable hash of the subject, so a given user is on the same side of the line on every request. A flag that flipped per request would be worse than one that is simply off.',
  })
  rolloutPercent!: number;

  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;

  @ApiProperty({ type: String, nullable: true }) updatedByName!: string | null;
}

export class RefundDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) invoiceId!: string;
  @ApiProperty({ type: String }) invoiceNumber!: string;
  @ApiProperty({ type: 'integer' }) amountCents!: number;
  @ApiProperty({ type: String }) currency!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) status!: string;

  @ApiProperty({ type: String, nullable: true }) failureMessage!: string | null;
  @ApiProperty({ type: String }) requestedByName!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  settledAt!: string | null;
}

export class RefundableInvoiceDto {
  @ApiProperty({ type: String, format: 'uuid' }) invoiceId!: string;
  @ApiProperty({ type: String }) invoiceNumber!: string;
  @ApiProperty({ type: String, format: 'uuid' }) paymentId!: string;
  @ApiProperty({ type: 'integer' }) paidCents!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'What is left to refund: the payment less everything already refunded against it. The ceiling on a new refund.',
  })
  refundableCents!: number;

  @ApiProperty({ type: () => [RefundDto] }) refunds!: RefundDto[];
}

export class PlatformStatsDto {
  @ApiProperty({ type: 'integer' }) ridesLast7Days!: number;
  @ApiProperty({ type: 'integer' }) ridesCompletedLast7Days!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Rides that ended without the passenger travelling. Counted beside completions rather than buried, because it is the number that says whether the product is working for the people it is for.',
  })
  ridesNoShowLast7Days!: number;

  @ApiProperty({ type: 'integer' }) ridesCancelledLast7Days!: number;
  @ApiProperty({ type: 'integer' }) activeRidesNow!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Rides in flight whose last position is older than the staleness bound — the number a dispatcher would want telephoned about.',
  })
  staleTrackingNow!: number;

  @ApiProperty({ type: 'integer' }) familiesSubscribed!: number;
  @ApiProperty({ type: 'integer' }) operatorsSubscribed!: number;
  @ApiProperty({ type: 'integer' }) driversApproved!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Approved drivers whose paperwork lapses within thirty days. Each one is a driver who comes off the road unless somebody telephones.',
  })
  driversWithExpiringDocuments!: number;

  @ApiProperty({ type: 'integer' }) documentsAwaitingReview!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Invoices that have failed at least once and have not been paid. The dunning queue, as a single number.',
  })
  invoicesPastDue!: number;

  @ApiProperty({ type: 'integer' }) revenueCentsLast30Days!: number;
  @ApiProperty({ type: 'integer' }) refundedCentsLast30Days!: number;
}
