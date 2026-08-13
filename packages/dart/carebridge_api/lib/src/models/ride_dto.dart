// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// RideDto, from the CareBridge API.
class RideDto {
  const RideDto({
    required this.id,
    required this.patientId,
    this.appointmentId,
    this.roundTripGroupId,
    required this.direction,
    required this.pickup,
    required this.destination,
    required this.scheduledPickupAt,
    required this.flexibleReturn,
    required this.status,
    required this.wheelchairRequired,
    required this.assistanceRequired,
    this.notesForDriver,
    this.driver,
    required this.estimate,
    required this.isDelayed,
    this.delayReason,
    this.cancellationReason,
    required this.events,
    required this.history,
    this.lastKnownPosition,
    this.etaMinutes,
    required this.createdAt,
    required this.simulationActive,
  });

  final String id;

  final String patientId;

  final String? appointmentId;

  /// A round trip is two rides sharing this id, not one ride with two legs —
  /// each is assigned, tracked, cancelled and priced independently.
  final String? roundTripGroupId;

  final String direction;

  final AddressDto pickup;

  final AddressDto destination;

  final DateTime scheduledPickupAt;

  final bool flexibleReturn;

  final String status;

  final bool wheelchairRequired;

  final bool assistanceRequired;

  final String? notesForDriver;

  final DriverDto? driver;

  final PriceEstimateDto estimate;

  /// A flag rather than a status, so a delay can be raised and cleared without
  /// losing the state the ride must return to.
  final bool isDelayed;

  final String? delayReason;

  final String? cancellationReason;

  final List<RideEventDto> events;

  final List<StatusChangeDto> history;

  final TrackingPointDto? lastKnownPosition;

  final int? etaMinutes;

  final DateTime createdAt;

  /// Whether the preview trip runner is currently driving this ride. Removed
  /// when the driver app lands.
  final bool simulationActive;

  factory RideDto.fromJson(Map<String, dynamic> json) => RideDto(
    id: json['id'] as String,
    patientId: json['patientId'] as String,
    appointmentId: json['appointmentId'] as String?,
    roundTripGroupId: json['roundTripGroupId'] as String?,
    direction: json['direction'] as String,
    pickup: AddressDto.fromJson(json['pickup'] as Map<String, dynamic>),
    destination: AddressDto.fromJson(
      json['destination'] as Map<String, dynamic>,
    ),
    scheduledPickupAt: DateTime.parse(json['scheduledPickupAt'] as String),
    flexibleReturn: json['flexibleReturn'] as bool,
    status: json['status'] as String,
    wheelchairRequired: json['wheelchairRequired'] as bool,
    assistanceRequired: json['assistanceRequired'] as bool,
    notesForDriver: json['notesForDriver'] as String?,
    driver: json['driver'] == null
        ? null
        : DriverDto.fromJson(json['driver'] as Map<String, dynamic>),
    estimate: PriceEstimateDto.fromJson(
      json['estimate'] as Map<String, dynamic>,
    ),
    isDelayed: json['isDelayed'] as bool,
    delayReason: json['delayReason'] as String?,
    cancellationReason: json['cancellationReason'] as String?,
    events: (json['events'] as List<dynamic>)
        .map((e) => RideEventDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    history: (json['history'] as List<dynamic>)
        .map((e) => StatusChangeDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    lastKnownPosition: json['lastKnownPosition'] == null
        ? null
        : TrackingPointDto.fromJson(
            json['lastKnownPosition'] as Map<String, dynamic>,
          ),
    etaMinutes: json['etaMinutes'] as int?,
    createdAt: DateTime.parse(json['createdAt'] as String),
    simulationActive: json['simulationActive'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'patientId': patientId,
    if (appointmentId != null) 'appointmentId': appointmentId,
    if (roundTripGroupId != null) 'roundTripGroupId': roundTripGroupId,
    'direction': direction,
    'pickup': pickup.toJson(),
    'destination': destination.toJson(),
    'scheduledPickupAt': scheduledPickupAt.toIso8601String(),
    'flexibleReturn': flexibleReturn,
    'status': status,
    'wheelchairRequired': wheelchairRequired,
    'assistanceRequired': assistanceRequired,
    if (notesForDriver != null) 'notesForDriver': notesForDriver,
    if (driver != null) 'driver': driver?.toJson(),
    'estimate': estimate.toJson(),
    'isDelayed': isDelayed,
    if (delayReason != null) 'delayReason': delayReason,
    if (cancellationReason != null) 'cancellationReason': cancellationReason,
    'events': events.map((e) => e.toJson()).toList(),
    'history': history.map((e) => e.toJson()).toList(),
    if (lastKnownPosition != null)
      'lastKnownPosition': lastKnownPosition?.toJson(),
    if (etaMinutes != null) 'etaMinutes': etaMinutes,
    'createdAt': createdAt.toIso8601String(),
    'simulationActive': simulationActive,
  };
}
