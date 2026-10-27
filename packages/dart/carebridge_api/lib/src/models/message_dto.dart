// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// MessageDto, from the CareBridge API.
class MessageDto {
  const MessageDto({
    required this.id,
    required this.conversationId,
    required this.senderRole,
    required this.senderLabel,
    required this.body,
    required this.createdAt,
    required this.clientMessageId,
    required this.mine,
  });

  final String id;

  final String conversationId;

  final MessageSenderRole senderRole;

  /// Who wrote it, as they were labelled when they wrote it — "Dana ·
  /// Dispatch", "Marcus T.", "Sarah (daughter)". "Former member" after an
  /// account is deleted.
  final String senderLabel;

  final String body;

  final DateTime createdAt;

  /// Echoed back so a client can reconcile its optimistic copy with the stored
  /// one.
  final String clientMessageId;

  /// Written by the caller.
  final bool mine;

  factory MessageDto.fromJson(Map<String, dynamic> json) => MessageDto(
    id: json['id'] as String,
    conversationId: json['conversationId'] as String,
    senderRole: MessageSenderRole.fromJson(json['senderRole'] as String),
    senderLabel: json['senderLabel'] as String,
    body: json['body'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    clientMessageId: json['clientMessageId'] as String,
    mine: json['mine'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'conversationId': conversationId,
    'senderRole': senderRole.wireName,
    'senderLabel': senderLabel,
    'body': body,
    'createdAt': createdAt.toIso8601String(),
    'clientMessageId': clientMessageId,
    'mine': mine,
  };
}
