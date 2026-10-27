// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CoordinatesInput, from the CareBridge API.
class CoordinatesInput {
  const CoordinatesInput({required this.latitude, required this.longitude});

  final double latitude;

  final double longitude;

  factory CoordinatesInput.fromJson(Map<String, dynamic> json) =>
      CoordinatesInput(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'latitude': latitude,
    'longitude': longitude,
  };
}
