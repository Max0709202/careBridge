// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// AppointmentDto, from the CareBridge API.
class AppointmentDto {
  const AppointmentDto({
    required this.id,
    required this.patientId,
    required this.clinicId,
    required this.startsAt,
    required this.expectedDurationMinutes,
    required this.type,
    required this.status,
    this.coordinationNotes,
    required this.transportRequired,
    required this.timeZoneLabel,
    required this.history,
    required this.createdAt,
  });

  final String id;

  final String patientId;

  final String clinicId;

  final DateTime startsAt;

  final int expectedDurationMinutes;

  final String type;

  final String status;

  final String? coordinationNotes;

  final bool transportRequired;

  /// The label a person reads, e.g. "clinic time" — not the IANA zone the
  /// scheduler computes in. Conflating the two is how a reminder fires at 3am.
  final String timeZoneLabel;

  final List<StatusChangeDto> history;

  final DateTime createdAt;

  factory AppointmentDto.fromJson(Map<String, dynamic> json) => AppointmentDto(
    id: json['id'] as String,
    patientId: json['patientId'] as String,
    clinicId: json['clinicId'] as String,
    startsAt: DateTime.parse(json['startsAt'] as String),
    expectedDurationMinutes: json['expectedDurationMinutes'] as int,
    type: json['type'] as String,
    status: json['status'] as String,
    coordinationNotes: json['coordinationNotes'] as String?,
    transportRequired: json['transportRequired'] as bool,
    timeZoneLabel: json['timeZoneLabel'] as String,
    history: (json['history'] as List<dynamic>)
        .map((e) => StatusChangeDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    createdAt: DateTime.parse(json['createdAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'patientId': patientId,
    'clinicId': clinicId,
    'startsAt': startsAt.toIso8601String(),
    'expectedDurationMinutes': expectedDurationMinutes,
    'type': type,
    'status': status,
    if (coordinationNotes != null) 'coordinationNotes': coordinationNotes,
    'transportRequired': transportRequired,
    'timeZoneLabel': timeZoneLabel,
    'history': history.map((e) => e.toJson()).toList(),
    'createdAt': createdAt.toIso8601String(),
  };
}
