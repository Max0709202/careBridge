// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// PatientDto, from the CareBridge API.
class PatientDto {
  const PatientDto({
    required this.id,
    required this.preferredName,
    this.legalName,
    required this.phone,
    required this.homeAddress,
    this.ageBand,
    required this.preferredLanguage,
    required this.mobilityNeeds,
    this.mobilityNotes,
    required this.emergencyContacts,
    this.preferredClinicId,
    this.archivedAt,
  });

  final String id;

  final String preferredName;

  final String? legalName;

  final String phone;

  final AddressDto homeAddress;

  /// Coarse by design. There is no date of birth anywhere in this API.
  final String? ageBand;

  final String preferredLanguage;

  final List<String> mobilityNeeds;

  final String? mobilityNotes;

  final List<EmergencyContactDto> emergencyContacts;

  final String? preferredClinicId;

  /// Soft delete. Audit and dispute resolution need the record to survive.
  final DateTime? archivedAt;

  factory PatientDto.fromJson(Map<String, dynamic> json) => PatientDto(
    id: json['id'] as String,
    preferredName: json['preferredName'] as String,
    legalName: json['legalName'] as String?,
    phone: json['phone'] as String,
    homeAddress: AddressDto.fromJson(
      json['homeAddress'] as Map<String, dynamic>,
    ),
    ageBand: json['ageBand'] as String?,
    preferredLanguage: json['preferredLanguage'] as String,
    mobilityNeeds: (json['mobilityNeeds'] as List<dynamic>)
        .map((e) => e as String)
        .toList(),
    mobilityNotes: json['mobilityNotes'] as String?,
    emergencyContacts: (json['emergencyContacts'] as List<dynamic>)
        .map((e) => EmergencyContactDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    preferredClinicId: json['preferredClinicId'] as String?,
    archivedAt: json['archivedAt'] == null
        ? null
        : DateTime.parse(json['archivedAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'preferredName': preferredName,
    if (legalName != null) 'legalName': legalName,
    'phone': phone,
    'homeAddress': homeAddress.toJson(),
    if (ageBand != null) 'ageBand': ageBand,
    'preferredLanguage': preferredLanguage,
    'mobilityNeeds': mobilityNeeds.map((e) => e).toList(),
    if (mobilityNotes != null) 'mobilityNotes': mobilityNotes,
    'emergencyContacts': emergencyContacts.map((e) => e.toJson()).toList(),
    if (preferredClinicId != null) 'preferredClinicId': preferredClinicId,
    if (archivedAt != null) 'archivedAt': archivedAt?.toIso8601String(),
  };
}
