// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverProfileDto, from the CareBridge API.
class DriverProfileDto {
  const DriverProfileDto({
    required this.driverId,
    required this.organizationId,
    required this.organizationName,
    required this.displayName,
    required this.status,
    required this.onShift,
    required this.vehicle,
    required this.canWork,
    this.suspensionReason,
  });

  final String driverId;

  final String organizationId;

  /// Shown in the app so a driver working for two companies can tell at a
  /// glance which one is dispatching them.
  final String organizationName;

  final String displayName;

  final DriverStatus status;

  final bool onShift;

  final VehicleDto vehicle;

  /// Whether this driver may go on shift at all. False until the operator has
  /// approved them, and false again the moment they are suspended.
  final bool canWork;

  /// Why the operator stopped them. Shown to the driver: being locked out of
  /// your own job with no reason given is how support queues fill up.
  final String? suspensionReason;

  factory DriverProfileDto.fromJson(Map<String, dynamic> json) =>
      DriverProfileDto(
        driverId: json['driverId'] as String,
        organizationId: json['organizationId'] as String,
        organizationName: json['organizationName'] as String,
        displayName: json['displayName'] as String,
        status: DriverStatus.fromJson(json['status'] as String),
        onShift: json['onShift'] as bool,
        vehicle: VehicleDto.fromJson(json['vehicle'] as Map<String, dynamic>),
        canWork: json['canWork'] as bool,
        suspensionReason: json['suspensionReason'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'driverId': driverId,
    'organizationId': organizationId,
    'organizationName': organizationName,
    'displayName': displayName,
    'status': status.wireName,
    'onShift': onShift,
    'vehicle': vehicle.toJson(),
    'canWork': canWork,
    if (suspensionReason != null) 'suspensionReason': suspensionReason,
  };
}
