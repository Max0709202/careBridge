/// The administration surface, as the console renders it. Mirrors
/// apps/api/src/modules/admin/admin.dto.ts.
///
/// One rule shapes all of it, and it is the server's rule rather than this
/// file's: **these records describe actions, never content**. An audit row
/// says that a named person viewed a named driver's licence at a given time;
/// it does not say what was in it, and `changedFields` carries field *names*
/// with no values beside them. That restraint is what lets support staff read
/// the log without being entitled to the records it describes, and nothing on
/// this side may quietly undo it by rendering a value the wire did not send.
///
/// Like `dispatch.dart`, this copy decides nothing. `PlatformRoleGuard` is
/// what refuses a caller without standing, and it refuses with the same 404
/// every other lookup uses so that probing `/admin` cannot map the surface
/// out. The models here only decide what a screen can say.
library;

/// The operational dashboard.
///
/// Every field is a number somebody acts on. The grouping below is the whole
/// point of the type: "rides last 7 days" is something to know, and
/// "stale tracking now" is a list of telephone calls to make in the next ten
/// minutes. Rendering them as one undifferentiated grid of tiles is how a
/// dashboard becomes wallpaper.
class PlatformStats {
  const PlatformStats({
    required this.ridesLast7Days,
    required this.ridesCompletedLast7Days,
    required this.ridesNoShowLast7Days,
    required this.ridesCancelledLast7Days,
    required this.activeRidesNow,
    required this.staleTrackingNow,
    required this.familiesSubscribed,
    required this.operatorsSubscribed,
    required this.driversApproved,
    required this.driversWithExpiringDocuments,
    required this.documentsAwaitingReview,
    required this.invoicesPastDue,
    required this.revenueCentsLast30Days,
    required this.refundedCentsLast30Days,
  });

  final int ridesLast7Days;
  final int ridesCompletedLast7Days;

  /// Rides that ended without the passenger travelling.
  ///
  /// Counted beside completions rather than buried, because it is the number
  /// that says whether the product is working for the people it is for.
  final int ridesNoShowLast7Days;

  final int ridesCancelledLast7Days;
  final int activeRidesNow;

  /// Rides in flight whose last position is older than the staleness bound.
  final int staleTrackingNow;

  final int familiesSubscribed;
  final int operatorsSubscribed;
  final int driversApproved;

  /// Approved drivers whose paperwork lapses within thirty days.
  final int driversWithExpiringDocuments;

  final int documentsAwaitingReview;

  /// Invoices that have failed at least once and are still unpaid — the
  /// dunning queue, as one number.
  final int invoicesPastDue;

  final int revenueCentsLast30Days;
  final int refundedCentsLast30Days;

  /// Whether anything on this dashboard is asking for a person right now.
  ///
  /// Drives whether the overview leads with the attention block or with the
  /// week's counts. A screen that always leads with red trains people to stop
  /// reading it.
  bool get needsAttention =>
      staleTrackingNow > 0 ||
      documentsAwaitingReview > 0 ||
      driversWithExpiringDocuments > 0 ||
      invoicesPastDue > 0;

  /// Completions as a share of the rides that reached an end state.
  ///
  /// Null rather than zero when nothing finished in the window: 0% and "no
  /// rides yet" are different facts, and showing the first for the second is
  /// how a quiet week reads as a broken product.
  double? get completionRate {
    final ended =
        ridesCompletedLast7Days +
        ridesNoShowLast7Days +
        ridesCancelledLast7Days;
    return ended == 0 ? null : ridesCompletedLast7Days / ended;
  }

  /// Money kept, after refunds, over the last thirty days.
  int get netRevenueCentsLast30Days =>
      revenueCentsLast30Days - refundedCentsLast30Days;
}

/// One row of the append-only audit log.
class AuditEntry {
  const AuditEntry({
    required this.id,
    required this.at,
    required this.action,
    required this.entityType,
    required this.changedFields,
    this.actorUserId,
    this.actorName,
    this.entityId,
    this.correlationId,
    this.ip,
  });

  final String id;
  final DateTime at;

  /// Dotted, and matched as a prefix by the filter: `driver.` returns
  /// everything about drivers.
  final String action;

  final String entityType;

  /// Field **names** only, never values. See the library note.
  final List<String> changedFields;

  final String? actorUserId;

  /// Resolved for display. Absent for actions the system took on its own —
  /// a renewal sweep, a dunning attempt — and that absence is meaningful
  /// rather than missing data, so it is rendered as "CareBridge" rather than
  /// left blank.
  final String? actorName;

  final String? entityId;
  final String? correlationId;
  final String? ip;

  /// Whether a person did this, as opposed to a scheduled job.
  bool get isSystem => actorUserId == null;

  /// The actor, in a form a screen can print unconditionally.
  String get actorLabel => actorName ?? (isSystem ? 'CareBridge' : 'Unknown');
}

/// One page of the log, and the key to the next.
///
/// Keyset rather than an offset. The audit table is appended to on every
/// authenticated action, so an offset page would skip rows that shifted under
/// it — and a log that quietly omits rows is worse than no log at all.
class AuditPage {
  const AuditPage({required this.entries, required this.nextCursor});

