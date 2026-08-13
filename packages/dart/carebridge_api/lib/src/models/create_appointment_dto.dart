// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CreateAppointmentDto, from the CareBridge API.
class CreateAppointmentDto {
  const CreateAppointmentDto({
    required this.patientId,
    required this.clinicId,
    required this.startsAt,
    required this.expectedDurationMinutes,
    required this.type,
    this.coordinationNotes,
    this.transportRequired,
  });

  final String patientId;

  final String clinicId;

  /// UTC. Reminder offsets are measured against the clinic’s local wall time,
  /// which the appointment inherits from the clinic record.
  final DateTime startsAt;

  final double expectedDurationMinutes;

  /// Coarse on purpose. "Specialist" is enough to plan a visit’s length and
  /// transport; the specialty itself is clinical information this API does not
  /// accept.
  final AppointmentType type;

  /// Logistics only: "bring the walker", "Dr Osei’s office is on floor 3".
  /// Never symptoms, diagnoses or medication.
  final String? coordinationNotes;

  final bool? transportRequired;

  factory CreateAppointmentDto.fromJson(Map<String, dynamic> json) =>
      CreateAppointmentDto(
        patientId: json['patientId'] as String,
        clinicId: json['clinicId'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        expectedDurationMinutes: (json['expectedDurationMinutes'] as num)
            .toDouble(),
        type: AppointmentType.fromJson(json['type'] as String),
        coordinationNotes: json['coordinationNotes'] as String?,
        transportRequired: json['transportRequired'] as bool?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'patientId': patientId,
    'clinicId': clinicId,
    'startsAt': startsAt.toIso8601String(),
    'expectedDurationMinutes': expectedDurationMinutes,
    'type': type.wireName,
    if (coordinationNotes != null) 'coordinationNotes': coordinationNotes,
    if (transportRequired != null) 'transportRequired': transportRequired,
  };
}
