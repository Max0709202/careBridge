// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// PlatformStatsDto, from the CareBridge API.
class PlatformStatsDto {
  const PlatformStatsDto({
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

  /// Rides that ended without the passenger travelling. Counted beside
  /// completions rather than buried, because it is the number that says whether
  /// the product is working for the people it is for.
  final int ridesNoShowLast7Days;

  final int ridesCancelledLast7Days;

  final int activeRidesNow;

  /// Rides in flight whose last position is older than the staleness bound —
  /// the number a dispatcher would want telephoned about.
  final int staleTrackingNow;

  final int familiesSubscribed;

  final int operatorsSubscribed;

  final int driversApproved;

  /// Approved drivers whose paperwork lapses within thirty days. Each one is a
  /// driver who comes off the road unless somebody telephones.
  final int driversWithExpiringDocuments;

  final int documentsAwaitingReview;

  /// Invoices that have failed at least once and have not been paid. The
  /// dunning queue, as a single number.
  final int invoicesPastDue;

  final int revenueCentsLast30Days;

  final int refundedCentsLast30Days;

  factory PlatformStatsDto.fromJson(Map<String, dynamic> json) =>
      PlatformStatsDto(
        ridesLast7Days: json['ridesLast7Days'] as int,
        ridesCompletedLast7Days: json['ridesCompletedLast7Days'] as int,
        ridesNoShowLast7Days: json['ridesNoShowLast7Days'] as int,
        ridesCancelledLast7Days: json['ridesCancelledLast7Days'] as int,
        activeRidesNow: json['activeRidesNow'] as int,
        staleTrackingNow: json['staleTrackingNow'] as int,
        familiesSubscribed: json['familiesSubscribed'] as int,
        operatorsSubscribed: json['operatorsSubscribed'] as int,
        driversApproved: json['driversApproved'] as int,
        driversWithExpiringDocuments:
            json['driversWithExpiringDocuments'] as int,
        documentsAwaitingReview: json['documentsAwaitingReview'] as int,
        invoicesPastDue: json['invoicesPastDue'] as int,
        revenueCentsLast30Days: json['revenueCentsLast30Days'] as int,
        refundedCentsLast30Days: json['refundedCentsLast30Days'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'ridesLast7Days': ridesLast7Days,
    'ridesCompletedLast7Days': ridesCompletedLast7Days,
    'ridesNoShowLast7Days': ridesNoShowLast7Days,
    'ridesCancelledLast7Days': ridesCancelledLast7Days,
    'activeRidesNow': activeRidesNow,
    'staleTrackingNow': staleTrackingNow,
    'familiesSubscribed': familiesSubscribed,
    'operatorsSubscribed': operatorsSubscribed,
    'driversApproved': driversApproved,
    'driversWithExpiringDocuments': driversWithExpiringDocuments,
    'documentsAwaitingReview': documentsAwaitingReview,
    'invoicesPastDue': invoicesPastDue,
    'revenueCentsLast30Days': revenueCentsLast30Days,
    'refundedCentsLast30Days': refundedCentsLast30Days,
  };
}
