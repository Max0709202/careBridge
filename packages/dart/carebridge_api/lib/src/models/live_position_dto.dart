// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// LivePositionDto, from the CareBridge API.
class LivePositionDto {
  const LivePositionDto({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.capturedAt,
  });

  final double latitude;

  final double longitude;

  final double accuracyMeters;

  /// When the device took the reading — age is measured from this.
  final DateTime capturedAt;

  factory LivePositionDto.fromJson(Map<String, dynamic> json) =>
      LivePositionDto(
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
