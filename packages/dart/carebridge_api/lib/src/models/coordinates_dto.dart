// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CoordinatesDto, from the CareBridge API.
class CoordinatesDto {
  const CoordinatesDto({required this.latitude, required this.longitude});

  final double latitude;

  final double longitude;

  factory CoordinatesDto.fromJson(Map<String, dynamic> json) => CoordinatesDto(
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'latitude': latitude,
    'longitude': longitude,
  };
}
