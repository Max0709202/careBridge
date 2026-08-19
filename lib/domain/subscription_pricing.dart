/// What a subscription costs. Mirrors
/// apps/api/src/domain/subscription-pricing.ts.
///
/// The family side is a flat price per interval. The dispatch side is priced by
/// **drivers on the road** — the only number an operator already tracks, and
/// the only one that moves with the value they get from us.
///
/// This copy exists so the app can show a plan card, a seat slider and a "what
/// would twenty drivers cost" preview without a round trip. The amounts it
/// produces must agree with the server's to the cent, which is why both round
/// half away from zero and both take their tiers from the same rows. A one-cent
/// disagreement shows a total that does not match its own line items.
library;

import '../core/money.dart';
import 'billing.dart';

class SubscriptionPlan {
  const SubscriptionPlan({
    required this.code,
    required this.version,
    required this.payer,
    required this.interval,
    required this.name,
    required this.description,
    required this.basePrice,
    required this.entitlements,
    this.includedSeats = 0,
    this.seatTiers = const [],
    this.trialDays = 0,
    this.graceDays = 7,
  });

  final String code;

  /// Immutable price identity, stamped onto every period this plan bills.
  final String version;

  final BillingPayer payer;
  final BillingInterval interval;
  final String name;
  final String description;

  /// The fixed part. For a family plan it is the whole price.
  final Money basePrice;

  /// Drivers covered by [basePrice]. Always 0 on a family plan.
  final int includedSeats;

  /// Empty on a family plan: a household does not have seats.
  final List<SeatTier> seatTiers;

  final Set<Entitlement> entitlements;
  final int trialDays;
  final int graceDays;

  bool get isSeatPriced => seatTiers.isNotEmpty;
}

class SubscriptionLine {
  const SubscriptionLine({
    required this.label,
    required this.quantity,
    required this.unitPrice,
    required this.amount,
  });

  final String label;
  final int quantity;
  final Money unitPrice;
  final Money amount;
}

class SubscriptionQuote {
  const SubscriptionQuote({
    required this.planCode,
    required this.planVersion,
    required this.interval,
    required this.seats,
    required this.billableSeats,
    required this.lines,
    required this.total,
  });

  final String planCode;
  final String planVersion;
  final BillingInterval interval;
  final int seats;
  final int billableSeats;
  final List<SubscriptionLine> lines;
  final Money total;
}

/// Drivers charged for: everything past what the base price already covers.
int billableSeats(SubscriptionPlan plan, int seats) =>
    seats - plan.includedSeats > 0 ? seats - plan.includedSeats : 0;

/// Graduated, not volume: each driver is priced in the band they fall in, and
/// crossing a boundary never re-prices the drivers below it.
///
/// Volume pricing — every seat at the rate the *total* reaches — would make an
/// operator's bill fall when they hire, which is a conversation that ends in a
/// spreadsheet nobody trusts again.
List<SubscriptionLine> seatCharges(SubscriptionPlan plan, int seats) {
  if (seats < 0) {
    throw ArgumentError.value(
      seats,
      'seats',
      'Driver count must not be negative.',
    );
  }

  final lines = <SubscriptionLine>[];
  var floor = plan.includedSeats;

  for (final tier in plan.seatTiers) {
    final ceiling = tier.upToSeats == null
        ? seats
        : (tier.upToSeats! < seats ? tier.upToSeats! : seats);
    final quantity = ceiling - floor;

    if (quantity > 0) {
      final unitPrice = Money(tier.unitPriceCents);
      lines.add(
        SubscriptionLine(
          label: _tierLabel(floor + 1, tier.upToSeats),
          quantity: quantity,
          unitPrice: unitPrice,
          amount: unitPrice * quantity,
        ),
      );
    }

    final upTo = tier.upToSeats;
    if (upTo == null) break;
    if (upTo > floor) floor = upTo;
    if (seats <= upTo) break;
  }

  return lines;
}

String _tierLabel(int from, int? upTo) =>
    upTo == null ? 'Drivers $from and above' : 'Drivers $from–$upTo';

/// The price of one period, itemised.
///
/// An operator who cannot see which band their twenty-first driver landed in
/// has no way to check the bill, and a bill nobody can check is a bill somebody
/// eventually disputes.
SubscriptionQuote quoteSubscription({
  required SubscriptionPlan plan,
  int seats = 0,
}) {
  if (plan.payer == BillingPayer.family && seats != 0) {
    throw ArgumentError.value(
      seats,
      'seats',
      'A family plan is not priced by seats.',
    );
  }

  final lines = <SubscriptionLine>[
    SubscriptionLine(
      label: plan.name,
      quantity: 1,
      unitPrice: plan.basePrice,
      amount: plan.basePrice,
    ),
    ...seatCharges(plan, seats),
  ];

  var total = const Money.zero();
  for (final line in lines) {
    total = total + line.amount;
  }

  return SubscriptionQuote(
    planCode: plan.code,
    planVersion: plan.version,
    interval: plan.interval,
    seats: seats,
    billableSeats: billableSeats(plan, seats),
    lines: lines,
    total: total,
  );
}

Money periodPrice(SubscriptionPlan plan, [int seats = 0]) =>
    quoteSubscription(plan: plan, seats: seats).total;

/// The unused fraction of a period, as an amount.
///
/// Rounded by [Money.operator *], which rounds half away from zero and matches
/// the server. A one-cent disagreement between the proration previewed here and
/// the one actually charged is a support ticket, not a rounding detail.
Money prorate({
  required Money amount,
  required DateTime periodStart,
  required DateTime periodEnd,
  required DateTime effectiveAt,
}) {
  final span = periodEnd.difference(periodStart).inMilliseconds;
  if (span <= 0) {
    throw ArgumentError('A billing period must end after it starts.');
  }

  final remaining = periodEnd.difference(effectiveAt).inMilliseconds;
  final fraction = (remaining / span).clamp(0.0, 1.0);
  return amount * fraction;
}
