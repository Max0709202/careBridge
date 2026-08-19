// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SubscriptionPlanDto, from the CareBridge API.
class SubscriptionPlanDto {
  const SubscriptionPlanDto({
    required this.id,
    required this.code,
    required this.version,
    required this.payer,
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

  final String id;

  final String code;

  /// Immutable price identity, stamped onto every period this plan bills — so a
  /// charge from eight months ago can still be explained.
  final String version;

  final BillingPayer payer;

  final BillingInterval interval;

  final String name;

  final String description;

  final int basePriceCents;

  /// Drivers covered by the base price. Always 0 on a family plan.
  final int includedSeats;

  final List<SubscriptionSeatTierDto> seatTiers;

  final List<String> entitlements;

  final int trialDays;

  /// How long a failed payment keeps entitling. Not zero: cutting live tracking
  /// off the instant a card expires blanks the map mid-trip.
  final int graceDays;

  factory SubscriptionPlanDto.fromJson(Map<String, dynamic> json) =>
      SubscriptionPlanDto(
        id: json['id'] as String,
        code: json['code'] as String,
        version: json['version'] as String,
        payer: BillingPayer.fromJson(json['payer'] as String),
        interval: BillingInterval.fromJson(json['interval'] as String),
        name: json['name'] as String,
        description: json['description'] as String,
        basePriceCents: json['basePriceCents'] as int,
        includedSeats: json['includedSeats'] as int,
        seatTiers: (json['seatTiers'] as List<dynamic>)
            .map(
              (e) =>
                  SubscriptionSeatTierDto.fromJson(e as Map<String, dynamic>),
            )
            .toList(),
        entitlements: (json['entitlements'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        trialDays: json['trialDays'] as int,
        graceDays: json['graceDays'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'code': code,
    'version': version,
    'payer': payer.wireName,
    'interval': interval.wireName,
    'name': name,
    'description': description,
    'basePriceCents': basePriceCents,
    'includedSeats': includedSeats,
    'seatTiers': seatTiers.map((e) => e.toJson()).toList(),
    'entitlements': entitlements.map((e) => e).toList(),
    'trialDays': trialDays,
    'graceDays': graceDays,
  };
}
