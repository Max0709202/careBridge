/// What the console renders, independent of the wire.
///
/// Kept separate from the generated DTOs for the reason the family app keeps
/// its own: the moment a screen imports a generated type it becomes a model of
/// one API version rather than of the thing on screen, and every rename in the
/// contract becomes a change to the widget tree.
///
/// One rule differs from the family side and is worth stating plainly. A
/// dispatcher **is** supposed to see a patient's name, their pickup address
/// and the time they are expected — they are arranging the car, and none of
/// that is optional to the job. What they never see is anything clinical,
/// because nothing clinical is stored; and what they never see is a patient
/// belonging to nobody they dispatch for, which the queue query enforces
/// before any of this is built.
library;

import 'dispatch.dart';

class Vehicle {
  const Vehicle({
    required this.id,
    required this.make,
    required this.model,
    required this.color,
    required this.licensePlate,
    required this.isWheelchairAccessible,
  });

  final String id;
  final String make;
  final String model;
  final String color;
  final String licensePlate;
  final bool isWheelchairAccessible;

  String get label => '$color $make $model';
}

class Driver {
  const Driver({
    required this.id,
    required this.displayName,
    required this.status,
    required this.onShift,
    required this.rating,
    required this.yearsDriving,
    required this.vehicle,
    required this.occupiesSeat,
    required this.activeRideCount,
    this.approvedAt,
    this.suspensionReason,
  });

  final String id;

  /// First name and last initial. The family needs to recognise the person at
  /// the kerb, not to be able to look them up — so no full legal name exists
  /// in this system to display.
  final String displayName;

  final DriverStatus status;

  /// Working right now. Deliberately separate from [status], which is whether
  /// the company has said this person may carry a passenger at all — one
  /// changes several times a day and the other is a standing decision.
  final bool onShift;

  final double rating;
  final int yearsDriving;
  final Vehicle vehicle;
  final bool occupiesSeat;
  final int activeRideCount;
  final DateTime? approvedAt;
  final String? suspensionReason;

  bool get isFree => activeRideCount == 0;

  /// Whether this driver could take a trip needing no special vehicle.
  bool get isAvailableNow => status.isAssignable && onShift && isFree;
}

/// A driver considered for one specific ride, with every reason they cannot
/// take it.
class Candidate {
  const Candidate({
    required this.driverId,
    required this.displayName,
    required this.eligible,
    required this.reasons,
    this.unrecognisedReasons = const [],
  });

  final String driverId;
  final String displayName;
  final bool eligible;
  final List<IneligibilityReason> reasons;

  /// Reasons the server sent that this build does not know the name of.
  ///
  /// Carried rather than dropped. An unrecognised reason still means the
  /// driver cannot take the trip, and discarding it would leave a candidate
  /// looking merely unexplained instead of unavailable — so the row would
  /// invite a tap the server then refuses. `eligible` comes from the server
  /// either way; this only decides how honestly the row can explain itself.
  final List<String> unrecognisedReasons;

  /// Every reason, in a form a dispatcher can read.
  List<String> get reasonLabels => [
    for (final reason in reasons) reason.label,
    for (final raw in unrecognisedReasons) raw,
  ];
}

class QueueItem {
  const QueueItem({
    required this.rideId,
    required this.status,
    required this.patientName,
    required this.pickupLine,
    required this.destinationLine,
    required this.scheduledPickupAt,
    required this.wheelchairRequired,
    required this.assistanceRequired,
    required this.urgency,
    required this.candidates,
  });

  final String rideId;
  final String status;
  final String patientName;
  final String pickupLine;
  final String destinationLine;
  final DateTime scheduledPickupAt;
  final bool wheelchairRequired;
  final bool assistanceRequired;
  final DispatchUrgency urgency;
  final List<Candidate> candidates;

  List<Candidate> get eligibleCandidates =>
      candidates.where((candidate) => candidate.eligible).toList();

  bool get hasAnyoneAvailable => eligibleCandidates.isNotEmpty;

  /// Whether this ride is being taken off a driver who already had it.
  ///
  /// A reassignment needs a reason, and the family timeline records that the
  /// first driver dropped it — so the console must not present it as an
  /// ordinary first assignment.
  bool get isReassignment => status == 'reassignmentRequired';
}

class DispatchQueue {
  const DispatchQueue({
    required this.organizationId,
    required this.items,
    required this.availableDrivers,
  });

  final String organizationId;
  final List<QueueItem> items;

  /// Drivers on shift and free right now, across the whole roster.
  final int availableDrivers;

  bool get isEmpty => items.isEmpty;

  /// Rides nobody on the roster can currently take.
  ///
  /// The number a dispatcher acts on first: it is the count of trips that will
  /// not happen unless somebody makes a phone call.
  int get strandedCount =>
      items.where((item) => !item.hasAnyoneAvailable).length;

  int get overdueCount =>
      items.where((item) => item.urgency == DispatchUrgency.overdue).length;
}

/// An organisation the signed-in user holds a role in.
class Organization {
  const Organization({
    required this.id,
    required this.name,
    required this.slug,
    required this.timeZone,
    required this.role,
  });

  final String id;
  final String name;
  final String slug;
  final String timeZone;

  /// `owner`, `admin`, `dispatcher` or `member`.
  final String role;

  /// Whether this role may change a driver's standing or add a vehicle.
  ///
  /// A dispatcher may put somebody on shift — they are the person who knows
  /// who called in sick — but approving a driver moves a billable seat, and
  /// that is an owner's or an admin's decision. Mirrored from
  /// `requireMembership`; the server is what enforces it.
  bool get canAdminister => role == 'owner' || role == 'admin';

  bool get canDispatch => canAdminister || role == 'dispatcher';
}

class SeatSummary {
  const SeatSummary({
    required this.organizationId,
    required this.activeDrivers,
    required this.billedSeats,
    required this.renewalTotalCents,
    required this.ledger,
  });

  final String organizationId;

  /// Drivers on the road right now.
  final int activeDrivers;

  /// Drivers the current subscription is billing for.
  final int billedSeats;

  final int? renewalTotalCents;
  final List<SeatLedgerEntry> ledger;

  /// Drivers approved since the last renewal and not yet billed at renewal.
  ///
  /// Not a discrepancy: a seat granted mid-period is charged immediately by
  /// proration and folded into the recurring amount at renewal. Shown so the
  /// difference between the two numbers is explained on the screen that shows
  /// both, rather than queried later.
  int get pendingAtRenewal => activeDrivers - billedSeats;
}

class SeatLedgerEntry {
  const SeatLedgerEntry({
    required this.id,
    required this.driverDisplayName,
    required this.change,
    required this.at,
    required this.seatsAfter,
    required this.prorationCents,
  });

  final String id;
  final String driverDisplayName;

  /// `granted` or `released`.
  final String change;
  final DateTime at;
  final int seatsAfter;

  /// Charged immediately for the remainder of the period on a grant. Zero on a
  /// release — a released seat stays usable until the period that paid for it
  /// ends, and is not refunded.
  final int prorationCents;

  bool get isGrant => change == 'granted';
}
