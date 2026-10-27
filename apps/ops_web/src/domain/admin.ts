/**
 * The administration surface, as the console renders it. A port of
 * apps/ops_console/lib/domain/admin.dart.
 *
 * **These records describe actions, never content.** An audit row says that a
 * named person viewed a named driver's licence; `changedFields` carries field
 * *names* with no values beside them. Nothing on this side may undo that by
 * rendering a value the wire did not send.
 */

/** The operational dashboard. Every field is a number somebody acts on. */
export interface PlatformStats {
  ridesLast7Days: number;
  ridesCompletedLast7Days: number;
  /** Rides that ended without the passenger travelling. */
  ridesNoShowLast7Days: number;
  ridesCancelledLast7Days: number;
  activeRidesNow: number;
  /** Rides in flight whose last position is older than the staleness bound. */
  staleTrackingNow: number;
  familiesSubscribed: number;
  operatorsSubscribed: number;
  driversApproved: number;
  /** Approved drivers whose paperwork lapses within thirty days. */
  driversWithExpiringDocuments: number;
  documentsAwaitingReview: number;
  /** The dunning queue, as one number. */
  invoicesPastDue: number;
  revenueCentsLast30Days: number;
  refundedCentsLast30Days: number;
}

/**
 * Whether anything is asking for a person right now. A screen that always
 * leads with red trains people to stop reading it.
 */
export const needsAttention = (s: PlatformStats) =>
  s.staleTrackingNow > 0 ||
  s.documentsAwaitingReview > 0 ||
  s.driversWithExpiringDocuments > 0 ||
  s.invoicesPastDue > 0;

/**
 * Completions as a share of rides that reached an end state. Null rather than
 * zero when nothing finished: 0% and "no rides yet" are different facts.
 */
export function completionRate(s: PlatformStats): number | null {
  const ended =
    s.ridesCompletedLast7Days + s.ridesNoShowLast7Days + s.ridesCancelledLast7Days;
  return ended === 0 ? null : s.ridesCompletedLast7Days / ended;
}

/** Money kept, after refunds, over the last thirty days. */
export const netRevenueCentsLast30Days = (s: PlatformStats) =>
  s.revenueCentsLast30Days - s.refundedCentsLast30Days;

/** One row of the append-only audit log. */
export interface AuditEntry {
  id: string;
  at: Date;
  /** Dotted, and matched as a prefix by the filter. */
  action: string;
  entityType: string;
  /** Field **names** only, never values. */
  changedFields: readonly string[];
  actorUserId: string | null;
  /** Absent for actions the system took on its own — meaningful, not missing. */
  actorName: string | null;
  entityId: string | null;
  correlationId: string | null;
  ip: string | null;
}

/** Whether a scheduled job did this rather than a person. */
export const isSystem = (e: AuditEntry) => e.actorUserId === null;

export const actorLabel = (e: AuditEntry) =>
  e.actorName ?? (isSystem(e) ? 'CareBridge' : 'Unknown');

/** One keyset page of the log, and the key to the next. */
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface AuditFilter {
  /** Matched as a prefix by the server. */
  action?: string;
  entityType?: string;
  entityId?: string;
}

export const isEmptyFilter = (f: AuditFilter) =>
  !f.action && !f.entityType && !f.entityId;

export interface FeatureFlag {
  key: string;
  description: string;
  /** The master switch, checked before the percentage. Off is off for everybody. */
  enabled: boolean;
  /** 0–100, applied to a stable hash of the subject. */
  rolloutPercent: number;
  updatedAt: Date;
  updatedByName: string | null;
}

/** What the flag actually does right now, in a sentence. */
export function flagSummary(f: FeatureFlag): string {
  if (!f.enabled) return 'Off for everybody';
  if (f.rolloutPercent >= 100) return 'On for everybody';
  if (f.rolloutPercent <= 0) return 'On, but rolled out to nobody';
  return `On for ${f.rolloutPercent}% of subjects`;
}

/** Mirrors `rolloutTakesFeatureAway` in apps/api/src/domain/feature-flags.ts. */
export const narrowsTo = (f: FeatureFlag, to: number) => to < f.rolloutPercent;

/**
 * Whether saving would take the feature away from anybody who has it.
 * Switching the master off is the widest narrowing there is.
 */
export const takesAwayBy = (
  f: FeatureFlag,
  next: { enabled: boolean; percent: number },
) => f.enabled && (!next.enabled || narrowsTo(f, next.percent));

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export function parseRefundStatus(value: unknown): RefundStatus | null {
  return (REFUND_STATUSES as readonly unknown[]).includes(value)
    ? (value as RefundStatus)
    : null;
}

export const refundStatusLabel: Record<RefundStatus, string> = {
  pending: 'In flight',
  succeeded: 'Sent',
  failed: 'Failed',
};

export interface Refund {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  requestedByName: string;
  createdAt: Date;
  failureMessage: string | null;
  settledAt: Date | null;
}

/** Not a failure: money that may still be moving. */
export const isInFlight = (r: Refund) => r.status === 'pending';

export interface RefundableInvoice {
  invoiceId: string;
  invoiceNumber: string;
  /** Passed back to the server so a refund lands on the payment that was on screen. */
  paymentId: string;
  paidCents: number;
  /** The ceiling on a new refund; the server enforces it again. */
  refundableCents: number;
  refunds: Refund[];
}

export const isFullyRefunded = (i: RefundableInvoice) => i.refundableCents <= 0;
export const refundedCents = (i: RefundableInvoice) => i.paidCents - i.refundableCents;

/** Issuing a second refund while the first is in flight is how an account gets credited twice. */
export const hasInFlightRefund = (i: RefundableInvoice) => i.refunds.some(isInFlight);
