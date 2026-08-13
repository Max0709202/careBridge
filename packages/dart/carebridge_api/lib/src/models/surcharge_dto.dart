// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SurchargeDto, from the CareBridge API.
class SurchargeDto {
  const SurchargeDto({required this.label, required this.amountCents});

  final String label;

  final int amountCents;

  factory SurchargeDto.fromJson(Map<String, dynamic> json) => SurchargeDto(
    label: json['label'] as String,
    amountCents: json['amountCents'] as int,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'label': label,
    'amountCents': amountCents,
  };
}
