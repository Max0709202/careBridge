// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SetNotificationPreferenceDto, from the CareBridge API.
class SetNotificationPreferenceDto {
  const SetNotificationPreferenceDto({
    required this.kind,
    required this.channel,
    required this.enabled,
  });

  final NotificationKind kind;

  final ConfigurableChannel channel;

  final bool enabled;

  factory SetNotificationPreferenceDto.fromJson(Map<String, dynamic> json) =>
      SetNotificationPreferenceDto(
        kind: NotificationKind.fromJson(json['kind'] as String),
        channel: ConfigurableChannel.fromJson(json['channel'] as String),
        enabled: json['enabled'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'kind': kind.wireName,
    'channel': channel.wireName,
    'enabled': enabled,
  };
}
