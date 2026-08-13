// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// MfaEnrolmentDto, from the CareBridge API.
class MfaEnrolmentDto {
  const MfaEnrolmentDto({
    required this.otpauthUri,
    required this.secretBase32,
    required this.recoveryCodes,
  });

  /// Rendered as a QR code by the client. Returned exactly once — it cannot be
  /// read back, because a re-readable second factor is not one.
  final String otpauthUri;

  /// For manual entry when there is no camera.
  final String secretBase32;

  /// Shown once, stored only as digests. Support cannot read them back, which
  /// is the point — a recoverable recovery code is a social-engineering path.
  final List<String> recoveryCodes;

  factory MfaEnrolmentDto.fromJson(Map<String, dynamic> json) =>
      MfaEnrolmentDto(
        otpauthUri: json['otpauthUri'] as String,
        secretBase32: json['secretBase32'] as String,
        recoveryCodes: (json['recoveryCodes'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'otpauthUri': otpauthUri,
    'secretBase32': secretBase32,
    'recoveryCodes': recoveryCodes.map((e) => e).toList(),
  };
}
