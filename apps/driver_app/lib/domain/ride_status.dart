/// The lifecycle of a ride, from the driver's side.
///
/// Mirrors apps/api/src/domain/ride-status.ts, and carries the driver's labels
/// rather than the family's. The same state reads differently depending on who
/// is looking at it: `driverArrived` is "Driver has arrived" to a daughter
/// watching a map, and "You are at the pickup" to the person in the car.
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

  /// What the driver is being asked to confirm has happened.
  String get driverLabel => switch (this) {
    RideStatus.assigned => 'Offered to you',
    RideStatus.driverAccepted => 'Accepted',
    RideStatus.driverEnRoute => 'Driving to pickup',
    RideStatus.driverArrived => 'At the pickup',
    RideStatus.passengerOnboard => 'Passenger on board',
    RideStatus.inProgress => 'Driving to the clinic',
    RideStatus.arrivedAtDestination => 'At the clinic',
    RideStatus.completed => 'Finished',
    RideStatus.noShow => 'No show',
    RideStatus.canceled => 'Cancelled',
    RideStatus.reassignmentRequired => 'Returned to dispatch',
    RideStatus.draft ||
    RideStatus.requested ||
    RideStatus.awaitingAssignment => 'Not yet dispatched',
  };

  /// The words on the button that produces this state.
  ///
  /// Written as the thing the driver did, not as a state name. "I have
  /// arrived" is answerable while stopping the car; "driverArrived" is not.
  String get actionLabel => switch (this) {
    RideStatus.driverAccepted => 'Accept this ride',
    RideStatus.driverEnRoute => 'Start driving',
    RideStatus.driverArrived => 'I have arrived',
    RideStatus.passengerOnboard => 'Passenger is in the car',
    RideStatus.inProgress => 'Set off for the clinic',
    RideStatus.arrivedAtDestination => 'We have arrived',
    RideStatus.completed => 'Finish the ride',
    RideStatus.noShow => 'Nobody came out',
    _ => 'Continue',
  };

  static RideStatus? tryParse(String? raw) {
    for (final status in RideStatus.values) {
      if (status.name == raw) return status;
    }
    return null;
  }
}
