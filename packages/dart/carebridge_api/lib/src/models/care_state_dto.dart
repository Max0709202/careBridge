// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CareStateDto, from the CareBridge API.
class CareStateDto {
  const CareStateDto({
    this.user,
    required this.patients,
    required this.access,
    required this.clinics,
    required this.appointments,
    required this.rides,
    required this.notifications,
    this.selectedPatientId,
    required this.simplifiedMode,
  });

  final AppUserDto? user;

  final List<PatientDto> patients;

  /// Keyed by patient id. Only active grants appear — a revoked grant closes
  /// every surface at once, so the patient, their appointments, their rides and
  /// their live position all disappear from the next snapshot together.
  final Map<String, PatientAccessDto> access;

  final List<ClinicDto> clinics;

  final List<AppointmentDto> appointments;

  final List<RideDto> rides;

  final List<NotificationDto> notifications;

  final String? selectedPatientId;

  final bool simplifiedMode;

  factory CareStateDto.fromJson(Map<String, dynamic> json) => CareStateDto(
    user: json['user'] == null
        ? null
        : AppUserDto.fromJson(json['user'] as Map<String, dynamic>),
    patients: (json['patients'] as List<dynamic>)
        .map((e) => PatientDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    access: (json['access'] as Map<String, dynamic>).map(
      (k, v) =>
          MapEntry(k, PatientAccessDto.fromJson(v as Map<String, dynamic>)),
    ),
    clinics: (json['clinics'] as List<dynamic>)
        .map((e) => ClinicDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    appointments: (json['appointments'] as List<dynamic>)
        .map((e) => AppointmentDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    rides: (json['rides'] as List<dynamic>)
        .map((e) => RideDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    notifications: (json['notifications'] as List<dynamic>)
        .map((e) => NotificationDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    selectedPatientId: json['selectedPatientId'] as String?,
    simplifiedMode: json['simplifiedMode'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (user != null) 'user': user?.toJson(),
    'patients': patients.map((e) => e.toJson()).toList(),
    'access': access.map((k, v) => MapEntry(k, v.toJson())),
    'clinics': clinics.map((e) => e.toJson()).toList(),
    'appointments': appointments.map((e) => e.toJson()).toList(),
    'rides': rides.map((e) => e.toJson()).toList(),
    'notifications': notifications.map((e) => e.toJson()).toList(),
    if (selectedPatientId != null) 'selectedPatientId': selectedPatientId,
    'simplifiedMode': simplifiedMode,
  };
}
