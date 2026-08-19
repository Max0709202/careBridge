// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SubscriptionDto, from the CareBridge API.
class SubscriptionDto {
  const SubscriptionDto({
    required this.id,
    required this.payer,
    required this.status,
    required this.interval,
    required this.planCode,
    required this.planName,
    required this.planVersion,
    required this.seats,
    required this.currentPeriodStart,
    required this.currentPeriodEnd,
    this.trialEndsAt,
    this.pastDueSince,
    this.cancelRequestedAt,
    required this.entitlements,
    required this.carriedCreditCents,
    required this.renewalQuote,
  });

  final String id;

  final BillingPayer payer;

  final SubscriptionStatus status;

  final BillingInterval interval;

  final String planCode;

  final String planName;

  final String planVersion;

  /// Drivers billed from the next renewal. Zero on a family subscription.
  final int seats;

  final DateTime currentPeriodStart;

  final DateTime currentPeriodEnd;

  final DateTime? trialEndsAt;

  /// When a payment first failed. Entitlements survive until this plus the plan
  /// grace window.
  final DateTime? pastDueSince;

  final DateTime? cancelRequestedAt;

  /// What is switched on right now — resolved server-side from status, period
  /// and grace. The client renders it; it never derives it.
  final List<String> entitlements;

  final int carriedCreditCents;

  /// What the next renewal will cost at the current driver count.
  final SubscriptionQuoteDto renewalQuote;

  factory SubscriptionDto.fromJson(Map<String, dynamic> json) =>
      SubscriptionDto(
        id: json['id'] as String,
        payer: BillingPayer.fromJson(json['payer'] as String),
        status: SubscriptionStatus.fromJson(json['status'] as String),
        interval: BillingInterval.fromJson(json['interval'] as String),
        planCode: json['planCode'] as String,
        planName: json['planName'] as String,
        planVersion: json['planVersion'] as String,
        seats: json['seats'] as int,
        currentPeriodStart: DateTime.parse(
          json['currentPeriodStart'] as String,
        ),
        currentPeriodEnd: DateTime.parse(json['currentPeriodEnd'] as String),
        trialEndsAt: json['trialEndsAt'] == null
            ? null
            : DateTime.parse(json['trialEndsAt'] as String),
        pastDueSince: json['pastDueSince'] == null
            ? null
            : DateTime.parse(json['pastDueSince'] as String),
        cancelRequestedAt: json['cancelRequestedAt'] == null
            ? null
            : DateTime.parse(json['cancelRequestedAt'] as String),
        entitlements: (json['entitlements'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        carriedCreditCents: json['carriedCreditCents'] as int,
        renewalQuote: SubscriptionQuoteDto.fromJson(
          json['renewalQuote'] as Map<String, dynamic>,
        ),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'payer': payer.wireName,
    'status': status.wireName,
    'interval': interval.wireName,
    'planCode': planCode,
    'planName': planName,
    'planVersion': planVersion,
    'seats': seats,
    'currentPeriodStart': currentPeriodStart.toIso8601String(),
    'currentPeriodEnd': currentPeriodEnd.toIso8601String(),
    if (trialEndsAt != null) 'trialEndsAt': trialEndsAt?.toIso8601String(),
    if (pastDueSince != null) 'pastDueSince': pastDueSince?.toIso8601String(),
    if (cancelRequestedAt != null)
      'cancelRequestedAt': cancelRequestedAt?.toIso8601String(),
    'entitlements': entitlements.map((e) => e).toList(),
    'carriedCreditCents': carriedCreditCents,
    'renewalQuote': renewalQuote.toJson(),
  };
}
