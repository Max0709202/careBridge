// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SavePatientDto, from the CareBridge API.
class SavePatientDto {
  const SavePatientDto({
    required this.preferredName,
    this.legalName,
    required this.phone,
    required this.homeAddress,
    this.ageBand,
    this.preferredLanguage,
    this.mobilityNeeds,
    this.mobilityNotes,
    this.emergencyContacts,
    this.preferredClinicId,
    this.relationship,
  });

  /// Required. Someone must be greeted by the name they actually use.
  final String preferredName;

  /// Collected only when a transport provider or clinic needs it to match their
  /// records — never required of everyone.
  final String? legalName;

  final String phone;

  final AddressInput homeAddress;

  /// Coarse by design. There is no date-of-birth field anywhere in this API:
  /// name + address + DOB is the classic re-identification triple, and nothing
  /// in arranging a car needs it.
  final AgeBand? ageBand;

  final String? preferredLanguage;

  /// Operational, not diagnostic. What a driver and a vehicle need to know, and
  /// nothing about why.
  final List<MobilityNeed>? mobilityNeeds;

  final String? mobilityNotes;

  final List<EmergencyContactInput>? emergencyContacts;

  final String? preferredClinicId;

  /// The creator’s relationship to the patient, recorded on the access grant
  /// this call creates.
  final RelationshipType? relationship;

  factory SavePatientDto.fromJson(Map<String, dynamic> json) => SavePatientDto(
    preferredName: json['preferredName'] as String,
    legalName: json['legalName'] as String?,
    phone: json['phone'] as String,
    homeAddress: AddressInput.fromJson(
      json['homeAddress'] as Map<String, dynamic>,
    ),
    ageBand: json['ageBand'] == null
        ? null
        : AgeBand.fromJson(json['ageBand'] as String),
    preferredLanguage: json['preferredLanguage'] as String?,
    mobilityNeeds: json['mobilityNeeds'] == null
        ? null
        : (json['mobilityNeeds'] as List<dynamic>)
              .map((e) => MobilityNeed.fromJson(e as String))
              .toList(),
    mobilityNotes: json['mobilityNotes'] as String?,
    emergencyContacts: json['emergencyContacts'] == null
        ? null
        : (json['emergencyContacts'] as List<dynamic>)
              .map(
                (e) =>
                    EmergencyContactInput.fromJson(e as Map<String, dynamic>),
              )
              .toList(),
    preferredClinicId: json['preferredClinicId'] as String?,
    relationship: json['relationship'] == null
        ? null
        : RelationshipType.fromJson(json['relationship'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'preferredName': preferredName,
    if (legalName != null) 'legalName': legalName,
    'phone': phone,
    'homeAddress': homeAddress.toJson(),
    if (ageBand != null) 'ageBand': ageBand?.wireName,
    if (preferredLanguage != null) 'preferredLanguage': preferredLanguage,
    if (mobilityNeeds != null)
      'mobilityNeeds': mobilityNeeds?.map((e) => e.wireName).toList(),
    if (mobilityNotes != null) 'mobilityNotes': mobilityNotes,
    if (emergencyContacts != null)
      'emergencyContacts': emergencyContacts?.map((e) => e.toJson()).toList(),
    if (preferredClinicId != null) 'preferredClinicId': preferredClinicId,
    if (relationship != null) 'relationship': relationship?.wireName,
  };
}
