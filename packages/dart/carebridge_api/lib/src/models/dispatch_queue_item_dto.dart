// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DispatchQueueItemDto, from the CareBridge API.
class DispatchQueueItemDto {
  const DispatchQueueItemDto({
    required this.rideId,
    required this.status,
    required this.patientName,
    required this.pickupLine,
    required this.destinationLine,
    required this.scheduledPickupAt,
    required this.wheelchairRequired,
    required this.assistanceRequired,
    required this.urgency,
    required this.candidates,
  });

  final String rideId;

  final String status;

  final String patientName;

  final String pickupLine;

  final String destinationLine;

  final DateTime scheduledPickupAt;

  final bool wheelchairRequired;

  final bool assistanceRequired;

  /// "overdue" is its own band rather than the top of "imminent": a pickup time
  /// that has passed with nobody assigned is a failure already in progress —
  /// somebody is standing in a hallway waiting.
  final DispatchUrgency urgency;

  final List<DispatchCandidateDto> candidates;

  factory DispatchQueueItemDto.fromJson(Map<String, dynamic> json) =>
      DispatchQueueItemDto(
        rideId: json['rideId'] as String,
        status: json['status'] as String,
        patientName: json['patientName'] as String,
        pickupLine: json['pickupLine'] as String,
        destinationLine: json['destinationLine'] as String,
        scheduledPickupAt: DateTime.parse(json['scheduledPickupAt'] as String),
        wheelchairRequired: json['wheelchairRequired'] as bool,
        assistanceRequired: json['assistanceRequired'] as bool,
        urgency: DispatchUrgency.fromJson(json['urgency'] as String),
        candidates: (json['candidates'] as List<dynamic>)
            .map(
              (e) => DispatchCandidateDto.fromJson(e as Map<String, dynamic>),
            )
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'rideId': rideId,
    'status': status,
    'patientName': patientName,
    'pickupLine': pickupLine,
    'destinationLine': destinationLine,
    'scheduledPickupAt': scheduledPickupAt.toIso8601String(),
    'wheelchairRequired': wheelchairRequired,
    'assistanceRequired': assistanceRequired,
    'urgency': urgency.wireName,
    'candidates': candidates.map((e) => e.toJson()).toList(),
  };
}
