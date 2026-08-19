// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SubscriptionQuoteDto, from the CareBridge API.
class SubscriptionQuoteDto {
  const SubscriptionQuoteDto({
    required this.planCode,
    required this.planVersion,
    required this.interval,
    required this.seats,
    required this.billableSeats,
    required this.lines,
    required this.totalCents,
  });

  final String planCode;

  final String planVersion;

  final BillingInterval interval;

  final int seats;

  final int billableSeats;

  final List<SubscriptionLineDto> lines;

  final int totalCents;

  factory SubscriptionQuoteDto.fromJson(Map<String, dynamic> json) =>
      SubscriptionQuoteDto(
        planCode: json['planCode'] as String,
        planVersion: json['planVersion'] as String,
        interval: BillingInterval.fromJson(json['interval'] as String),
        seats: json['seats'] as int,
        billableSeats: json['billableSeats'] as int,
        lines: (json['lines'] as List<dynamic>)
            .map((e) => SubscriptionLineDto.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalCents: json['totalCents'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'planCode': planCode,
    'planVersion': planVersion,
    'interval': interval.wireName,
    'seats': seats,
    'billableSeats': billableSeats,
    'lines': lines.map((e) => e.toJson()).toList(),
    'totalCents': totalCents,
  };
}
