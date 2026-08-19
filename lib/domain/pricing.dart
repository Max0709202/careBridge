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
    this.platformFeeBps = 0,
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

  /// Our cut of a fare, in basis points, and **only** when the transport
  /// operator is not on a per-driver subscription. See [settleFare].
  final int platformFeeBps;

  final DateTime effectiveFrom;

  static PricingRule standard() => PricingRule(
    version: 'v1-pilot',
    baseFare: const Money(1200),
    perMile: const Money(225),
    perMinute: const Money(45),
    minimumFare: const Money(1800),
    wheelchairSurcharge: const Money(1500),
    assistanceSurcharge: const Money(800),
    platformFeeBps: 1500,
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
      (
        label: 'Wheelchair-accessible vehicle',
        amount: rule.wheelchairSurcharge,
      ),
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

/// Which of the two revenue lines paid for a ride's platform margin.
enum PlatformFunding {
  /// The operator holds a per-driver subscription. The whole fare is theirs.
  operatorSubscription,

  /// No subscription: the rule's basis points applied.
  perRide;

  static PlatformFunding? tryParse(String? value) {
    for (final funding in PlatformFunding.values) {
      if (funding.name == value) return funding;
    }
    return null;
  }
}

/// Where the money a family pays for one ride actually goes.
class FareSettlement {
  const FareSettlement({
    required this.total,
    required this.platformFee,
    required this.operatorPayout,
    required this.funding,
  });

  /// What the family is charged. Identical under both funding modes.
  final Money total;
  final Money platformFee;
  final Money operatorPayout;
  final PlatformFunding funding;
}

/// The "who pays the fees" question at its narrowest.
///
/// An operator on a per-driver subscription has already paid for the month, so
/// taking a percentage of their fares as well would be charging twice for the
/// same relationship. The family pays the same total either way — what changes
/// is who keeps it.
///
/// Mirrored from the server so a receipt screen can show the split without a
/// round trip. As with everything in `lib/domain/`, the server's copy is the
/// one that decides.
FareSettlement settleFare({
  required PricingRule rule,
  required Money total,
  required bool operatorSubscribed,
}) {
  if (rule.platformFeeBps < 0 || rule.platformFeeBps > 10000) {
    throw ArgumentError.value(
      rule.platformFeeBps,
      'platformFeeBps',
      'Platform fee must be between 0 and 100 percent.',
    );
  }

  final platformFee = operatorSubscribed
      ? const Money.zero()
      : total * (rule.platformFeeBps / 10000);

  return FareSettlement(
    total: total,
    platformFee: platformFee,
    operatorPayout: total - platformFee,
    funding: operatorSubscribed
        ? PlatformFunding.operatorSubscription
        : PlatformFunding.perRide,
  );
}
