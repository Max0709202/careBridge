// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SubscriptionLineDto, from the CareBridge API.
class SubscriptionLineDto {
  const SubscriptionLineDto({
    required this.label,
    required this.quantity,
    required this.unitPriceCents,
    required this.amountCents,
  });

  final String label;

  final int quantity;

  final int unitPriceCents;

  final int amountCents;

  factory SubscriptionLineDto.fromJson(Map<String, dynamic> json) =>
      SubscriptionLineDto(
        label: json['label'] as String,
        quantity: json['quantity'] as int,
        unitPriceCents: json['unitPriceCents'] as int,
        amountCents: json['amountCents'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'label': label,
    'quantity': quantity,
    'unitPriceCents': unitPriceCents,
    'amountCents': amountCents,
  };
}
