// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// IssueRefundDto, from the CareBridge API.
class IssueRefundDto {
  const IssueRefundDto({
    required this.paymentId,
    required this.amountCents,
    required this.reason,
  });

  final String paymentId;

  /// Integer cents, never a float. Bounded above by what is left on the
  /// payment.
  final double amountCents;

  /// Required. An unexplained credit is something somebody has to justify to an
  /// accountant a quarter later, by which time whoever issued it has forgotten.
  final String reason;

  factory IssueRefundDto.fromJson(Map<String, dynamic> json) => IssueRefundDto(
    paymentId: json['paymentId'] as String,
    amountCents: (json['amountCents'] as num).toDouble(),
    reason: json['reason'] as String,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'paymentId': paymentId,
    'amountCents': amountCents,
    'reason': reason,
  };
}
