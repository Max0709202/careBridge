// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverDto, from the CareBridge API.
class DriverDto {
  const DriverDto({
    required this.id,
    required this.displayName,
    required this.rating,
    required this.yearsDriving,
    required this.vehicle,
  });

  final String id;

  /// First name and last initial only. The family needs to recognise the person
  /// at the kerb, not to be able to look them up.
  final String displayName;

  final double rating;

  final int yearsDriving;

  final VehicleDto vehicle;

  factory DriverDto.fromJson(Map<String, dynamic> json) => DriverDto(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    rating: (json['rating'] as num).toDouble(),
    yearsDriving: json['yearsDriving'] as int,
    vehicle: VehicleDto.fromJson(json['vehicle'] as Map<String, dynamic>),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'displayName': displayName,
    'rating': rating,
    'yearsDriving': yearsDriving,
    'vehicle': vehicle.toJson(),
  };
}
