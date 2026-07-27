import '../core/money.dart';

/// Fare calculation.
///
/// Prices are **data, not constants**: a [PricingRule] is a versioned record so
/// a historical charge can always be explained ("this ride was priced under
/// rule v1, which had a $12 base"). Nothing in the UI or the domain hard-codes
/// an amount.
class PricingRule {
  const PricingRule({
    required this.version,
    required this.baseFare,
    required this.perMile,
    required this.perMinute,
    required this.minimumFare,
    required this.wheelchairSurcharge,
    required this.assistanceSurcharge,
    required this.effectiveFrom,
  });

  final String version;
  final Money baseFare;
  final Money perMile;
  final Money perMinute;
  final Money minimumFare;

  /// Wheelchair-accessible vehicles cost more to operate and are scarcer. The
  /// surcharge reflects vehicle cost — it is not a charge for being disabled,
  /// and is shown as a named line item rather than folded silently into the
  /// total.
  final Money wheelchairSurcharge;

  /// Door-through-door assistance: the driver parks, walks the passenger in,
  /// and hands them over. Costs the driver time that per-mile pricing misses.
  final Money assistanceSurcharge;

  final DateTime effectiveFrom;

  static PricingRule standard() => PricingRule(
        version: 'v1-pilot',
        baseFare: const Money(1200),
        perMile: const Money(225),
        perMinute: const Money(45),
        minimumFare: const Money(1800),
        wheelchairSurcharge: const Money(1500),
        assistanceSurcharge: const Money(800),
        effectiveFrom: DateTime.utc(2026, 1, 1),
      );
}

/// A priced quote, itemised so a family can see what they are paying for.
class PriceEstimate {
  const PriceEstimate({
    required this.ruleVersion,
    required this.distanceMiles,
    required this.durationMinutes,
    required this.base,
    required this.distanceCharge,
    required this.timeCharge,
    required this.surcharges,
    required this.total,
    required this.minimumApplied,
  });

  final String ruleVersion;
  final double distanceMiles;
  final int durationMinutes;
  final Money base;
  final Money distanceCharge;
  final Money timeCharge;
  final List<({String label, Money amount})> surcharges;
  final Money total;

  /// True when the minimum fare lifted the total. Shown to the family, because
  /// an unexplained floor on a short trip reads as a billing error.
  final bool minimumApplied;
}

PriceEstimate estimateFare({
  required PricingRule rule,
  required double distanceMiles,
  required int durationMinutes,
  bool wheelchairAccessRequired = false,
  bool assistanceRequired = false,
}) {
  if (distanceMiles < 0 || durationMinutes < 0) {
    throw ArgumentError('Distance and duration must not be negative.');
  }

  final distanceCharge = rule.perMile * distanceMiles;
  final timeCharge = rule.perMinute * durationMinutes;

  final surcharges = <({String label, Money amount})>[
    if (wheelchairAccessRequired)
      (label: 'Wheelchair-accessible vehicle', amount: rule.wheelchairSurcharge),
    if (assistanceRequired)
      (label: 'Door-through-door assistance', amount: rule.assistanceSurcharge),
  ];

  var subtotal = rule.baseFare + distanceCharge + timeCharge;
  for (final s in surcharges) {
    subtotal = subtotal + s.amount;
  }

  final total = Money.max(subtotal, rule.minimumFare);

  return PriceEstimate(
    ruleVersion: rule.version,
    distanceMiles: distanceMiles,
    durationMinutes: durationMinutes,
    base: rule.baseFare,
    distanceCharge: distanceCharge,
    timeCharge: timeCharge,
    surcharges: surcharges,
    total: total,
    minimumApplied: total > subtotal,
  );
}
