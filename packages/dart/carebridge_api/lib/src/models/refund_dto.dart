// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// RefundDto, from the CareBridge API.
class RefundDto {
  const RefundDto({
    required this.id,
    required this.invoiceId,
    required this.invoiceNumber,
    required this.amountCents,
    required this.currency,
    required this.reason,
    required this.status,
    this.failureMessage,
    required this.requestedByName,
    required this.createdAt,
    this.settledAt,
  });

  final String id;

  final String invoiceId;

  final String invoiceNumber;

  final int amountCents;

  final String currency;

  final String reason;

  final RefundDtoStatus status;

  final String? failureMessage;

  final String requestedByName;

  final DateTime createdAt;

  final DateTime? settledAt;

  factory RefundDto.fromJson(Map<String, dynamic> json) => RefundDto(
    id: json['id'] as String,
    invoiceId: json['invoiceId'] as String,
    invoiceNumber: json['invoiceNumber'] as String,
    amountCents: json['amountCents'] as int,
    currency: json['currency'] as String,
    reason: json['reason'] as String,
    status: RefundDtoStatus.fromJson(json['status'] as String),
    failureMessage: json['failureMessage'] as String?,
    requestedByName: json['requestedByName'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    settledAt: json['settledAt'] == null
        ? null
        : DateTime.parse(json['settledAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'invoiceId': invoiceId,
    'invoiceNumber': invoiceNumber,
    'amountCents': amountCents,
    'currency': currency,
    'reason': reason,
    'status': status.wireName,
    if (failureMessage != null) 'failureMessage': failureMessage,
    'requestedByName': requestedByName,
    'createdAt': createdAt.toIso8601String(),
    if (settledAt != null) 'settledAt': settledAt?.toIso8601String(),
  };
}
