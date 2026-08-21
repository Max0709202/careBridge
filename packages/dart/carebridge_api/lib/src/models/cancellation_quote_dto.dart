// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CancellationQuoteDto, from the CareBridge API.
class CancellationQuoteDto {
  const CancellationQuoteDto({
    required this.feeCents,
    required this.explanation,
  });

  final int feeCents;

  /// Shown before the family confirms, in their own words.
  final String explanation;

  factory CancellationQuoteDto.fromJson(Map<String, dynamic> json) =>
      CancellationQuoteDto(
        feeCents: json['feeCents'] as int,
        explanation: json['explanation'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'feeCents': feeCents,
    'explanation': explanation,
  };
}
