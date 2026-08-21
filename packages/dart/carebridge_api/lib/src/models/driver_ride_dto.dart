// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverRideDto, from the CareBridge API.
class DriverRideDto {
  const DriverRideDto({
    required this.id,
    required this.status,
    required this.scheduledPickupAt,
    required this.direction,
    required this.passengerName,
    this.passengerPhone,
    required this.pickup,
    required this.destination,
    required this.wheelchairRequired,
    required this.assistanceRequired,
    this.notesForDriver,
    required this.isDelayed,
    required this.availableTransitions,
    this.noShowAvailableInSeconds,
    required this.shareLocation,
    this.lastCapturedAt,
  });

  final String id;

  final RideStatus status;

  final DateTime scheduledPickupAt;

  final String direction;

  /// The name to call out at the door. Never a full legal name.
  final String passengerName;

  /// For ringing from the kerb, which is what stops a five-minute wait becoming
  /// a no-show.
  final String? passengerPhone;

  final AddressDto pickup;

  final AddressDto destination;

  final bool wheelchairRequired;

  final bool assistanceRequired;

  final String? notesForDriver;

  final bool isDelayed;

  /// The moves this driver may make right now — the intersection of what the
  /// ride allows and what belongs to the driver. Advisory: the server asserts
  /// it again.
  final List<String> availableTransitions;

  /// Seconds left on the kerbside wait before a no-show may be declared, or
  /// null when a no-show is not on offer at all.
  final int? noShowAvailableInSeconds;

  /// Whether the app should be sampling location for this ride. Derived from
  /// the status by the same rule the write path enforces, so the app is never
  /// asked to send what the server would refuse.
  final bool shareLocation;

  final DateTime? lastCapturedAt;

  factory DriverRideDto.fromJson(Map<String, dynamic> json) => DriverRideDto(
    id: json['id'] as String,
    status: RideStatus.fromJson(json['status'] as String),
    scheduledPickupAt: DateTime.parse(json['scheduledPickupAt'] as String),
    direction: json['direction'] as String,
    passengerName: json['passengerName'] as String,
    passengerPhone: json['passengerPhone'] as String?,
    pickup: AddressDto.fromJson(json['pickup'] as Map<String, dynamic>),
    destination: AddressDto.fromJson(
      json['destination'] as Map<String, dynamic>,
    ),
    wheelchairRequired: json['wheelchairRequired'] as bool,
    assistanceRequired: json['assistanceRequired'] as bool,
    notesForDriver: json['notesForDriver'] as String?,
    isDelayed: json['isDelayed'] as bool,
    availableTransitions: (json['availableTransitions'] as List<dynamic>)
        .map((e) => e as String)
        .toList(),
    noShowAvailableInSeconds: json['noShowAvailableInSeconds'] as int?,
    shareLocation: json['shareLocation'] as bool,
    lastCapturedAt: json['lastCapturedAt'] == null
        ? null
        : DateTime.parse(json['lastCapturedAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'status': status.wireName,
    'scheduledPickupAt': scheduledPickupAt.toIso8601String(),
    'direction': direction,
    'passengerName': passengerName,
    if (passengerPhone != null) 'passengerPhone': passengerPhone,
    'pickup': pickup.toJson(),
    'destination': destination.toJson(),
    'wheelchairRequired': wheelchairRequired,
    'assistanceRequired': assistanceRequired,
    if (notesForDriver != null) 'notesForDriver': notesForDriver,
    'isDelayed': isDelayed,
    'availableTransitions': availableTransitions.map((e) => e).toList(),
    if (noShowAvailableInSeconds != null)
      'noShowAvailableInSeconds': noShowAvailableInSeconds,
    'shareLocation': shareLocation,
    if (lastCapturedAt != null)
      'lastCapturedAt': lastCapturedAt?.toIso8601String(),
  };
}
