// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ReportLocationDto, from the CareBridge API.
class ReportLocationDto {
  const ReportLocationDto({
    required this.latitude,
    required this.longitude,
    this.accuracyMeters,
    required this.capturedAt,
    this.etaMinutes,
  });

  final double latitude;

  final double longitude;

  final double? accuracyMeters;

  /// When the **device** took the reading, not when the server received it.
  /// Every freshness label ages against this, so the server judges it before
  /// storing.
  final DateTime capturedAt;

  final double? etaMinutes;

  factory ReportLocationDto.fromJson(Map<String, dynamic> json) =>
      ReportLocationDto(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        accuracyMeters: json['accuracyMeters'] == null
            ? null
            : (json['accuracyMeters'] as num).toDouble(),
        capturedAt: DateTime.parse(json['capturedAt'] as String),
        etaMinutes: json['etaMinutes'] == null
            ? null
            : (json['etaMinutes'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'latitude': latitude,
    'longitude': longitude,
    if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
    'capturedAt': capturedAt.toIso8601String(),
    if (etaMinutes != null) 'etaMinutes': etaMinutes,
  };
}
