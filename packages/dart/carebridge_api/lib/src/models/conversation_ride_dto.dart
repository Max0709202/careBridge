// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ConversationRideDto, from the CareBridge API.
class ConversationRideDto {
  const ConversationRideDto({
    required this.id,
    required this.status,
    required this.direction,
    required this.scheduledPickupAt,
    required this.patientName,
  });

  final String id;

  final RideStatus status;

  final String direction;

  final DateTime scheduledPickupAt;

  /// The passenger's preferred name. Everyone who can read the thread can
  /// already see it on the ride.
  final String patientName;

  factory ConversationRideDto.fromJson(Map<String, dynamic> json) =>
      ConversationRideDto(
        id: json['id'] as String,
        status: RideStatus.fromJson(json['status'] as String),
        direction: json['direction'] as String,
        scheduledPickupAt: DateTime.parse(json['scheduledPickupAt'] as String),
        patientName: json['patientName'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'status': status.wireName,
    'direction': direction,
    'scheduledPickupAt': scheduledPickupAt.toIso8601String(),
    'patientName': patientName,
  };
}
