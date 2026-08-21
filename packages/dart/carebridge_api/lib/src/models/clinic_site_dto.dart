// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ClinicSiteDto, from the CareBridge API.
class ClinicSiteDto {
  const ClinicSiteDto({
    required this.id,
    required this.name,
    required this.addressLine,
    required this.timeZone,
  });

  final String id;

  final String name;

  final String addressLine;

  final String timeZone;

  factory ClinicSiteDto.fromJson(Map<String, dynamic> json) => ClinicSiteDto(
    id: json['id'] as String,
    name: json['name'] as String,
    addressLine: json['addressLine'] as String,
    timeZone: json['timeZone'] as String,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'addressLine': addressLine,
    'timeZone': timeZone,
  };
}
