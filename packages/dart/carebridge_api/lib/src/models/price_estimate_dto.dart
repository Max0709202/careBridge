// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// PriceEstimateDto, from the CareBridge API.
class PriceEstimateDto {
  const PriceEstimateDto({
    required this.ruleVersion,
    required this.distanceMiles,
    required this.durationMinutes,
    required this.baseCents,
    required this.distanceChargeCents,
    required this.timeChargeCents,
    required this.surcharges,
    required this.totalCents,
    required this.minimumApplied,
  });

  /// The pricing rule that produced these numbers, so a historical charge can
  /// always be explained.
  final String ruleVersion;

  final double distanceMiles;

  final int durationMinutes;

  final int baseCents;

  final int distanceChargeCents;

  final int timeChargeCents;

  final List<SurchargeDto> surcharges;

  final int totalCents;

  final bool minimumApplied;

  factory PriceEstimateDto.fromJson(Map<String, dynamic> json) =>
      PriceEstimateDto(
        ruleVersion: json['ruleVersion'] as String,
        distanceMiles: (json['distanceMiles'] as num).toDouble(),
        durationMinutes: json['durationMinutes'] as int,
        baseCents: json['baseCents'] as int,
        distanceChargeCents: json['distanceChargeCents'] as int,
        timeChargeCents: json['timeChargeCents'] as int,
        surcharges: (json['surcharges'] as List<dynamic>)
            .map((e) => SurchargeDto.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalCents: json['totalCents'] as int,
        minimumApplied: json['minimumApplied'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'ruleVersion': ruleVersion,
    'distanceMiles': distanceMiles,
    'durationMinutes': durationMinutes,
    'baseCents': baseCents,
    'distanceChargeCents': distanceChargeCents,
    'timeChargeCents': timeChargeCents,
    'surcharges': surcharges.map((e) => e.toJson()).toList(),
    'totalCents': totalCents,
    'minimumApplied': minimumApplied,
  };
}
