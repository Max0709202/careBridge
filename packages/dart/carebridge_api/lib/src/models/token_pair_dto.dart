// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// TokenPairDto, from the CareBridge API.
class TokenPairDto {
  const TokenPairDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresInSeconds,
  });

  /// Short-lived JWT. Carries the user id, a token version and the session id —
  /// never patient ids or a permission list, which are resolved server-side per
  /// request so revocation takes effect on the next call.
  final String accessToken;

  /// Opaque, single-use, rotated on every refresh. Store it in the platform
  /// keychain, never in shared preferences.
  final String refreshToken;

  final int expiresInSeconds;

  factory TokenPairDto.fromJson(Map<String, dynamic> json) => TokenPairDto(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresInSeconds: json['expiresInSeconds'] as int,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresInSeconds': expiresInSeconds,
  };
}
