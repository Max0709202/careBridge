// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// RefundableInvoiceDto, from the CareBridge API.
class RefundableInvoiceDto {
  const RefundableInvoiceDto({
    required this.invoiceId,
    required this.invoiceNumber,
    required this.paymentId,
    required this.paidCents,
    required this.refundableCents,
    required this.refunds,
  });

  final String invoiceId;

  final String invoiceNumber;

  final String paymentId;

  final int paidCents;

  /// What is left to refund: the payment less everything already refunded
  /// against it. The ceiling on a new refund.
  final int refundableCents;

  final List<RefundDto> refunds;

  factory RefundableInvoiceDto.fromJson(Map<String, dynamic> json) =>
      RefundableInvoiceDto(
        invoiceId: json['invoiceId'] as String,
        invoiceNumber: json['invoiceNumber'] as String,
        paymentId: json['paymentId'] as String,
        paidCents: json['paidCents'] as int,
        refundableCents: json['refundableCents'] as int,
        refunds: (json['refunds'] as List<dynamic>)
            .map((e) => RefundDto.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'invoiceId': invoiceId,
    'invoiceNumber': invoiceNumber,
    'paymentId': paymentId,
    'paidCents': paidCents,
    'refundableCents': refundableCents,
    'refunds': refunds.map((e) => e.toJson()).toList(),
  };
}
