import 'package:carebridge_family/core/failures.dart';
import 'package:carebridge_family/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ride state machine', () {
    test('walks the happy path from request to completion', () {
      const path = [
        RideStatus.draft,
        RideStatus.requested,
        RideStatus.awaitingAssignment,
        RideStatus.assigned,
        RideStatus.driverAccepted,
        RideStatus.driverEnRoute,
        RideStatus.driverArrived,
        RideStatus.passengerOnboard,
        RideStatus.inProgress,
        RideStatus.arrivedAtDestination,
        RideStatus.completed,
      ];

      for (var i = 0; i < path.length - 1; i++) {
        expect(
          canTransitionRide(path[i], path[i + 1]),
          isTrue,
          reason: '${path[i].name} -> ${path[i + 1].name} should be allowed',
        );
      }
    });

    test('terminal states allow no further transitions', () {
      for (final terminal in [
        RideStatus.completed,
        RideStatus.canceled,
        RideStatus.noShow,
      ]) {
        expect(terminal.isTerminal, isTrue);
        expect(allowedRideTransitions(terminal), isEmpty);

        for (final target in RideStatus.values) {
          expect(
            canTransitionRide(terminal, target),
            isFalse,
            reason: 'nothing may follow ${terminal.name}',
          );
        }
      }
    });

    test('a ride cannot skip pickup and jump to completion', () {
      expect(
        canTransitionRide(RideStatus.driverEnRoute, RideStatus.completed),
        isFalse,
      );
      expect(
        canTransitionRide(RideStatus.assigned, RideStatus.passengerOnboard),
        isFalse,
      );
      expect(
        canTransitionRide(RideStatus.requested, RideStatus.inProgress),
        isFalse,
      );
    });

    test('a ride cannot go backwards', () {
      expect(
        canTransitionRide(RideStatus.passengerOnboard, RideStatus.driverEnRoute),
        isFalse,
      );
      expect(
        canTransitionRide(RideStatus.completed, RideStatus.inProgress),
        isFalse,
      );
    });

    test('assertRideTransition throws on an illegal move', () {
      expect(
        () => assertRideTransition(RideStatus.completed, RideStatus.inProgress),
        throwsA(isA<InvalidTransitionFailure>()),
      );
      expect(
        () => assertRideTransition(
          RideStatus.driverEnRoute,
          RideStatus.arrivedAtDestination,
        ),
        throwsA(isA<InvalidTransitionFailure>()),
      );
    });

    test('a family can cancel at any point while the ride is still happening', () {
      // arrivedAtDestination is excluded deliberately: the vehicle has already
      // delivered the passenger, so there is nothing left to call off. The only
      // move from there is to complete.
      final cancellable = RideStatus.values.where(
        (s) => !s.isTerminal && s != RideStatus.arrivedAtDestination,
      );

      for (final status in cancellable) {
        expect(
          canTransitionRide(status, RideStatus.canceled),
          isTrue,
          reason: 'cancelling must be possible from ${status.name} — the reasons '
              'to stop a ride are rarely convenient',
        );
      }

      expect(
        canTransitionRide(RideStatus.arrivedAtDestination, RideStatus.canceled),
        isFalse,
      );
      expect(
        allowedRideTransitions(RideStatus.arrivedAtDestination),
        {RideStatus.completed},
      );
    });

    group('location sharing', () {
      test('is permitted only while the driver is actually driving', () {
        const permitted = {
          RideStatus.driverEnRoute,
          RideStatus.driverArrived,
          RideStatus.passengerOnboard,
          RideStatus.inProgress,
          RideStatus.arrivedAtDestination,
        };

        for (final status in RideStatus.values) {
          expect(
            status.allowsLocationSharing,
            permitted.contains(status),
            reason: 'location sharing for ${status.name}',
          );
        }
      });

      test('stops the moment a ride reaches a terminal state', () {
        for (final terminal in RideStatus.values.where((s) => s.isTerminal)) {
          expect(terminal.allowsLocationSharing, isFalse);
        }
      });

      test('is not permitted before a driver has set off', () {
        for (final early in [
          RideStatus.draft,
          RideStatus.requested,
          RideStatus.awaitingAssignment,
          RideStatus.assigned,
          RideStatus.driverAccepted,
        ]) {
          expect(early.allowsLocationSharing, isFalse);
        }
      });
    });

    test('passengerIsOnboard is true only with the passenger in the vehicle', () {
      expect(RideStatus.passengerOnboard.passengerIsOnboard, isTrue);
      expect(RideStatus.inProgress.passengerIsOnboard, isTrue);
      expect(RideStatus.driverArrived.passengerIsOnboard, isFalse);
      expect(RideStatus.arrivedAtDestination.passengerIsOnboard, isFalse);
    });

    test('every status has a plain-language label', () {
      for (final status in RideStatus.values) {
        expect(status.label, isNotEmpty);
        expect(status.label, isNot(contains('_')));
      }
    });
  });
}
