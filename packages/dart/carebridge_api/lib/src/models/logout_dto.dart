// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// LogoutDto, from the CareBridge API.
class LogoutDto {
  const LogoutDto({this.refreshToken, this.allDevices});

  final String? refreshToken;

  /// Revoke every session for this account. Also raises the token version, so
  /// access tokens already issued stop working immediately rather than at their
  /// next expiry.
  final bool? allDevices;

  factory LogoutDto.fromJson(Map<String, dynamic> json) => LogoutDto(
    refreshToken: json['refreshToken'] as String?,
    allDevices: json['allDevices'] as bool?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (refreshToken != null) 'refreshToken': refreshToken,
    if (allDevices != null) 'allDevices': allDevices,
  };
}
