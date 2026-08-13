// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SetPermissionsDto, from the CareBridge API.
class SetPermissionsDto {
  const SetPermissionsDto({required this.permissions});

  final List<FamilyPermission> permissions;

  factory SetPermissionsDto.fromJson(Map<String, dynamic> json) =>
      SetPermissionsDto(
        permissions: (json['permissions'] as List<dynamic>)
            .map((e) => FamilyPermission.fromJson(e as String))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'permissions': permissions.map((e) => e.wireName).toList(),
  };
}
