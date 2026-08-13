// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RefreshDto, from the CareBridge API.
class RefreshDto {
  const RefreshDto({required this.refreshToken});

  final String refreshToken;

  factory RefreshDto.fromJson(Map<String, dynamic> json) =>
      RefreshDto(refreshToken: json['refreshToken'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{
    'refreshToken': refreshToken,
  };
}
