// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// OrganizationServiceAreaDto, from the CareBridge API.
class OrganizationServiceAreaDto {
  const OrganizationServiceAreaDto({
    required this.organizationId,
    this.serviceArea,
    this.updatedAt,
  });

  final String organizationId;

  /// Null until the operator sets one; nothing is flagged until then.
  final ServiceAreaDto? serviceArea;

  final DateTime? updatedAt;

  factory OrganizationServiceAreaDto.fromJson(Map<String, dynamic> json) =>
      OrganizationServiceAreaDto(
        organizationId: json['organizationId'] as String,
        serviceArea: json['serviceArea'] == null
            ? null
            : ServiceAreaDto.fromJson(
                json['serviceArea'] as Map<String, dynamic>,
              ),
        updatedAt: json['updatedAt'] == null
            ? null
            : DateTime.parse(json['updatedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'organizationId': organizationId,
    if (serviceArea != null) 'serviceArea': serviceArea?.toJson(),
    if (updatedAt != null) 'updatedAt': updatedAt?.toIso8601String(),
  };
}
