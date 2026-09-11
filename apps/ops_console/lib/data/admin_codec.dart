import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../domain/admin.dart';

/// Wire → domain, for the administration surface.
///
/// Kept out of `lib/domain/` for the reason `ops_codec.dart` states: the
/// domain must not know the wire exists, or it stops being a model of the
/// rules and becomes a model of one API version.
///
/// The handling of an unrecognised value differs from the dispatch codec next
/// to it, and deliberately. There, a driver whose status this build does not
/// know is **dropped**, because every control on the roster is gated on that
/// status and a guess would offer a control the server then refuses. Here,
/// nothing is gated on the values: an audit row is a sentence and a refund
/// status is a label. The failure mode of dropping a row is worse than the
/// failure mode of rendering an unfamiliar one — an audit log that quietly
/// omits rows is the one thing an audit log cannot be.
PlatformStats statsFromWire(wire.PlatformStatsDto dto) => PlatformStats(
  ridesLast7Days: dto.ridesLast7Days,
  ridesCompletedLast7Days: dto.ridesCompletedLast7Days,
  ridesNoShowLast7Days: dto.ridesNoShowLast7Days,
  ridesCancelledLast7Days: dto.ridesCancelledLast7Days,
  activeRidesNow: dto.activeRidesNow,
  staleTrackingNow: dto.staleTrackingNow,
  familiesSubscribed: dto.familiesSubscribed,
  operatorsSubscribed: dto.operatorsSubscribed,
  driversApproved: dto.driversApproved,
  driversWithExpiringDocuments: dto.driversWithExpiringDocuments,
  documentsAwaitingReview: dto.documentsAwaitingReview,
  invoicesPastDue: dto.invoicesPastDue,
  revenueCentsLast30Days: dto.revenueCentsLast30Days,
  refundedCentsLast30Days: dto.refundedCentsLast30Days,
);

AuditEntry auditEntryFromWire(wire.AuditEntryDto dto) => AuditEntry(
  id: dto.id,
  at: dto.at,
  action: dto.action,
  entityType: dto.entityType,
  // Field names, never values — copied across as they arrive. Nothing on this
  // side may add a value beside one.
  changedFields: List.unmodifiable(dto.changedFields),
  actorUserId: dto.actorUserId,
  actorName: dto.actorName,
  entityId: dto.entityId,
  correlationId: dto.correlationId,
  ip: dto.ip,
);

AuditPage auditPageFromWire(wire.AuditPageDto dto) => AuditPage(
  entries: dto.entries.map(auditEntryFromWire).toList(),
  nextCursor: dto.nextCursor,
);

FeatureFlag flagFromWire(wire.FeatureFlagDto dto) => FeatureFlag(
  key: dto.key,
  description: dto.description,
  enabled: dto.enabled,
  rolloutPercent: dto.rolloutPercent,
  updatedAt: dto.updatedAt,
  updatedByName: dto.updatedByName,
);

/// A refund, or null on a status this build does not recognise.
///
/// The one place in this file that drops rather than renders, and for the
/// reason the dispatch codec drops a driver: the three statuses are not
/// decoration. `pending` means money may still be moving and a second refund
/// would credit the account twice; `failed` means it did not go. A fourth
/// value shown under a borrowed label could invite either mistake, and this is
/// the screen where a mistake is money.
Refund? refundFromWire(wire.RefundDto dto) {
  final status = RefundStatus.tryParse(dto.status.wireName);
  if (status == null) return null;

  return Refund(
    id: dto.id,
    invoiceId: dto.invoiceId,
    invoiceNumber: dto.invoiceNumber,
    amountCents: dto.amountCents,
    currency: dto.currency,
    reason: dto.reason,
    status: status,
    requestedByName: dto.requestedByName,
    createdAt: dto.createdAt,
    failureMessage: dto.failureMessage,
    settledAt: dto.settledAt,
  );
}

RefundableInvoice refundableFromWire(wire.RefundableInvoiceDto dto) =>
    RefundableInvoice(
      invoiceId: dto.invoiceId,
      invoiceNumber: dto.invoiceNumber,
      paymentId: dto.paymentId,
      paidCents: dto.paidCents,
      refundableCents: dto.refundableCents,
      refunds: dto.refunds.map(refundFromWire).nonNulls.toList(),
    );
