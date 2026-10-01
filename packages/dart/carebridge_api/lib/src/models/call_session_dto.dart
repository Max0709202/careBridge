// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CallSessionDto, from the CareBridge API.
class CallSessionDto {
  const CallSessionDto({
    required this.id,
    required this.status,
    required this.calleeKind,
    required this.calleeLabel,
    this.conversationId,
    this.rideId,
    required this.startedAt,
    this.answeredAt,
    this.endedAt,
    this.durationSeconds,
  });

  final String id;

  final CallStatus status;

  final CallPartyKind calleeKind;

  final String calleeLabel;

  final String? conversationId;

  final String? rideId;

  final DateTime startedAt;

  final DateTime? answeredAt;

  final DateTime? endedAt;

  final double? durationSeconds;

  factory CallSessionDto.fromJson(Map<String, dynamic> json) => CallSessionDto(
        id: json['id'] as String,
        status: CallStatus.fromJson(json['status'] as String),
        calleeKind: CallPartyKind.fromJson(json['calleeKind'] as String),
        calleeLabel: json['calleeLabel'] as String,
        conversationId: json['conversationId'] as String?,
        rideId: json['rideId'] as String?,
        startedAt: DateTime.parse(json['startedAt'] as String),
        answeredAt: json['answeredAt'] == null ? null : DateTime.parse(json['answeredAt'] as String),
        endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
        durationSeconds: json['durationSeconds'] == null ? null : (json['durationSeconds'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'status': status.wireName,
        'calleeKind': calleeKind.wireName,
        'calleeLabel': calleeLabel,
        if (conversationId != null) 'conversationId': conversationId,
        if (rideId != null) 'rideId': rideId,
        'startedAt': startedAt.toIso8601String(),
        if (answeredAt != null) 'answeredAt': answeredAt?.toIso8601String(),
        if (endedAt != null) 'endedAt': endedAt?.toIso8601String(),
        if (durationSeconds != null) 'durationSeconds': durationSeconds,
      };
}
