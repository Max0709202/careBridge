// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// BillingAccountDto, from the CareBridge API.
class BillingAccountDto {
  const BillingAccountDto({
    required this.id,
    required this.payer,
    required this.billingEmail,
    this.organizationId,
    this.subscription,
    this.paymentMethod,
    required this.amountDueCents,
  });

  final String id;

  final BillingPayer payer;

  final String billingEmail;

  /// Set on an operator account, null on a family one.
  final String? organizationId;

  final SubscriptionDto? subscription;

  /// The card renewals are charged against, or null if there is none.
  final PaymentMethodDto? paymentMethod;

  /// Total owed across every open invoice. Zero when nothing is outstanding.
  final int amountDueCents;

  factory BillingAccountDto.fromJson(Map<String, dynamic> json) =>
      BillingAccountDto(
        id: json['id'] as String,
        payer: BillingPayer.fromJson(json['payer'] as String),
        billingEmail: json['billingEmail'] as String,
        organizationId: json['organizationId'] as String?,
        subscription: json['subscription'] == null
            ? null
            : SubscriptionDto.fromJson(
                json['subscription'] as Map<String, dynamic>,
              ),
        paymentMethod: json['paymentMethod'] == null
            ? null
            : PaymentMethodDto.fromJson(
                json['paymentMethod'] as Map<String, dynamic>,
              ),
        amountDueCents: json['amountDueCents'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'payer': payer.wireName,
    'billingEmail': billingEmail,
    if (organizationId != null) 'organizationId': organizationId,
    if (subscription != null) 'subscription': subscription?.toJson(),
    if (paymentMethod != null) 'paymentMethod': paymentMethod?.toJson(),
    'amountDueCents': amountDueCents,
  };
}
