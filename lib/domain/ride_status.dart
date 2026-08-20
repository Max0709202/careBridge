import 'package:carebridge_client/carebridge_client.dart';

/// The lifecycle of a single ride leg.
///
/// A round trip is **two rides** sharing a `roundTripGroupId`, not one ride with
/// two legs: each leg is assigned, tracked, delayed, cancelled and priced
/// independently, and the return leg's pickup time is frequently unknown when
/// the outbound leg is booked.
///
/// Deviation from the original status list, deliberate: `delayed` is **not** a
/// status here. A delay does not replace where a ride is — a driver stuck in
/// traffic on the way to pickup is still `driverEnRoute` — and modelling it as a
/// status loses the state it must return to. Delay is carried on the ride as a
/// flag plus a `RideEvent`, so it can be raised and cleared from any active
/// state without corrupting the machine. See `Ride.isDelayed`.
enum RideStatus {
  draft,
  requested,
  awaitingAssignment,
  assigned,
  driverAccepted,
  driverEnRoute,
  driverArrived,
  passengerOnboard,
  inProgress,
  arrivedAtDestination,
  completed,
  canceled,
  noShow,
  reassignmentRequired;

  /// Plain-language label. Written for a worried adult child reading it on a
  /// phone, not for an operations console.
  String get label => switch (this) {
    RideStatus.draft => 'Draft',
    RideStatus.requested => 'Requested',
    RideStatus.awaitingAssignment => 'Finding a driver',
    RideStatus.assigned => 'Driver assigned',
    RideStatus.driverAccepted => 'Driver confirmed',
    RideStatus.driverEnRoute => 'Driver on the way',
    RideStatus.driverArrived => 'Driver has arrived',
    RideStatus.passengerOnboard => 'Picked up',
    RideStatus.inProgress => 'On the way to the clinic',
    RideStatus.arrivedAtDestination => 'Arrived at the clinic',
    RideStatus.completed => 'Completed',
    RideStatus.canceled => 'Canceled',
    RideStatus.noShow => 'No show',
    RideStatus.reassignmentRequired => 'Needs a new driver',
  };

  bool get isTerminal =>
      this == RideStatus.completed ||
      this == RideStatus.canceled ||
      this == RideStatus.noShow;

  /// Whether the driver app may share location, and the family app may show it.
  ///
  /// This is the single definition of "tracking is legal right now". The server
  /// re-checks it on every inbound location point; the client uses it to decide
  /// whether to start the location stream at all. Tracking begins when the
  /// driver sets off and ends the moment the ride reaches a terminal state.
  bool get allowsLocationSharing => const {
    RideStatus.driverEnRoute,
    RideStatus.driverArrived,
    RideStatus.passengerOnboard,
    RideStatus.inProgress,
    RideStatus.arrivedAtDestination,
  }.contains(this);

  /// Whether the patient is physically in the vehicle. Drives the family app's
  /// most-asked question and the "picked up safely" notification.
  bool get passengerIsOnboard =>
      const {RideStatus.passengerOnboard, RideStatus.inProgress}.contains(this);
}

/// Allowed transitions. Anything not listed here is rejected.
///
/// Cancellation is permitted from every state where the ride is still happening
/// — including after pickup, because the reasons for stopping one are rarely
/// convenient. The single exception is `arrivedAtDestination`: the passenger has
/// already been delivered, so there is nothing left to call off and the only
/// move is to complete.
const Map<RideStatus, Set<RideStatus>> _allowed = {
  RideStatus.draft: {RideStatus.requested, RideStatus.canceled},
  RideStatus.requested: {RideStatus.awaitingAssignment, RideStatus.canceled},
  RideStatus.awaitingAssignment: {
    RideStatus.assigned,
    RideStatus.reassignmentRequired,
    RideStatus.canceled,
  },
  RideStatus.assigned: {
    RideStatus.driverAccepted,
    RideStatus.reassignmentRequired,
    RideStatus.canceled,
  },
  RideStatus.driverAccepted: {
    RideStatus.driverEnRoute,
    RideStatus.reassignmentRequired,
    RideStatus.canceled,
  },
  RideStatus.driverEnRoute: {
    RideStatus.driverArrived,
    RideStatus.reassignmentRequired,
    RideStatus.canceled,
  },
  RideStatus.driverArrived: {
    RideStatus.passengerOnboard,
    RideStatus.noShow,
    RideStatus.canceled,
  },
  RideStatus.passengerOnboard: {RideStatus.inProgress, RideStatus.canceled},
  RideStatus.inProgress: {RideStatus.arrivedAtDestination, RideStatus.canceled},
  RideStatus.arrivedAtDestination: {RideStatus.completed},
  RideStatus.reassignmentRequired: {RideStatus.assigned, RideStatus.canceled},
  RideStatus.completed: {},
  RideStatus.canceled: {},
  RideStatus.noShow: {},
};

bool canTransitionRide(RideStatus from, RideStatus to) =>
    _allowed[from]?.contains(to) ?? false;

Set<RideStatus> allowedRideTransitions(RideStatus from) =>
    _allowed[from] ?? const {};

/// Throws [InvalidTransitionFailure] unless the transition is legal.
///
/// Every ride status change in the app funnels through here. Reaching it with an
/// illegal transition means a control was offered that should have been hidden
/// or disabled — a UI bug, surfaced loudly rather than silently persisted.
void assertRideTransition(RideStatus from, RideStatus to) {
  if (!canTransitionRide(from, to)) {
    throw InvalidTransitionFailure(from.name, to.name);
  }
}
