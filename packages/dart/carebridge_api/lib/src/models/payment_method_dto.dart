// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// PaymentMethodDto, from the CareBridge API.
class PaymentMethodDto {
  const PaymentMethodDto({
    required this.id,
    required this.brand,
    required this.last4,
    required this.expMonth,
    required this.expYear,
    required this.isDefault,
  });

  final String id;

  /// Card brand. Display only — no card number exists in this system.
  final String brand;

  final String last4;

  final int expMonth;

  final int expYear;

  /// Which card renewals are charged against. At most one per account.
  final bool isDefault;

  factory PaymentMethodDto.fromJson(Map<String, dynamic> json) =>
      PaymentMethodDto(
        id: json['id'] as String,
        brand: json['brand'] as String,
        last4: json['last4'] as String,
        expMonth: json['expMonth'] as int,
        expYear: json['expYear'] as int,
        isDefault: json['isDefault'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'brand': brand,
    'last4': last4,
    'expMonth': expMonth,
    'expYear': expYear,
    'isDefault': isDefault,
  };
}
