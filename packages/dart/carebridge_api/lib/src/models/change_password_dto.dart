// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ChangePasswordDto, from the CareBridge API.
class ChangePasswordDto {
  const ChangePasswordDto({
    required this.currentPassword,
    required this.newPassword,
  });

  final String currentPassword;

  final String newPassword;

  factory ChangePasswordDto.fromJson(Map<String, dynamic> json) =>
      ChangePasswordDto(
        currentPassword: json['currentPassword'] as String,
        newPassword: json['newPassword'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'currentPassword': currentPassword,
    'newPassword': newPassword,
  };
}
