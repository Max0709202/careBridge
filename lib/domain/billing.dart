/// Who pays, on what cadence, and what that buys. Mirrors
/// apps/api/src/domain/billing.ts.
///
/// CareBridge has **two** paying parties:
///
///   * a **family** pays for the coordination product around one household's
///     patients, and separately pays the fare for each ride;
///   * a **dispatch organisation** pays for the operational product — the
///     console, the driver app, assignment — priced by how many drivers it has
///     on the road.
///
/// As everywhere else in `lib/domain/`, this copy decides nothing. It exists so
/// a screen can say "your plan renews on the 14th" and grey out a control
/// before the request is made. The server's copy is the one that authorises,
/// and deleting this file would change no outcome except which buttons look
/// tappable.
library;

/// The two sides of the marketplace that can hold a subscription.
enum BillingPayer {
  family,
  dispatchOrganization;

  static BillingPayer? tryParse(String? value) => switch (value) {
    'family' => BillingPayer.family,
    'dispatchOrganization' => BillingPayer.dispatchOrganization,
    _ => null,
  };

  String get wire => name;
}

/// Monthly or annual, and nothing in between.
///
/// Annual is a separate plan row with its own price, not `monthly × 12`
/// computed here — so the app never shows a discount the server does not
/// actually apply.
enum BillingInterval {
  monthly,
  annual;

  static BillingInterval? tryParse(String? value) => switch (value) {
    'monthly' => BillingInterval.monthly,
    'annual' => BillingInterval.annual,
    _ => null,
  };

  String get wire => name;

  String get label => switch (this) {
    BillingInterval.monthly => 'Monthly',
    BillingInterval.annual => 'Yearly',
  };

  /// What follows the price on a plan card: "$29 a month".
  String get cadence => switch (this) {
    BillingInterval.monthly => 'a month',
    BillingInterval.annual => 'a year',
  };
}

enum SubscriptionStatus {
  trialing,
  active,

  /// A payment failed. Still entitling, for the plan's grace window.
  pastDue,

  /// Cancelled, and still entitling until the paid period ends.
  pendingCancellation,
  canceled,

  /// Ran out: a trial nobody converted, or a grace window nobody rescued.
  expired;

  static SubscriptionStatus? tryParse(String? value) {
    for (final status in SubscriptionStatus.values) {
      if (status.name == value) return status;
    }
    return null;
  }

  String get wire => name;
}

/// What a plan switches on.
///
/// A closed set rather than raw strings, so a screen that offers a feature the
/// catalogue never grants is a compile error rather than a dead button.
/// Unknown values from the wire are dropped rather than guessed at — a client
/// that invents an entitlement would show a control the server then refuses.
enum Entitlement {
  requestTransport,
  liveTracking,
  unlimitedCareCircle,
  appointmentReminders,
  prioritySupport,
  dispatchConsole,
  driverApp,
  bulkAssignment,
  operationsAnalytics,
  partnerApi;

  static Entitlement? tryParse(String? value) {
    for (final entitlement in Entitlement.values) {
      if (entitlement.name == value) return entitlement;
    }
    return null;
  }

  String get wire => name;

  String get label => switch (this) {
    Entitlement.requestTransport => 'Book transportation',
    Entitlement.liveTracking => 'Follow trips live',
    Entitlement.unlimitedCareCircle => 'Unlimited care circle',
    Entitlement.appointmentReminders => 'Appointment reminders',
    Entitlement.prioritySupport => 'Priority support',
    Entitlement.dispatchConsole => 'Dispatch console',
    Entitlement.driverApp => 'Driver app',
    Entitlement.bulkAssignment => 'Bulk assignment',
    Entitlement.operationsAnalytics => 'Operations analytics',
    Entitlement.partnerApi => 'Partner API',
  };
}

/// One band of the graduated per-driver ladder.
///
/// [upToSeats] is a total driver count, inclusive; the final band is unbounded.
class SeatTier {
  const SeatTier({required this.upToSeats, required this.unitPriceCents});

  final int? upToSeats;
  final int unitPriceCents;
}

/// A subscription as the app renders it.
///
/// Everything the server decided is carried here rather than recomputed:
/// [entitlements] in particular is resolved server-side from status, period and
/// grace, and the client reads it. Re-deriving it would be a second
/// implementation of an authorisation rule, which is exactly what the two
/// copies of `domain/` exist to avoid.
class Subscription {
  const Subscription({
    required this.id,
    required this.payer,
    required this.status,
    required this.interval,
    required this.planCode,
    required this.planName,
    required this.planVersion,
    required this.seats,
    required this.currentPeriodStart,
    required this.currentPeriodEnd,
    required this.entitlements,
    required this.renewalTotalCents,
    this.trialEndsAt,
    this.pastDueSince,
    this.cancelRequestedAt,
    this.carriedCreditCents = 0,
  });

  final String id;
  final BillingPayer payer;
  final SubscriptionStatus status;
  final BillingInterval interval;
  final String planCode;
  final String planName;
  final String planVersion;

  /// Drivers billed from the next renewal. Zero on a household subscription.
  final int seats;

  final DateTime currentPeriodStart;
  final DateTime currentPeriodEnd;
  final DateTime? trialEndsAt;
  final DateTime? pastDueSince;
  final DateTime? cancelRequestedAt;
  final Set<Entitlement> entitlements;
  final int renewalTotalCents;
  final int carriedCreditCents;

  bool allows(Entitlement entitlement) => entitlements.contains(entitlement);

  bool get isTrialing => status == SubscriptionStatus.trialing;

  /// Whether the payer should be told something needs their attention.
  ///
  /// Deliberately not the same as "switched off": a failed payment still
  /// entitles for the grace window, and the whole point of that window is that
  /// the family finds out by being *told*, not by a blank map mid-trip.
  bool get needsAttention =>
      status == SubscriptionStatus.pastDue ||
      status == SubscriptionStatus.pendingCancellation;

  /// One line, for a settings row.
  String get summary => switch (status) {
    SubscriptionStatus.trialing => 'Free trial of $planName',
    SubscriptionStatus.active => planName,
    SubscriptionStatus.pastDue => '$planName — payment failed',
    SubscriptionStatus.pendingCancellation => '$planName — ends soon',
    SubscriptionStatus.canceled => 'No plan',
    SubscriptionStatus.expired => 'No plan',
  };
}