  final List<AuditEntry> entries;
  final String? nextCursor;
}

/// The filter a reader has applied to the log.
///
/// A value object rather than four loose parameters, because it is also the
/// provider key: two screens asking for the same filter must share one request
/// and one page of results, and that only happens if the key has value
/// equality.
class AuditFilter {
  const AuditFilter({this.action, this.entityType, this.entityId});

  /// Matched as a prefix by the server.
  final String? action;

  final String? entityType;
  final String? entityId;

  bool get isEmpty =>
      (action ?? '').isEmpty &&
      (entityType ?? '').isEmpty &&
      (entityId ?? '').isEmpty;

  @override
  bool operator ==(Object other) =>
      other is AuditFilter &&
      other.action == action &&
      other.entityType == entityType &&
      other.entityId == entityId;

  @override
  int get hashCode => Object.hash(action, entityType, entityId);
}

/// A switch, and how far it is rolled out.
class FeatureFlag {
  const FeatureFlag({
    required this.key,
    required this.description,
    required this.enabled,
    required this.rolloutPercent,
    required this.updatedAt,
    this.updatedByName,
  });

  final String key;
  final String description;

  /// The master switch, checked before the percentage. Turning a flag off is
  /// instant and complete rather than "off for the ninety per cent who were
  /// not in the rollout" — when something has to go off in a hurry, it has to
  /// go off for everybody.
  final bool enabled;

  /// 0–100, applied to a stable hash of the subject so a given user is on the
  /// same side of the line on every request.
  final int rolloutPercent;

  final DateTime updatedAt;
  final String? updatedByName;

  /// What the flag actually does right now, in a sentence.
  String get summary {
    if (!enabled) return 'Off for everybody';
    if (rolloutPercent >= 100) return 'On for everybody';
    if (rolloutPercent <= 0) return 'On, but rolled out to nobody';
    return 'On for $rolloutPercent% of subjects';
  }

  /// Whether moving to [to] takes the feature away from people who have it.
  ///
  /// Mirrors `rolloutTakesFeatureAway` in apps/api/src/domain/feature-flags.ts.
  /// The server refuses a narrowing that did not say so; this is what lets the
  /// console ask *before* sending, rather than surfacing the refusal as an
  /// error the reader then has to interpret.
  bool narrowsTo(int to) => to < rolloutPercent;

  /// Switching the master off is the widest possible narrowing, and it is the
  /// one people reach for in a hurry. Confirmed for the same reason and with
  /// the same words.
  bool takesAwayBy({required bool nextEnabled, required int nextPercent}) =>
      enabled && (!nextEnabled || narrowsTo(nextPercent));
}

enum RefundStatus {
  pending,
  succeeded,
  failed;

  static RefundStatus? tryParse(String? value) {
    for (final status in RefundStatus.values) {
      if (status.name == value) return status;
    }
    return null;
  }

  String get label => switch (this) {
    RefundStatus.pending => 'In flight',
    RefundStatus.succeeded => 'Sent',
    RefundStatus.failed => 'Failed',
  };
}

/// One credit against one payment.
class Refund {
  const Refund({
    required this.id,
    required this.invoiceId,
    required this.invoiceNumber,
    required this.amountCents,
    required this.currency,
    required this.reason,
    required this.status,
    required this.requestedByName,
    required this.createdAt,
    this.failureMessage,
    this.settledAt,
  });

  final String id;
  final String invoiceId;
  final String invoiceNumber;
  final int amountCents;
  final String currency;

  /// Required by the server. An unexplained credit is something somebody has
  /// to justify to an accountant a quarter later, by which time whoever issued
  /// it has forgotten.
  final String reason;

  final RefundStatus status;
  final String requestedByName;
  final DateTime createdAt;
  final String? failureMessage;
  final DateTime? settledAt;

  /// A row written before the processor was called and not yet resolved.
  /// It is not a failure and must not be shown as one — it is money that may
  /// still be moving.
  bool get isInFlight => status == RefundStatus.pending;
}

/// What is left to refund on one invoice, and everything already credited.
class RefundableInvoice {
  const RefundableInvoice({
    required this.invoiceId,
    required this.invoiceNumber,
    required this.paymentId,
    required this.paidCents,
    required this.refundableCents,
    required this.refunds,
  });

  final String invoiceId;
  final String invoiceNumber;

  /// The payment a new refund is issued against. Passed back to the server
  /// rather than inferred there, so a refund cannot be applied to a payment
  /// the reader was not looking at.
  final String paymentId;

  final int paidCents;

  /// The payment less everything already refunded against it — the ceiling on
  /// a new refund, and the server enforces it again.
  final int refundableCents;

  final List<Refund> refunds;

  bool get isFullyRefunded => refundableCents <= 0;

  int get refundedCents => paidCents - refundableCents;

  /// Whether a credit is still moving. Shown, because issuing a second refund
  /// while the first is in flight is how an account gets credited twice.
  bool get hasInFlightRefund => refunds.any((refund) => refund.isInFlight);
}
