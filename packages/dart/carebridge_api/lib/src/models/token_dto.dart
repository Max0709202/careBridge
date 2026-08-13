// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// TokenDto, from the CareBridge API.
class TokenDto {
  const TokenDto({required this.token});

  /// The single-use token from the emailed link.
  final String token;

  factory TokenDto.fromJson(Map<String, dynamic> json) =>
      TokenDto(token: json['token'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'token': token};
}
