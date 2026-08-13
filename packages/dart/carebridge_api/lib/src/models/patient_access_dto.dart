// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// PatientAccessDto, from the CareBridge API.
class PatientAccessDto {
  const PatientAccessDto({
    required this.userId,
    required this.patientId,
    required this.relationship,
    required this.permissions,
    required this.grantedAt,
    this.grantedByUserId,
    this.revokedAt,
  });

  final String userId;

  final String patientId;

  final String relationship;

  final List<String> permissions;

  final DateTime grantedAt;

  /// Null marks the organiser who created the patient record. They keep
  /// manageAccess unconditionally, or a family could lock itself out of its own
  /// patient.
  final String? grantedByUserId;

  final DateTime? revokedAt;

  factory PatientAccessDto.fromJson(Map<String, dynamic> json) =>
      PatientAccessDto(
        userId: json['userId'] as String,
        patientId: json['patientId'] as String,
        relationship: json['relationship'] as String,
        permissions: (json['permissions'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        grantedAt: DateTime.parse(json['grantedAt'] as String),
        grantedByUserId: json['grantedByUserId'] as String?,
        revokedAt: json['revokedAt'] == null
            ? null
            : DateTime.parse(json['revokedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'patientId': patientId,
    'relationship': relationship,
    'permissions': permissions.map((e) => e).toList(),
    'grantedAt': grantedAt.toIso8601String(),
    if (grantedByUserId != null) 'grantedByUserId': grantedByUserId,
    if (revokedAt != null) 'revokedAt': revokedAt?.toIso8601String(),
  };
}
