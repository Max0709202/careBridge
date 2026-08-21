import 'ride_status.dart';

/// What belongs to the driver, mirrored from
/// apps/api/src/domain/driver-authority.ts.
///
/// This copy **advises**. It decides which button to draw and whether to grey
/// it out; the server decides whether the move happens, and refuses the same
/// things whatever this file says. Both absences below are the point of it:
/// cancellation and reassignment are not the driver's to make, and a build of
/// this app that offered them would produce a button that always fails rather
/// than a permission it does not have.
const driverTransitions = <RideStatus>[
  RideStatus.driverAccepted,
  RideStatus.driverEnRoute,
  RideStatus.driverArrived,
  RideStatus.passengerOnboard,
  RideStatus.inProgress,
  RideStatus.arrivedAtDestination,
  RideStatus.completed,
  RideStatus.noShow,
];

/// How long a driver waits at the kerb before a no-show may be declared.
///
/// Five minutes is the shortest interval in which an eighty-year-old can
/// plausibly get from a sofa to a front door — the case the number exists for,
/// rather than the impatient one. The server enforces it from the ride's own
/// history; this copy is what lets the app show a countdown instead of a
/// button that refuses.
const noShowWait = Duration(minutes: 5);

/// The moves that are legal *and* the driver's, given where the ride is.
List<RideStatus> driverMovesFrom(RideStatus from) => switch (from) {
  RideStatus.assigned => const [RideStatus.driverAccepted],
  RideStatus.driverAccepted => const [RideStatus.driverEnRoute],
  RideStatus.driverEnRoute => const [RideStatus.driverArrived],
  RideStatus.driverArrived => const [
    RideStatus.passengerOnboard,
    RideStatus.noShow,
  ],
  RideStatus.passengerOnboard => const [RideStatus.inProgress],
  RideStatus.inProgress => const [RideStatus.arrivedAtDestination],
  RideStatus.arrivedAtDestination => const [RideStatus.completed],
  _ => const [],
};

/// Whether the driver's device should be sampling location.
///
/// The same rule the server's write path enforces. Keeping them equal is what
/// stops the app collecting readings the server would refuse — which would
/// drain a battery to fill a queue that can never be flushed.
bool sharesLocation(RideStatus status) => switch (status) {
  RideStatus.driverEnRoute ||
  RideStatus.driverArrived ||
  RideStatus.passengerOnboard ||
  RideStatus.inProgress ||
  RideStatus.arrivedAtDestination => true,
  _ => false,
};
