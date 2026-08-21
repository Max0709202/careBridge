import 'package:carebridge_driver/domain/driver_authority.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

/// The client's copy of what belongs to the driver.
///
/// It decides which button to draw and nothing else — the server refuses the
/// same things whatever this file says. What is tested here is that the two
/// agree, because a mirror that drifts produces a button that always fails,
/// which is worse than a button that is missing.

void main() {
  group('what the driver may do', () {
    test('walks the trip one step at a time', () {
      expect(driverMovesFrom(RideStatus.assigned), [RideStatus.driverAccepted]);
      expect(driverMovesFrom(RideStatus.driverAccepted), [
        RideStatus.driverEnRoute,
      ]);
      expect(driverMovesFrom(RideStatus.driverEnRoute), [
        RideStatus.driverArrived,
      ]);
      expect(driverMovesFrom(RideStatus.driverArrived), [
        RideStatus.passengerOnboard,
        RideStatus.noShow,
      ]);
      expect(driverMovesFrom(RideStatus.passengerOnboard), [
        RideStatus.inProgress,
      ]);
      expect(driverMovesFrom(RideStatus.inProgress), [
        RideStatus.arrivedAtDestination,
      ]);
      expect(driverMovesFrom(RideStatus.arrivedAtDestination), [
        RideStatus.completed,
      ]);
    });

    test('never offers to cancel or to hand the ride back', () {
      // A ride the driver would rather not do is still owed. Both of these
      // belong to somebody else, and the server refuses them.
      for (final status in RideStatus.values) {
        expect(driverMovesFrom(status), isNot(contains(RideStatus.canceled)));
        expect(
          driverMovesFrom(status),
          isNot(contains(RideStatus.reassignmentRequired)),
        );
      }
    });

    test('offers nothing once the ride is over', () {
      for (final status in [
        RideStatus.completed,
        RideStatus.canceled,
        RideStatus.noShow,
        RideStatus.reassignmentRequired,
        RideStatus.draft,
        RideStatus.requested,
        RideStatus.awaitingAssignment,
      ]) {
        expect(driverMovesFrom(status), isEmpty, reason: status.name);
      }
    });

    test('only ever offers moves the shared list names', () {
      for (final status in RideStatus.values) {
        for (final move in driverMovesFrom(status)) {
          expect(driverTransitions, contains(move));
        }
      }
    });
  });

  group('when location is shared', () {
    test('starts when the driver sets off and stops when the ride ends', () {
      expect(sharesLocation(RideStatus.assigned), isFalse);
      expect(sharesLocation(RideStatus.driverAccepted), isFalse);
      expect(sharesLocation(RideStatus.driverEnRoute), isTrue);
      expect(sharesLocation(RideStatus.driverArrived), isTrue);
      expect(sharesLocation(RideStatus.passengerOnboard), isTrue);
      expect(sharesLocation(RideStatus.inProgress), isTrue);
      expect(sharesLocation(RideStatus.arrivedAtDestination), isTrue);
      expect(sharesLocation(RideStatus.completed), isFalse);
      expect(sharesLocation(RideStatus.canceled), isFalse);
      expect(sharesLocation(RideStatus.noShow), isFalse);
    });

    test('stops the moment a ride goes back to dispatch', () {
      // The row still names this driver until a new one is assigned, and for
      // those moments it is emphatically not their job.
      expect(sharesLocation(RideStatus.reassignmentRequired), isFalse);
    });
  });

  group('the words on the screen', () {
    test('names the action, not the state', () {
      // "Passenger is in the car" is answerable while holding a door open.
      expect(
        RideStatus.passengerOnboard.actionLabel,
        'Passenger is in the car',
      );
      expect(RideStatus.driverArrived.actionLabel, 'I have arrived');
      expect(RideStatus.noShow.actionLabel, 'Nobody came out');
    });

    test('reads differently from the family’s copy', () {
      // The same state seen from the other side of the windscreen.
      expect(RideStatus.driverArrived.driverLabel, 'At the pickup');
      expect(RideStatus.inProgress.driverLabel, 'Driving to the clinic');
    });

    test('has something to say about every state', () {
      for (final status in RideStatus.values) {
        expect(status.driverLabel, isNotEmpty, reason: status.name);
        expect(status.actionLabel, isNotEmpty, reason: status.name);
      }
    });
  });
}
