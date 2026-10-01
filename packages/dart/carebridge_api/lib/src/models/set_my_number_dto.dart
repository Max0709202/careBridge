// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SetMyNumberDto, from the CareBridge API.
class SetMyNumberDto {
  const SetMyNumberDto({
    required this.phone,
  });

  /// Written any reasonable way; stored as E.164. An empty string removes it.
  final String phone;

  factory SetMyNumberDto.fromJson(Map<String, dynamic> json) => SetMyNumberDto(
        phone: json['phone'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'phone': phone,
      };
}
