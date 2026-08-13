// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SessionResponseDto, from the CareBridge API.
class SessionResponseDto {
  const SessionResponseDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresInSeconds,
    required this.state,
  });

  /// Short-lived JWT. Carries the user id, a token version and the session id —
  /// never patient ids or a permission list, which are resolved server-side per
  /// request so revocation takes effect on the next call.
  final String accessToken;

  /// Opaque, single-use, rotated on every refresh. Store it in the platform
  /// keychain, never in shared preferences.
  final String refreshToken;

  final int expiresInSeconds;

  /// The whole snapshot, so the app has everything it needs to render its first
  /// screen without a second round trip. For a new account this is genuinely
  /// empty — the first-run experience should be the one a real user gets, not a
  /// seeded one.
  final CareStateDto state;

  factory SessionResponseDto.fromJson(Map<String, dynamic> json) =>
      SessionResponseDto(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
        expiresInSeconds: json['expiresInSeconds'] as int,
        state: CareStateDto.fromJson(json['state'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresInSeconds': expiresInSeconds,
    'state': state.toJson(),
  };
}
