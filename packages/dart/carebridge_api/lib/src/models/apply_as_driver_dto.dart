// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ApplyAsDriverDto, from the CareBridge API.
class ApplyAsDriverDto {
  const ApplyAsDriverDto({
    required this.joinCode,
    required this.phone,
    required this.yearsDriving,
    required this.vehicle,
  });

  /// The operator's join code, from the ops console. Case, spaces and hyphens
  /// do not matter.
  final String joinCode;

  final String phone;

  final double yearsDriving;

  /// The vehicle they will drive. Joins the operator's fleet.
  final CreateVehicleDto vehicle;

  factory ApplyAsDriverDto.fromJson(Map<String, dynamic> json) =>
      ApplyAsDriverDto(
        joinCode: json['joinCode'] as String,
        phone: json['phone'] as String,
        yearsDriving: (json['yearsDriving'] as num).toDouble(),
        vehicle: CreateVehicleDto.fromJson(
          json['vehicle'] as Map<String, dynamic>,
        ),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'joinCode': joinCode,
    'phone': phone,
    'yearsDriving': yearsDriving,
    'vehicle': vehicle.toJson(),
  };
}
