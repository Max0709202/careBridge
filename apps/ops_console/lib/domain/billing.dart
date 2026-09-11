/// What an operator pays, as the console renders it. Mirrors
/// apps/api/src/domain/billing.ts and the `BillingAccount` half of
/// apps/api/src/modules/billing.
///
/// This is the **second** payer. A family pays for the coordination product
/// around one household; a transport operator pays for the operational one —
/// this console, the driver app, assignment — priced by how many drivers it
/// has on the road. ADR-0011. The seat ledger on the Seats screen is the
/// record of how that count moved; this file is the subscription the ledger
/// is billed against, which until now had no surface at all.
///
/// Like every other file in `lib/domain/`, it decides nothing. The server
/// resolves entitlements from status, period and grace window and sends the
/// answer; re-deriving it here would be a second implementation of an
/// authorisation rule.
library;

/// Monthly or annual, and nothing in between.
///
/// Annual is a separate plan row with its own price rather than
/// `monthly × 12` computed here, so the console never shows a discount the
/// server does not actually apply.
enum BillingInterval {
  monthly,
  annual;

  static BillingInterval? tryParse(String? value) {
    for (final interval in BillingInterval.values) {
      if (interval.name == value) return interval;
    }
    return null;
  }

  String get wire => name;

  String get label => switch (this) {
    BillingInterval.monthly => 'Monthly',
    BillingInterval.annual => 'Yearly',
  };

  /// What follows the price on a plan card: "$249 a month".
  String get cadence => switch (this) {
    BillingInterval.monthly => 'a month',
    BillingInterval.annual => 'a year',
  };
}

enum SubscriptionStatus {
  trialing,
  active,

  /// A payment failed. Still entitling, for the plan's grace window — the
  /// whole point of that window is that an operator finds out by being told
  /// rather than by a console that stops working mid-shift.
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

  String get label => switch (this) {
    SubscriptionStatus.trialing => 'Free trial',
    SubscriptionStatus.active => 'Active',
    SubscriptionStatus.pastDue => 'Payment failed',
    SubscriptionStatus.pendingCancellation => 'Ends at the period',
    SubscriptionStatus.canceled => 'Cancelled',
    SubscriptionStatus.expired => 'Expired',
  };

  /// Whether somebody has to do something about it today.
  bool get needsAttention =>
      this == SubscriptionStatus.pastDue ||
      this == SubscriptionStatus.expired ||
      this == SubscriptionStatus.canceled;
}

/// One band of the graduated per-driver ladder.
///
/// [upToSeats] is a total driver count, inclusive; the final band is
/// unbounded. Graduated rather than flat: the eleventh driver is priced at the
/// eleventh driver's rate, and the first ten stay at theirs.
class SeatTier {
  const SeatTier({required this.upToSeats, required this.unitPriceCents});

  final int? upToSeats;
  final int unitPriceCents;
}

/// A plan in the catalogue, for one payer and one interval.
class OperatorPlan {
  const OperatorPlan({
    required this.code,
    required this.version,
    required this.interval,
    required this.name,
    required this.description,
    required this.basePriceCents,
    required this.includedSeats,
    required this.seatTiers,
    required this.entitlements,
    required this.trialDays,
    required this.graceDays,
  });

  final String code;
  final String version;
  final BillingInterval interval;
  final String name;
  final String description;
  final int basePriceCents;

  /// Drivers the base price already covers. The ladder starts above it.
  final int includedSeats;

  final List<SeatTier> seatTiers;

  /// Raw entitlement keys. Rendered as a list rather than switched on: the
  /// console gates nothing on them — the server does — so an unrecognised one
  /// is a line of text rather than a missing feature.
  final List<String> entitlements;

  final int trialDays;

  /// How long a failed payment keeps entitling. Shown on the plan card,
  /// because it is the answer to "what happens if the card bounces" and that
  /// question is asked at the moment of subscribing, not later.
  final int graceDays;
}

/// One line of a quote or an invoice.
class BillingLine {
  const BillingLine({
    required this.label,
    required this.quantity,
    required this.unitPriceCents,
    required this.amountCents,
  });

  final String label;
  final int quantity;
  final int unitPriceCents;
  final int amountCents;
}

/// What the next renewal will cost, itemised.
///
/// Itemised rather than a single figure, and that is the point of the type: an
/// operator asking "why is it $412?" is answered by the lines rather than by a
/// support conversation.
class BillingQuote {
  const BillingQuote({
    required this.planCode,
    required this.interval,
    required this.seats,
    required this.billableSeats,
    required this.lines,
    required this.totalCents,
  });

  final String planCode;
  final BillingInterval interval;
  final int seats;

  /// Seats above the plan's included allowance — the ones the ladder prices.
  final int billableSeats;

  final List<BillingLine> lines;
  final int totalCents;
}

enum InvoiceStatus {
  /// Issued and owed.
  open,
  paid,

  /// Dunning ran out, or the card will never work. Owed, no longer pursued.
  uncollectible,

  /// Withdrawn: never owed.
  void$;

  static InvoiceStatus? tryParse(String? value) => switch (value) {
    'open' => InvoiceStatus.open,
    'paid' => InvoiceStatus.paid,
    'uncollectible' => InvoiceStatus.uncollectible,
    // `void` is a Dart keyword, so the member carries a trailing `$`. The wire
    // value is unchanged — the mapping is here and nowhere else.
    'void' => InvoiceStatus.void$,
    _ => null,
  };

