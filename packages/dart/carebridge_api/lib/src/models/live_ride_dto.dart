// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// LiveRideDto, from the CareBridge API.
class LiveRideDto {
  const LiveRideDto({
    required this.rideId,
    required this.status,
    required this.driverId,
    required this.driverName,
    required this.patientName,
    required this.scheduledPickupAt,
    this.pickup,
    this.destination,
    this.position,
    this.etaMinutes,
    required this.isDelayed,
    this.route,
  });

  final String rideId;

  final String status;

  final String driverId;

  final String driverName;

  final String patientName;

  final DateTime scheduledPickupAt;

  /// Null when the address was never located.
  final CoordinatesDto? pickup;

  /// Null when the address was never located.
  final CoordinatesDto? destination;

  /// The car's last reported position. Null before the driver sets off, after
  /// tracking ends, or once the last report is older than the tracking cut-off
  /// — never a stale position presented as current. Live updates arrive on the
  /// tracking socket.
  final LivePositionDto? position;

  final int? etaMinutes;

  final bool isDelayed;

  /// The road the ETA was last computed along, from where the car was then to
  /// the stop it is heading for. Null when there is no live position, no
  /// countdown, or the routing provider offered no road — draw a plain guide
  /// line, never a guessed route.
  final LiveRouteDto? route;

  factory LiveRideDto.fromJson(Map<String, dynamic> json) => LiveRideDto(
    rideId: json['rideId'] as String,
    status: json['status'] as String,
    driverId: json['driverId'] as String,
    driverName: json['driverName'] as String,
    patientName: json['patientName'] as String,
    scheduledPickupAt: DateTime.parse(json['scheduledPickupAt'] as String),
    pickup: json['pickup'] == null
        ? null
        : CoordinatesDto.fromJson(json['pickup'] as Map<String, dynamic>),
    destination: json['destination'] == null
        ? null
        : CoordinatesDto.fromJson(json['destination'] as Map<String, dynamic>),
    position: json['position'] == null
        ? null
        : LivePositionDto.fromJson(json['position'] as Map<String, dynamic>),
    etaMinutes: json['etaMinutes'] as int?,
    isDelayed: json['isDelayed'] as bool,
    route: json['route'] == null
        ? null
        : LiveRouteDto.fromJson(json['route'] as Map<String, dynamic>),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'rideId': rideId,
    'status': status,
    'driverId': driverId,
    'driverName': driverName,
    'patientName': patientName,
    'scheduledPickupAt': scheduledPickupAt.toIso8601String(),
    if (pickup != null) 'pickup': pickup?.toJson(),
    if (destination != null) 'destination': destination?.toJson(),
    if (position != null) 'position': position?.toJson(),
    if (etaMinutes != null) 'etaMinutes': etaMinutes,
    'isDelayed': isDelayed,
    if (route != null) 'route': route?.toJson(),
  };
}
