// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// MessagePageDto, from the CareBridge API.
class MessagePageDto {
  const MessagePageDto({required this.messages, required this.hasMore});

  /// Oldest first.
  final List<MessageDto> messages;

  /// Whether there are older messages. Ask again with `before` set to the
  /// oldest `createdAt`.
  final bool hasMore;

  factory MessagePageDto.fromJson(Map<String, dynamic> json) => MessagePageDto(
    messages: (json['messages'] as List<dynamic>)
        .map((e) => MessageDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    hasMore: json['hasMore'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'messages': messages.map((e) => e.toJson()).toList(),
    'hasMore': hasMore,
  };
}
