// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// EmergencyContactInput, from the CareBridge API.
class EmergencyContactInput {
  const EmergencyContactInput({
    required this.name,
    required this.relationship,
    required this.phone,
    this.isPrimary,
  });

  final String name;

  final String relationship;

  final String phone;

  final bool? isPrimary;

  factory EmergencyContactInput.fromJson(Map<String, dynamic> json) =>
      EmergencyContactInput(
        name: json['name'] as String,
        relationship: json['relationship'] as String,
        phone: json['phone'] as String,
        isPrimary: json['isPrimary'] as bool?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'name': name,
    'relationship': relationship,
    'phone': phone,
    if (isPrimary != null) 'isPrimary': isPrimary,
  };
}
