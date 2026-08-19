// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SubscribeDto, from the CareBridge API.
class SubscribeDto {
  const SubscribeDto({required this.planCode, required this.interval});

  /// Plan code, e.g. "family-standard" or "dispatch-core".
  final String planCode;

  final BillingInterval interval;

  factory SubscribeDto.fromJson(Map<String, dynamic> json) => SubscribeDto(
    planCode: json['planCode'] as String,
    interval: BillingInterval.fromJson(json['interval'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'planCode': planCode,
    'interval': interval.wireName,
  };
}
