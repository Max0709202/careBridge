// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// MfaCodeDto, from the CareBridge API.
class MfaCodeDto {
  const MfaCodeDto({required this.code});

  /// Six-digit authenticator code, or a recovery code.
  final String code;

  factory MfaCodeDto.fromJson(Map<String, dynamic> json) =>
      MfaCodeDto(code: json['code'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'code': code};
}
