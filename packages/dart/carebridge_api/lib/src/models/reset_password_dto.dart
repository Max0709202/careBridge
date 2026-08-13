// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ResetPasswordDto, from the CareBridge API.
class ResetPasswordDto {
  const ResetPasswordDto({required this.token, required this.newPassword});

  /// The single-use token from the emailed link.
  final String token;

  final String newPassword;

  factory ResetPasswordDto.fromJson(Map<String, dynamic> json) =>
      ResetPasswordDto(
        token: json['token'] as String,
        newPassword: json['newPassword'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'token': token,
    'newPassword': newPassword,
  };
}
