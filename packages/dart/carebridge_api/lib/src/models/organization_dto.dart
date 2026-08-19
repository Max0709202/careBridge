// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// OrganizationDto, from the CareBridge API.
class OrganizationDto {
  const OrganizationDto({
    required this.id,
    required this.name,
    required this.slug,
    required this.kind,
    required this.timeZone,
    required this.role,
  });

  final String id;

  final String name;

  final String slug;

  final String kind;

  final String timeZone;

  /// The caller's role in this organisation.
  final OrgRole role;

  factory OrganizationDto.fromJson(Map<String, dynamic> json) =>
      OrganizationDto(
        id: json['id'] as String,
        name: json['name'] as String,
        slug: json['slug'] as String,
        kind: json['kind'] as String,
        timeZone: json['timeZone'] as String,
        role: OrgRole.fromJson(json['role'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'slug': slug,
    'kind': kind,
    'timeZone': timeZone,
    'role': role.wireName,
  };
}
