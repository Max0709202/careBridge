// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// EmergencyContactDto, from the CareBridge API.
class EmergencyContactDto {
  const EmergencyContactDto({
    required this.id,
    required this.name,
    required this.relationship,
    required this.phone,
    required this.isPrimary,
  });

  final String id;

  final String name;

  final String relationship;

  final String phone;

  final bool isPrimary;

  factory EmergencyContactDto.fromJson(Map<String, dynamic> json) =>
      EmergencyContactDto(
        id: json['id'] as String,
        name: json['name'] as String,
        relationship: json['relationship'] as String,
        phone: json['phone'] as String,
        isPrimary: json['isPrimary'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'relationship': relationship,
    'phone': phone,
    'isPrimary': isPrimary,
  };
}
