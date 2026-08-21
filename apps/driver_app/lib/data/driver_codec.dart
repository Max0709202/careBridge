import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../domain/models.dart';
import '../domain/ride_status.dart';

/// Wire types in, domain types out.
///
/// The rule throughout is that an unknown value must not crash a driver's
/// screen mid-shift. A status this build has never heard of means the server
/// is ahead of the app, which happens for real between a deploy and a store
/// review — so an unrecognised transition is **dropped** (offering a button
/// this build cannot honour is worse than offering none), while an
/// unrecognised ride status makes the job unusable and the job is dropped
/// whole.
Vehicle vehicleFromWire(wire.VehicleDto dto) => Vehicle(
  make: dto.make,
  model: dto.model,
  color: dto.color,
  licensePlate: dto.licensePlate,
  isWheelchairAccessible: dto.isWheelchairAccessible,
);

DriverProfile profileFromWire(wire.DriverProfileDto dto) => DriverProfile(
  driverId: dto.driverId,
  organizationName: dto.organizationName,
  displayName: dto.displayName,
  status: dto.status.name,
  onShift: dto.onShift,
  canWork: dto.canWork,
  vehicle: vehicleFromWire(dto.vehicle),
  suspensionReason: dto.suspensionReason,
);

Place placeFromWire(wire.AddressDto dto) => Place(
  label: dto.label,
  line1: dto.line1,
  line2: dto.line2,
  city: dto.city,
  state: dto.state,
  postalCode: dto.postalCode,
  accessNotes: dto.accessNotes,
);

Job? jobFromWire(wire.DriverRideDto dto) {
  final status = RideStatus.tryParse(dto.status.name);
  if (status == null) return null;

  return Job(
    id: dto.id,
    status: status,
    scheduledPickupAt: dto.scheduledPickupAt.toLocal(),
    passengerName: dto.passengerName,
    passengerPhone: dto.passengerPhone,
    pickup: placeFromWire(dto.pickup),
    destination: placeFromWire(dto.destination),
    wheelchairRequired: dto.wheelchairRequired,
    assistanceRequired: dto.assistanceRequired,
    notesForDriver: dto.notesForDriver,
    isDelayed: dto.isDelayed,
    availableTransitions: dto.availableTransitions
        .map(RideStatus.tryParse)
        .nonNulls
        .toList(growable: false),
    noShowAvailableInSeconds: dto.noShowAvailableInSeconds,
  );
}
