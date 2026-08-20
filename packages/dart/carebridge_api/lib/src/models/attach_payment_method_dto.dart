// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AttachPaymentMethodDto, from the CareBridge API.
class AttachPaymentMethodDto {
  const AttachPaymentMethodDto({required this.token});

  /// A reference the client obtained directly from the payment processor. Never
  /// a card number — no endpoint in this system accepts one (ADR-0006).
  final String token;

  factory AttachPaymentMethodDto.fromJson(Map<String, dynamic> json) =>
      AttachPaymentMethodDto(token: json['token'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'token': token};
}
