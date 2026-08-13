// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// RegisterDeviceDto, from the CareBridge API.
class RegisterDeviceDto {
  const RegisterDeviceDto({
    required this.token,
    required this.platform,
    this.appTarget,
  });

  /// The FCM registration token.
  final String token;

  final DevicePlatform platform;

  /// Which install this token belongs to. The driver app is a separate binary
  /// (D4) with a separate token set — a family notification arriving on a
  /// driver’s phone would be both confusing and a disclosure.
  final RegisterDeviceDtoAppTarget? appTarget;

  factory RegisterDeviceDto.fromJson(Map<String, dynamic> json) =>
      RegisterDeviceDto(
        token: json['token'] as String,
        platform: DevicePlatform.fromJson(json['platform'] as String),
        appTarget: json['appTarget'] == null
            ? null
            : RegisterDeviceDtoAppTarget.fromJson(json['appTarget'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'token': token,
    'platform': platform.wireName,
    if (appTarget != null) 'appTarget': appTarget?.wireName,
  };
}
