// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ServiceAreaDto, from the CareBridge API.
class ServiceAreaDto {
  const ServiceAreaDto({
    required this.kind,
    this.center,
    this.radiusMiles,
    this.points,
  });

  final ServiceAreaKind kind;

  final CoordinatesDto? center;

  final double? radiusMiles;

  final List<CoordinatesDto>? points;

  factory ServiceAreaDto.fromJson(Map<String, dynamic> json) => ServiceAreaDto(
    kind: ServiceAreaKind.fromJson(json['kind'] as String),
    center: json['center'] == null
        ? null
        : CoordinatesDto.fromJson(json['center'] as Map<String, dynamic>),
    radiusMiles: json['radiusMiles'] == null
        ? null
        : (json['radiusMiles'] as num).toDouble(),
    points: json['points'] == null
        ? null
        : (json['points'] as List<dynamic>)
              .map((e) => CoordinatesDto.fromJson(e as Map<String, dynamic>))
              .toList(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'kind': kind.wireName,
    if (center != null) 'center': center?.toJson(),
    if (radiusMiles != null) 'radiusMiles': radiusMiles,
    if (points != null) 'points': points?.map((e) => e.toJson()).toList(),
  };
}
