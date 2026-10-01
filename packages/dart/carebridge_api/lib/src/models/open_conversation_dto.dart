// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// OpenConversationDto, from the CareBridge API.
class OpenConversationDto {
  const OpenConversationDto({
    required this.kind,
    this.organizationId,
    this.patientId,
    this.driverId,
    this.peerDriverId,
    this.rideId,
  });

  final ConversationKind kind;

  final String? organizationId;

  final String? patientId;

  final String? driverId;

  /// `driverDriver`: the colleague. The caller is the other side.
  final String? peerDriverId;

  /// Tie the thread to one trip. `dispatchFamily` and `dispatchDriver` only.
  final String? rideId;

  factory OpenConversationDto.fromJson(Map<String, dynamic> json) => OpenConversationDto(
        kind: ConversationKind.fromJson(json['kind'] as String),
        organizationId: json['organizationId'] as String?,
        patientId: json['patientId'] as String?,
        driverId: json['driverId'] as String?,
        peerDriverId: json['peerDriverId'] as String?,
        rideId: json['rideId'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind.wireName,
        if (organizationId != null) 'organizationId': organizationId,
        if (patientId != null) 'patientId': patientId,
        if (driverId != null) 'driverId': driverId,
        if (peerDriverId != null) 'peerDriverId': peerDriverId,
        if (rideId != null) 'rideId': rideId,
      };
}
