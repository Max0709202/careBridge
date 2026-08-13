// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AddressInput, from the CareBridge API.
class AddressInput {
  const AddressInput({
    required this.label,
    required this.line1,
    this.line2,
    required this.city,
    required this.state,
    required this.postalCode,
    this.accessNotes,
    this.latitude,
    this.longitude,
  });

  final String label;

  final String line1;

  final String? line2;

  final String city;

  final String state;

  final String postalCode;

  final String? accessNotes;

  /// Supply a pin only when the client already has a good one — a dragged
  /// marker or an autocomplete pick. Supplying it suppresses server-side
  /// geocoding, which is the point: re-geocoding would silently move a marker
  /// the user set.
  final double? latitude;

  final double? longitude;

  factory AddressInput.fromJson(Map<String, dynamic> json) => AddressInput(
    label: json['label'] as String,
    line1: json['line1'] as String,
    line2: json['line2'] as String?,
    city: json['city'] as String,
    state: json['state'] as String,
    postalCode: json['postalCode'] as String,
    accessNotes: json['accessNotes'] as String?,
    latitude: json['latitude'] == null
        ? null
        : (json['latitude'] as num).toDouble(),
    longitude: json['longitude'] == null
        ? null
        : (json['longitude'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'label': label,
    'line1': line1,
    if (line2 != null) 'line2': line2,
    'city': city,
    'state': state,
    'postalCode': postalCode,
    if (accessNotes != null) 'accessNotes': accessNotes,
    if (latitude != null) 'latitude': latitude,
    if (longitude != null) 'longitude': longitude,
  };
}
