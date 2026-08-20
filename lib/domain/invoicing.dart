/// Invoices, as the app renders them. Mirrors
/// apps/api/src/domain/invoicing.ts and apps/api/src/domain/dunning.ts.
///
/// As everywhere else in `lib/domain/`, this copy decides nothing. It cannot
/// mark an invoice paid, and it does not compute what is owed — the server
/// sends both, because "do I owe anything" is a question with one answer and a
/// client that summed open invoices itself would eventually sum a different
/// set than the dunning sweep does.
///
/// What it *does* own is how a failed payment is described to somebody. That
/// wording is a product decision with a real cost attached: the person reading
/// it is frequently an adult child managing a parent's logistics between other
/// obligations, and the message that gets a card updated is the calm one.
library;

/// What raised an invoice.
enum InvoiceReason {
  /// The recurring charge for one billed period.
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

  String get wire => name;

  String get label => switch (this) {
    InvoiceReason.subscriptionPeriod => 'Subscription',
    InvoiceReason.seatProration => 'Driver seats added',
    InvoiceReason.intervalSwitch => 'Billing period changed',
  };
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
    // `void` is a Dart keyword, so the enum member carries a trailing `$`.
    // The wire value is unchanged — the mapping is here and nowhere else.
    'void' => InvoiceStatus.void$,
    _ => null,
  };

  String get wire => this == InvoiceStatus.void$ ? 'void' : name;

  /// What a person is shown.
  ///
  /// `uncollectible` is deliberately not called "failed": by the time an
  /// invoice reaches it the retries are over, and "failed" invites another
  /// attempt at a card that will not work. It says what is true and what to do.
  String get label => switch (this) {
    InvoiceStatus.open => 'Due',
    InvoiceStatus.paid => 'Paid',
    InvoiceStatus.uncollectible => 'Unpaid',
    InvoiceStatus.void$ => 'Cancelled',
  };

  bool get isOutstanding => this == InvoiceStatus.open;

  /// Whether anything further will be attempted against it.
  bool get isSettled => this != InvoiceStatus.open;
}

/// One line of an invoice, exactly as it was quoted.
class InvoiceLine {
  const InvoiceLine({
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

/// An invoice as the app renders it.
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
    this.paidAt,
    this.attemptCount = 0,
    this.nextAttemptAt,
    this.lastFailureCode,
  });

  final String id;

  /// Human-quotable. An invoice somebody rings up about has to be findable by
  /// the number printed on it, so it is shown rather than hidden behind an id.
  final String number;

  final InvoiceReason reason;
  final InvoiceStatus status;
  final int subtotalCents;
  final int creditAppliedCents;
  final int totalCents;
  final int amountPaidCents;
  final List<InvoiceLine> lines;
  final DateTime issuedAt;
  final DateTime? paidAt;

  /// Charges attempted, including the first.
  final int attemptCount;

  /// When the next attempt is scheduled. Null once we have stopped trying.
  final DateTime? nextAttemptAt;

  final String? lastFailureCode;

  int get amountDueCents => status.isOutstanding
      ? (totalCents - amountPaidCents).clamp(0, totalCents)
      : 0;

  /// Whether the payer can usefully act on this one.
  ///
  /// Only an open invoice: retrying a paid one takes money twice, and retrying
  /// an `uncollectible` one presents a card the issuer has already refused
  /// four times.
  bool get canBePaidNow => status.isOutstanding;

  /// Whether a retry is still coming without anyone doing anything.
  bool get hasScheduledRetry => nextAttemptAt != null;
}

/// How a failed payment is explained.
///
/// The rule these follow: **say what has not stopped before saying what
/// failed**. A message about a declined card, on a product whose whole purpose
/// is knowing an elderly relative arrived safely, is read as "I have lost the
/// ability to see where my mother is". That is not what happened — the grace
/// window exists precisely so nothing stops immediately — and leading with the
/// reassurance is what makes the message actionable rather than alarming.
class DunningCopy {
  const DunningCopy._();

  /// The banner shown while an invoice is outstanding.
  static String headline(Invoice invoice) => switch (invoice.status) {
    InvoiceStatus.uncollectible => 'We could not take your payment',
    _ => 'Your payment did not go through',
  };

  static String detail(Invoice invoice, {DateTime? graceEndsAt}) {
    if (invoice.status == InvoiceStatus.uncollectible) {
      return 'We have stopped trying this card. Update it to keep your plan.';
    }
    if (graceEndsAt != null) {
      return 'Nothing has been switched off. Your plan keeps working until '
          '${_day(graceEndsAt)} while you sort this out.';
    }
    return 'Nothing has been switched off. Update your card when you can.';
  }

  static String _day(DateTime value) =>
      '${value.year}-${_two(value.month)}-${_two(value.day)}';

  static String _two(int value) => value.toString().padLeft(2, '0');
}

/// The card renewals are charged against.
///
/// Four digits and a brand, which is everything this system knows about a
/// card and everything a person needs to recognise which one is being charged.
/// "Your payment failed" against an account holding two cards and naming
/// neither is a support call rather than a fix.
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

  /// "Visa ···· 4242".
  String get label => '$_brandLabel ···· $last4';

  String get _brandLabel => switch (brand.toLowerCase()) {
    'visa' => 'Visa',
    'mastercard' => 'Mastercard',
    'amex' => 'Amex',
    'discover' => 'Discover',
    _ => 'Card',
  };

  /// Whether the card has already lapsed at [now].
  ///
  /// Compared against the **end** of the expiry month, because a card marked
  /// 12/2026 works until the last day of December. Treating the 1st as expired
  /// would warn a month early, every time.
  bool hasExpired(DateTime now) {
    final endOfMonth = DateTime.utc(expYear, expMonth + 1, 1);
    return !now.toUtc().isBefore(endOfMonth);
  }

  /// Whether it lapses within [days]. Shown before it fails, not after.
  bool expiresSoon(DateTime now, {int days = 45}) {
    if (hasExpired(now)) return false;
    final endOfMonth = DateTime.utc(expYear, expMonth + 1, 1);
    return endOfMonth.difference(now.toUtc()).inDays <= days;
  }
}
