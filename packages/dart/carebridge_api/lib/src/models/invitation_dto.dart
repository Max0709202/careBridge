// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// InvitationDto, from the CareBridge API.
class InvitationDto {
  const InvitationDto({
    required this.id,
    required this.patientId,
    required this.emailHint,
    required this.relationship,
    required this.permissions,
    required this.createdAt,
    required this.expiresAt,
    required this.status,
  });

  final String id;

  final String patientId;

  /// Masked. Enough for the invitee to recognise their own address; not enough
  /// for the rest of the circle to harvest one.
  final String emailHint;

  final RelationshipType relationship;

  final List<FamilyPermission> permissions;

  final DateTime createdAt;

  final DateTime expiresAt;

  final InvitationStatus status;

  factory InvitationDto.fromJson(Map<String, dynamic> json) => InvitationDto(
    id: json['id'] as String,
    patientId: json['patientId'] as String,
    emailHint: json['emailHint'] as String,
    relationship: RelationshipType.fromJson(json['relationship'] as String),
    permissions: (json['permissions'] as List<dynamic>)
        .map((e) => FamilyPermission.fromJson(e as String))
        .toList(),
    createdAt: DateTime.parse(json['createdAt'] as String),
    expiresAt: DateTime.parse(json['expiresAt'] as String),
    status: InvitationStatus.fromJson(json['status'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'patientId': patientId,
    'emailHint': emailHint,
    'relationship': relationship.wireName,
    'permissions': permissions.map((e) => e.wireName).toList(),
    'createdAt': createdAt.toIso8601String(),
    'expiresAt': expiresAt.toIso8601String(),
    'status': status.wireName,
  };
}
