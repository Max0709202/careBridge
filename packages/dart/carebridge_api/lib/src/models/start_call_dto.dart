// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// StartCallDto, from the CareBridge API.
class StartCallDto {
  const StartCallDto({this.conversationId, this.rideId, required this.callee});

  final String? conversationId;

  final String? rideId;

  final CallCalleeDto callee;

  factory StartCallDto.fromJson(Map<String, dynamic> json) => StartCallDto(
    conversationId: json['conversationId'] as String?,
    rideId: json['rideId'] as String?,
    callee: CallCalleeDto.fromJson(json['callee'] as Map<String, dynamic>),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (conversationId != null) 'conversationId': conversationId,
    if (rideId != null) 'rideId': rideId,
    'callee': callee.toJson(),
  };
}
