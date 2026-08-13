// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CreateInvitationDto, from the CareBridge API.
class CreateInvitationDto {
  const CreateInvitationDto({
    required this.email,
    required this.relationship,
    required this.permissions,
  });

  /// The invitation is bound to this address: it can only be accepted by an
  /// account signed in as this address, with the address verified.
  final String email;

  final RelationshipType relationship;

  /// Must include viewProfile, and may not exceed what the inviter holds —
  /// nobody hands out more access than they have.
  final List<FamilyPermission> permissions;

  factory CreateInvitationDto.fromJson(Map<String, dynamic> json) =>
      CreateInvitationDto(
        email: json['email'] as String,
        relationship: RelationshipType.fromJson(json['relationship'] as String),
        permissions: (json['permissions'] as List<dynamic>)
            .map((e) => FamilyPermission.fromJson(e as String))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'email': email,
    'relationship': relationship.wireName,
    'permissions': permissions.map((e) => e.wireName).toList(),
  };
}
