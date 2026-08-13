// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ClinicDto, from the CareBridge API.
class ClinicDto {
  const ClinicDto({
    required this.id,
    required this.name,
    required this.phone,
    required this.address,
    this.entranceNotes,
    this.operatingNotes,
  });

  final String id;

  final String name;

  final String phone;

  final AddressDto address;

  final String? entranceNotes;

  final String? operatingNotes;

  factory ClinicDto.fromJson(Map<String, dynamic> json) => ClinicDto(
    id: json['id'] as String,
    name: json['name'] as String,
    phone: json['phone'] as String,
    address: AddressDto.fromJson(json['address'] as Map<String, dynamic>),
    entranceNotes: json['entranceNotes'] as String?,
    operatingNotes: json['operatingNotes'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'phone': phone,
    'address': address.toJson(),
    if (entranceNotes != null) 'entranceNotes': entranceNotes,
    if (operatingNotes != null) 'operatingNotes': operatingNotes,
  };
}
