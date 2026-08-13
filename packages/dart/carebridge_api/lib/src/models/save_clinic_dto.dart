// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SaveClinicDto, from the CareBridge API.
class SaveClinicDto {
  const SaveClinicDto({
    required this.name,
    required this.phone,
    required this.address,
    this.timeZone,
  });

  final String name;

  final String phone;

  final AddressInput address;

  final String? timeZone;

  factory SaveClinicDto.fromJson(Map<String, dynamic> json) => SaveClinicDto(
    name: json['name'] as String,
    phone: json['phone'] as String,
    address: AddressInput.fromJson(json['address'] as Map<String, dynamic>),
    timeZone: json['timeZone'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'name': name,
    'phone': phone,
    'address': address.toJson(),
    if (timeZone != null) 'timeZone': timeZone,
  };
}
