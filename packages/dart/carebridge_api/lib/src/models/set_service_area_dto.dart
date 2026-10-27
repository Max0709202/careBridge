// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SetServiceAreaDto, from the CareBridge API.
class SetServiceAreaDto {
  const SetServiceAreaDto({
    required this.kind,
    this.center,
    this.radiusMiles,
    this.points,
  });

  final ServiceAreaKind kind;

  /// Required for `radius`: the point the radius is measured from.
  final CoordinatesInput? center;

  /// Required for `radius`. Straight-line miles, not road miles.
  final double? radiusMiles;

  /// Required for `polygon`: the outline, 3 to 500 points, not closed (the last
  /// point joins the first).
  final List<CoordinatesInput>? points;

  factory SetServiceAreaDto.fromJson(Map<String, dynamic> json) =>
      SetServiceAreaDto(
        kind: ServiceAreaKind.fromJson(json['kind'] as String),
        center: json['center'] == null
            ? null
            : CoordinatesInput.fromJson(json['center'] as Map<String, dynamic>),
        radiusMiles: json['radiusMiles'] == null
            ? null
            : (json['radiusMiles'] as num).toDouble(),
        points: json['points'] == null
            ? null
            : (json['points'] as List<dynamic>)
                  .map(
                    (e) => CoordinatesInput.fromJson(e as Map<String, dynamic>),
                  )
                  .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'kind': kind.wireName,
    if (center != null) 'center': center?.toJson(),
    if (radiusMiles != null) 'radiusMiles': radiusMiles,
    if (points != null) 'points': points?.map((e) => e.toJson()).toList(),
  };
}
