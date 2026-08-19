// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SubscriptionSeatTierDto, from the CareBridge API.
class SubscriptionSeatTierDto {
  const SubscriptionSeatTierDto({this.upToSeats, required this.unitPriceCents});

  /// Total driver count this band covers, inclusive. Null on the final band,
  /// which is unbounded.
  final int? upToSeats;

  final int unitPriceCents;

  factory SubscriptionSeatTierDto.fromJson(Map<String, dynamic> json) =>
      SubscriptionSeatTierDto(
        upToSeats: json['upToSeats'] as int?,
        unitPriceCents: json['unitPriceCents'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (upToSeats != null) 'upToSeats': upToSeats,
    'unitPriceCents': unitPriceCents,
  };
}
