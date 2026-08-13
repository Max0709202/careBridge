// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DeviceTokenDto, from the CareBridge API.
class DeviceTokenDto {
  const DeviceTokenDto({
    required this.id,
    required this.platform,
    required this.appTarget,
    required this.lastSeenAt,
  });

  final String id;

  final DevicePlatform platform;

  final AppTarget appTarget;

  final DateTime lastSeenAt;

  factory DeviceTokenDto.fromJson(Map<String, dynamic> json) => DeviceTokenDto(
    id: json['id'] as String,
    platform: DevicePlatform.fromJson(json['platform'] as String),
    appTarget: AppTarget.fromJson(json['appTarget'] as String),
    lastSeenAt: DateTime.parse(json['lastSeenAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'platform': platform.wireName,
    'appTarget': appTarget.wireName,
    'lastSeenAt': lastSeenAt.toIso8601String(),
  };
}
