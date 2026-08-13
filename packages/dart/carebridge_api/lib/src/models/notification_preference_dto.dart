// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// NotificationPreferenceDto, from the CareBridge API.
class NotificationPreferenceDto {
  const NotificationPreferenceDto({
    required this.kind,
    required this.channel,
    required this.enabled,
    required this.configurable,
  });

  final NotificationKind kind;

  final NotificationChannel channel;

  final bool enabled;

  /// False for in-app. The centre inside the app is the record of what
  /// happened; a timeline a user can switch off would lie by omission, and the
  /// timeline is what disputes are resolved with.
  final bool configurable;

  factory NotificationPreferenceDto.fromJson(Map<String, dynamic> json) =>
      NotificationPreferenceDto(
        kind: NotificationKind.fromJson(json['kind'] as String),
        channel: NotificationChannel.fromJson(json['channel'] as String),
        enabled: json['enabled'] as bool,
        configurable: json['configurable'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'kind': kind.wireName,
    'channel': channel.wireName,
    'enabled': enabled,
    'configurable': configurable,
  };
}
