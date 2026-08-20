// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// InvoiceDto, from the CareBridge API.
class InvoiceDto {
  const InvoiceDto({
    required this.id,
    required this.number,
    required this.reason,
    required this.status,
    required this.currency,
    required this.subtotalCents,
    required this.creditAppliedCents,
    required this.totalCents,
    required this.amountPaidCents,
    required this.lines,
    required this.issuedAt,
    this.paidAt,
    required this.attemptCount,
    this.nextAttemptAt,
    this.lastFailureCode,
  });

  final String id;

  /// Human-quotable. An invoice somebody rings up about has to be findable by
  /// the number printed on it.
  final String number;

  /// What raised it: a billed period, drivers added mid-period, or an interval
  /// switch.
  final InvoiceReason reason;

  /// `uncollectible` is owed and was pursued; `void` was never owed. They are
  /// not the same and are never merged.
  final InvoiceStatus status;

  final String currency;

  final int subtotalCents;

  /// Credit spent against this invoice.
  final int creditAppliedCents;

  final int totalCents;

  final int amountPaidCents;

  final List<InvoiceLineDto> lines;

  final DateTime issuedAt;

  final DateTime? paidAt;

  /// Charges attempted, including the first.
  final int attemptCount;

  /// When the next attempt is scheduled. Null once we have stopped trying.
  final DateTime? nextAttemptAt;

  /// The processor's code for the last decline, for support to read.
  final String? lastFailureCode;

  factory InvoiceDto.fromJson(Map<String, dynamic> json) => InvoiceDto(
    id: json['id'] as String,
    number: json['number'] as String,
    reason: InvoiceReason.fromJson(json['reason'] as String),
    status: InvoiceStatus.fromJson(json['status'] as String),
    currency: json['currency'] as String,
    subtotalCents: json['subtotalCents'] as int,
    creditAppliedCents: json['creditAppliedCents'] as int,
    totalCents: json['totalCents'] as int,
    amountPaidCents: json['amountPaidCents'] as int,
    lines: (json['lines'] as List<dynamic>)
        .map((e) => InvoiceLineDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    issuedAt: DateTime.parse(json['issuedAt'] as String),
    paidAt: json['paidAt'] == null
        ? null
        : DateTime.parse(json['paidAt'] as String),
    attemptCount: json['attemptCount'] as int,
    nextAttemptAt: json['nextAttemptAt'] == null
        ? null
        : DateTime.parse(json['nextAttemptAt'] as String),
    lastFailureCode: json['lastFailureCode'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'number': number,
    'reason': reason.wireName,
    'status': status.wireName,
    'currency': currency,
    'subtotalCents': subtotalCents,
    'creditAppliedCents': creditAppliedCents,
    'totalCents': totalCents,
    'amountPaidCents': amountPaidCents,
    'lines': lines.map((e) => e.toJson()).toList(),
    'issuedAt': issuedAt.toIso8601String(),
    if (paidAt != null) 'paidAt': paidAt?.toIso8601String(),
    'attemptCount': attemptCount,
    if (nextAttemptAt != null)
      'nextAttemptAt': nextAttemptAt?.toIso8601String(),
    if (lastFailureCode != null) 'lastFailureCode': lastFailureCode,
  };
}
