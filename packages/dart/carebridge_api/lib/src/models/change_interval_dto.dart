// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ChangeIntervalDto, from the CareBridge API.
class ChangeIntervalDto {
  const ChangeIntervalDto({required this.interval});

  /// The unused remainder of the current period is credited; a fresh period
  /// starts today. Annual → monthly produces a credit carried forward, not a
  /// refund.
  final BillingInterval interval;

  factory ChangeIntervalDto.fromJson(Map<String, dynamic> json) =>
      ChangeIntervalDto(
        interval: BillingInterval.fromJson(json['interval'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'interval': interval.wireName,
  };
}