  /// `uncollectible` is deliberately not called "failed": by the time an
  /// invoice reaches it the retries are over, and "failed" invites another
  /// attempt at a card that will not work.
  String get label => switch (this) {
    InvoiceStatus.open => 'Due',
    InvoiceStatus.paid => 'Paid',
    InvoiceStatus.uncollectible => 'Unpaid',
    InvoiceStatus.void$ => 'Cancelled',
  };

  bool get isOutstanding => this == InvoiceStatus.open;
}

enum InvoiceReason {
  /// The recurring charge for one period.
  subscriptionPeriod,

  /// Drivers added mid-period, charged for the remainder of it.
  seatProration,

  /// Monthly ⇄ annual, where the new period's price outran the credit.
  intervalSwitch;

  static InvoiceReason? tryParse(String? value) {
    for (final reason in InvoiceReason.values) {
      if (reason.name == value) return reason;
    }
    return null;
  }

  String get label => switch (this) {
    InvoiceReason.subscriptionPeriod => 'Subscription',
    InvoiceReason.seatProration => 'Drivers added mid-period',
    InvoiceReason.intervalSwitch => 'Change of billing period',
  };
}

class Invoice {
  const Invoice({
    required this.id,
    required this.number,
    required this.reason,
    required this.status,
    required this.subtotalCents,
    required this.creditAppliedCents,
    required this.totalCents,
    required this.amountPaidCents,
    required this.lines,
    required this.issuedAt,
    required this.attemptCount,
    this.paidAt,
    this.nextAttemptAt,
    this.lastFailureCode,
  });

  final String id;
  final String number;
  final InvoiceReason reason;
  final InvoiceStatus status;
  final int subtotalCents;

  /// Credit carried from a shortened period, applied before the card is
  /// charged. Shown as its own line rather than netted silently — an operator
  /// switching monthly to annual mid-period should see where the money went.
  final int creditAppliedCents;

  final int totalCents;
  final int amountPaidCents;
  final List<BillingLine> lines;
  final DateTime issuedAt;

  /// How many times the card has been tried. Zero on an invoice nothing has
  /// attempted yet, which is different from one that failed once.
  final int attemptCount;

  final DateTime? paidAt;
  final DateTime? nextAttemptAt;
  final String? lastFailureCode;

  /// Whether dunning has started on this one.
  bool get hasFailed => attemptCount > 0 && status.isOutstanding;

  /// Whether the console should offer a "pay now" button.
  ///
  /// Offered on anything still owed, including `uncollectible`: the retries
  /// stopped, but a person with a new card should not have to telephone
  /// anybody to use it.
  bool get isPayable =>
      status == InvoiceStatus.open || status == InvoiceStatus.uncollectible;
}

/// The card on file. Four digits and a brand — no card number exists anywhere
/// in this system to decode.
class PaymentMethod {
  const PaymentMethod({
    required this.id,
    required this.brand,
    required this.last4,
    required this.expMonth,
    required this.expYear,
    required this.isDefault,
  });

  final String id;
  final String brand;
  final String last4;
  final int expMonth;
  final int expYear;
  final bool isDefault;

  String get label => '$brand •••• $last4';

  /// Whether the card has already lapsed.
  ///
  /// Compared against a caller-supplied `now` rather than `DateTime.now()`, so
  /// the rule is testable without waiting for a month to pass.
  bool hasExpired(DateTime now) {
    final endOfMonth = DateTime(expYear, expMonth + 1);
    return !now.isBefore(endOfMonth);
  }
}

/// The operator's subscription.
class OperatorSubscription {
  const OperatorSubscription({
    required this.id,
    required this.status,
    required this.interval,
    required this.planCode,
    required this.planName,
    required this.seats,
    required this.currentPeriodStart,
    required this.currentPeriodEnd,
    required this.entitlements,
    required this.renewalQuote,
    required this.carriedCreditCents,
    this.trialEndsAt,
    this.pastDueSince,
    this.cancelRequestedAt,
  });

  final String id;
  final SubscriptionStatus status;
  final BillingInterval interval;
  final String planCode;
  final String planName;

  /// Drivers billed from the next renewal.
  final int seats;

  final DateTime currentPeriodStart;
  final DateTime currentPeriodEnd;
  final List<String> entitlements;
  final BillingQuote renewalQuote;

  /// Unspent money from a period that was cut short, applied to the next
  /// invoice before the card is.
  final int carriedCreditCents;

  final DateTime? trialEndsAt;
  final DateTime? pastDueSince;

  /// When cancellation was asked for. The subscription keeps entitling until
  /// [currentPeriodEnd] — the period is paid for.
  final DateTime? cancelRequestedAt;

  bool get isTrialing => status == SubscriptionStatus.trialing;

  bool get isCancelling => cancelRequestedAt != null;
}

/// Everything the billing screen renders for one operator.
class BillingAccount {
  const BillingAccount({
    required this.id,
    required this.billingEmail,
    required this.amountDueCents,
    this.organizationId,
    this.subscription,
    this.paymentMethod,
  });

  final String id;
  final String billingEmail;

  /// The sum of everything still owed. The number the screen leads with when
  /// it is not zero.
  final int amountDueCents;

  final String? organizationId;
  final OperatorSubscription? subscription;
  final PaymentMethod? paymentMethod;

  bool get hasSubscription => subscription != null;

  /// A subscription that will bill a card that is not there.
  ///
  /// Surfaced as its own state rather than left to be discovered when the
  /// first invoice fails: a trial with no card on it is the single most common
  /// way an account lapses without anybody deciding to let it.
  bool get willBillWithoutACard =>
      subscription != null && paymentMethod == null;
}
