import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../domain/dispatch.dart';
import '../domain/models.dart';

/// Wire → domain.
///
/// Kept out of `lib/domain/` because the domain must not know the wire exists:
/// the moment it imports a generated DTO it stops being a model of the rules
/// and becomes a model of one API version.
///
/// The handling of unrecognised enum values differs by field, and the
/// difference is deliberate rather than inconsistent — see each note below.

Organization? organizationFromWire(wire.OrganizationDto dto) => Organization(
  id: dto.id,
  name: dto.name,
  slug: dto.slug,
  timeZone: dto.timeZone,
  role: dto.role.wireName,
);

Vehicle vehicleFromWire(wire.VehicleDto dto) => Vehicle(
  id: dto.id,
  make: dto.make,
  model: dto.model,
  color: dto.color,
  licensePlate: dto.licensePlate,
  isWheelchairAccessible: dto.isWheelchairAccessible,
);

/// A driver, or null if the server reports a status this build does not know.
///
/// Dropped rather than guessed. Every control on the roster is gated on the
/// status — which transitions are offered, whether the driver may be assigned,
/// whether they occupy a billable seat — and defaulting an unknown status to
/// something plausible would offer a control the server then refuses, or worse,
/// present an unapproved driver as assignable.
Driver? driverFromWire(wire.DriverDto dto) {
  final status = DriverStatus.tryParse(dto.status.wireName);
  if (status == null) return null;

  return Driver(
    id: dto.id,
    displayName: dto.displayName,
    status: status,
    onShift: dto.onShift,
    rating: dto.rating,
    yearsDriving: dto.yearsDriving,
    vehicle: vehicleFromWire(dto.vehicle),
    occupiesSeat: dto.occupiesSeat,
    activeRideCount: dto.activeRideCount,
    approvedAt: dto.approvedAt,
    suspensionReason: dto.suspensionReason,
  );
}

/// A candidate, with every reason it cannot take the trip.
///
/// Unrecognised reasons are **kept** here, which is the opposite of the driver
/// rule above and for a consistent underlying reason: in both cases the
/// unknown value must not make the driver look *more* available than they are.
/// A dropped status could do that; a dropped reason certainly would, because
/// `eligible` is the server's answer and the reasons only explain it.
Candidate candidateFromWire(wire.DispatchCandidateDto dto) {
  final known = <IneligibilityReason>[];
  final unknown = <String>[];

  for (final raw in dto.reasons) {
    final reason = IneligibilityReason.tryParse(raw);
    if (reason == null) {
      unknown.add(raw);
    } else {
      known.add(reason);
    }
  }

  return Candidate(
    driverId: dto.driverId,
    displayName: dto.displayName,
    eligible: dto.eligible,
    reasons: known,
    unrecognisedReasons: unknown,
  );
}

/// A queue item, or null on an urgency this build does not recognise.
///
/// Dropped, because urgency is what the queue is ordered and coloured by. A
/// row with an invented band would sort into the wrong place, and the wrong
/// place for an overdue ride is below the ones that are merely upcoming.
QueueItem? queueItemFromWire(wire.DispatchQueueItemDto dto) {
  final urgency = DispatchUrgency.tryParse(dto.urgency.wireName);
  if (urgency == null) return null;

  return QueueItem(
    rideId: dto.rideId,
    status: dto.status,
    patientName: dto.patientName,
    pickupLine: dto.pickupLine,
    destinationLine: dto.destinationLine,
    scheduledPickupAt: dto.scheduledPickupAt,
    wheelchairRequired: dto.wheelchairRequired,
    assistanceRequired: dto.assistanceRequired,
    urgency: urgency,
    candidates: dto.candidates.map(candidateFromWire).toList(),
  );
}

DispatchQueue queueFromWire(wire.DispatchQueueDto dto) => DispatchQueue(
  organizationId: dto.organizationId,
  items: dto.items.map(queueItemFromWire).nonNulls.toList(),
  availableDrivers: dto.availableDrivers,
);

SeatSummary seatsFromWire(wire.OrganizationSeatsDto dto) => SeatSummary(
  organizationId: dto.organizationId,
  activeDrivers: dto.activeDrivers,
  billedSeats: dto.billedSeats,
  renewalTotalCents: dto.renewalQuote?.totalCents,
  ledger: [
    for (final entry in dto.ledger)
      SeatLedgerEntry(
        id: entry.id,
        driverDisplayName: entry.driverDisplayName,
        change: entry.change.wireName,
        at: entry.at,
        seatsAfter: entry.seatsAfter,
        prorationCents: entry.prorationCents,
      ),
  ],
);
