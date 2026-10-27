// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// LiveRouteDto, from the CareBridge API.
class LiveRouteDto {
  const LiveRouteDto({required this.target, required this.path});

  final RouteTarget target;

  final List<CoordinatesDto> path;

  factory LiveRouteDto.fromJson(Map<String, dynamic> json) => LiveRouteDto(
    target: RouteTarget.fromJson(json['target'] as String),
    path: (json['path'] as List<dynamic>)
        .map((e) => CoordinatesDto.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'target': target.wireName,
    'path': path.map((e) => e.toJson()).toList(),
  };
}
