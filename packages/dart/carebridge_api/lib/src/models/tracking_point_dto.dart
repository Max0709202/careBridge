// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// TrackingPointDto, from the CareBridge API.
class TrackingPointDto {
  const TrackingPointDto({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.capturedAt,
  });

  final double latitude;

  final double longitude;

  final double accuracyMeters;

  /// When the device took the reading. Every freshness label ages against this
  /// and never against when the server received it — a stale position rendered
  /// as a confident moving car manufactures false certainty about a vulnerable
  /// person.
  final DateTime capturedAt;

  factory TrackingPointDto.fromJson(Map<String, dynamic> json) =>
      TrackingPointDto(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        accuracyMeters: (json['accuracyMeters'] as num).toDouble(),
        capturedAt: DateTime.parse(json['capturedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'latitude': latitude,
    'longitude': longitude,
    'accuracyMeters': accuracyMeters,
    'capturedAt': capturedAt.toIso8601String(),
  };
}
