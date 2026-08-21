import 'package:carebridge_driver/domain/location_cadence.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

/// How often the device takes a fix.
///
/// The rule this file protects is that cadence follows **movement**, not
/// interest: the moment a family is refreshing hardest is often the moment the
/// car is standing still, and sampling it forty times would produce the same
/// coordinate forty times for the same battery cost as an eight-hour shift.
///
/// The last group is the one worth reading. Below five per cent the app
/// deliberately breaks its own freshness rule, and that trade — a visibly
/// stale marker in exchange for a phone that still works at four o'clock — is
/// a decision, not an oversight, so it is asserted rather than left implied.

CadenceInputs inputs(
  RideStatus status, {
  double? speed,
  BatteryPressure battery = BatteryPressure.none,
}) => CadenceInputs(
  status: status,
  speedMetersPerSecond: speed,
  battery: battery,
);

void main() {
  group('when not to sample at all', () {
    test('says nothing to do before the driver sets off', () {
      // Location is collectable only while the ride is in a state that permits
      // it. Sampling earlier would fill a queue the server would refuse,
      // spending a battery to build something unflushable.
      expect(cadenceFor(inputs(RideStatus.assigned)), isNull);
      expect(cadenceFor(inputs(RideStatus.driverAccepted)), isNull);
    });

    test('stops the moment the ride is over', () {
      for (final status in [
        RideStatus.completed,
        RideStatus.canceled,
        RideStatus.noShow,
        RideStatus.reassignmentRequired,
      ]) {
        expect(cadenceFor(inputs(status)), isNull, reason: status.name);
      }
    });

    test('stops even on a flat battery, rather than backing off', () {
      // The battery rules must not resurrect a ride that has ended. Order
      // matters here and this is the assertion that pins it.
      expect(
        cadenceFor(
          inputs(RideStatus.completed, battery: BatteryPressure.critical),
        ),
        isNull,
      );
    });
  });

  group('while driving', () {
    test('samples fastest on the approach to the pickup', () {
      // The stretch where the question is "is the car outside yet" — and the
      // shortest phase of the trip, so the cost is bounded by the phase.
      final approaching = cadenceFor(
        inputs(RideStatus.driverEnRoute, speed: 12),
      )!;
      final carrying = cadenceFor(inputs(RideStatus.inProgress, speed: 12))!;

      expect(approaching, lessThan(carrying));
    });

    test('slows down for a car that is not moving', () {
      final moving = cadenceFor(inputs(RideStatus.driverEnRoute, speed: 12))!;
      final stopped = cadenceFor(inputs(RideStatus.driverEnRoute, speed: 0.2))!;

      expect(stopped, greaterThan(moving));
    });

    test('treats being stopped near the pickup as being stopped', () {
      // Deliberately above the phase rules: a red light two hundred metres
      // from the house is still a red light, and the coordinate is not
      // changing however much anybody wants it to.
      expect(
        cadenceFor(inputs(RideStatus.driverEnRoute, speed: 0.1)),
        cadenceFor(inputs(RideStatus.inProgress, speed: 0.1)),
      );
    });

    test('does not mistake GPS jitter for movement', () {
      // A stationary fix wanders a few metres a second on its own, which is
      // why the threshold is a walking pace rather than zero.
      expect(stationarySpeed, greaterThan(0));
      expect(
        cadenceFor(
          inputs(RideStatus.inProgress, speed: stationarySpeed - 0.01),
        ),
        greaterThan(cadenceFor(inputs(RideStatus.inProgress, speed: 20))!),
      );
    });

    test('assumes movement when nothing has been measured yet', () {
      // Opening a ride at the slow rate would take half a minute to notice the
      // car had set off.
      expect(
        cadenceFor(inputs(RideStatus.driverEnRoute)),
        cadenceFor(inputs(RideStatus.driverEnRoute, speed: 15)),
      );
    });

    test('idles at the kerb even when the fix reads as moving', () {
      // Parked with the engine running. The phase says what a noisy speed
      // reading cannot.
      expect(
        cadenceFor(inputs(RideStatus.driverArrived, speed: 1.4)),
        cadenceFor(inputs(RideStatus.driverArrived, speed: 0)),
      );
    });
  });

  group('freshness', () {
    test('every ordinary cadence stays inside the stale bound', () {
      // Otherwise a perfectly healthy device would be labelled out of date on
      // the family's screen — the product telling a worried person that
      // something is wrong when nothing is.
      for (final status in RideStatus.values) {
        for (final speed in <double?>[null, 0, 5, 25]) {
          final cadence = cadenceFor(inputs(status, speed: speed));
          if (cadence == null) continue;
          expect(
            cadence,
            lessThan(staleAfter),
            reason: '${status.name}/$speed',
          );
        }
      }
    });
  });

  group('battery', () {
    test('backs off when the phone is getting low', () {
      final normal = cadenceFor(inputs(RideStatus.driverEnRoute, speed: 12))!;
      final low = cadenceFor(
        inputs(
          RideStatus.driverEnRoute,
          speed: 12,
          battery: BatteryPressure.low,
        ),
      )!;

      expect(low, greaterThan(normal));
      // Still fresh, though. Low is not an excuse to look broken.
      expect(low, lessThan(staleAfter));
    });

    test('accepts looking stale rather than killing the phone', () {
      // The one cadence that breaks the freshness rule, and the reason it
      // does: a visibly stale marker with a working driver behind it beats a
      // fresh marker that stops for good twenty minutes later.
      final critical = cadenceFor(
        inputs(
          RideStatus.driverEnRoute,
          speed: 12,
          battery: BatteryPressure.critical,
        ),
      )!;

      expect(critical, greaterThan(staleAfter));
    });

    test('outranks everything except the ride being over', () {
      // A driver on four per cent gets the same slow rate whether they are
      // crawling or at seventy.
      expect(
        cadenceFor(
          inputs(
            RideStatus.driverEnRoute,
            speed: 30,
            battery: BatteryPressure.critical,
          ),
        ),
        cadenceFor(
          inputs(
            RideStatus.inProgress,
            speed: 0,
            battery: BatteryPressure.critical,
          ),
        ),
      );
    });
  });

  group('reading the battery', () {
    test('charging outranks the percentage', () {
      // Four per cent on a car charger is forty per cent in half an hour.
      // Backing off then would degrade the map exactly when the driver has
      // just plugged in.
      expect(
        BatteryPressure.from(percent: 4, charging: true),
        BatteryPressure.none,
      );
    });

    test('assumes nothing is wrong when the level is unknown', () {
      // A device whose battery API will not answer must not slow every ride
      // down.
      expect(BatteryPressure.from(percent: null), BatteryPressure.none);
    });

    test('grades the bands', () {
      expect(BatteryPressure.from(percent: 80), BatteryPressure.none);
      expect(BatteryPressure.from(percent: 15), BatteryPressure.low);
      expect(BatteryPressure.from(percent: 6), BatteryPressure.low);
      expect(BatteryPressure.from(percent: 5), BatteryPressure.critical);
      expect(BatteryPressure.from(percent: 1), BatteryPressure.critical);
    });
  });
}
