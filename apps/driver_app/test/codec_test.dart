import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_driver/data/driver_codec.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

/// Wire in, domain out.
///
/// The rule worth testing is what happens when the **server is ahead of the
/// app**, which is not hypothetical: it is the ordinary state of affairs
/// between a deploy and a store review, on a phone that updates when its owner
/// remembers. A value this build has never heard of must not take a driver's
/// screen down mid-shift.

wire.AddressDto address({String line1 = '400 Parkside Avenue'}) =>
    wire.AddressDto(
      label: 'Home',
      line1: line1,
      line2: null,
      city: 'Brooklyn',
      state: 'NY',
      postalCode: '11226',
      accessNotes: 'Ring 3B.',
      latitude: 40.65,
      longitude: -73.95,
    );

wire.DriverRideDto ride({
  wire.RideStatus status = wire.RideStatus.driverArrived,
  List<String> transitions = const ['passengerOnboard', 'noShow'],
}) => wire.DriverRideDto(
  id: 'ride-1',
  status: status,
  scheduledPickupAt: DateTime.utc(2026, 6, 15, 14),
  direction: 'outbound',
  passengerName: 'Margaret',
  passengerPhone: '+1-555-0147',
  pickup: address(),
  destination: address(line1: '451 Clarkson Avenue'),
  wheelchairRequired: true,
  assistanceRequired: false,
  notesForDriver: 'Walks with a frame.',
  isDelayed: false,
  availableTransitions: transitions,
  noShowAvailableInSeconds: 120,
  shareLocation: true,
  lastCapturedAt: null,
);

void main() {
  group('a job', () {
    test('carries everything needed to collect somebody', () {
      final job = jobFromWire(ride())!;

      expect(job.id, 'ride-1');
      expect(job.status, RideStatus.driverArrived);
      expect(job.passengerName, 'Margaret');
      expect(job.passengerPhone, '+1-555-0147');
      expect(job.pickup.oneLine, contains('400 Parkside Avenue'));
      expect(job.destination.oneLine, contains('451 Clarkson Avenue'));
      expect(job.wheelchairRequired, isTrue);
      expect(job.notesForDriver, 'Walks with a frame.');
      expect(job.pickup.accessNotes, 'Ring 3B.');
    });

    test('shows the pickup time in the driver’s own zone', () {
      // A driver reads a clock, not a UTC offset. Converting here rather than
      // in the widget is what keeps the two screens that show it agreeing.
      final job = jobFromWire(ride())!;
      expect(job.scheduledPickupAt.isUtc, isFalse);
    });

    test('knows which single move to put on the button', () {
      // `driverArrived` is the one state with two, and the second — a no-show
      // — is deliberately not the primary.
      final job = jobFromWire(ride())!;
      expect(job.primaryMove, RideStatus.passengerOnboard);
      expect(job.offersNoShow, isTrue);
    });

    test('does not treat a countdown still running as ready', () {
      expect(jobFromWire(ride())!.noShowReady, isFalse);
    });

    test('treats a missing countdown as not ready', () {
      // Null means the server did not offer a no-show at all. Reading that as
      // "go ahead" would be the worst possible default.
      final job = jobFromWire(
        wire.DriverRideDto(
          id: 'ride-1',
          status: wire.RideStatus.driverEnRoute,
          scheduledPickupAt: DateTime.utc(2026),
          direction: 'outbound',
          passengerName: 'Margaret',
          pickup: address(),
          destination: address(),
          wheelchairRequired: false,
          assistanceRequired: false,
          isDelayed: false,
          availableTransitions: const ['driverArrived'],
          shareLocation: true,
        ),
      )!;

      expect(job.noShowReady, isFalse);
      expect(job.offersNoShow, isFalse);
    });

    test('reports whether the device should be sampling', () {
      expect(jobFromWire(ride())!.sharesLocation, isTrue);
      expect(
        jobFromWire(ride(status: wire.RideStatus.assigned))!.sharesLocation,
        isFalse,
      );
    });
  });

  group('when the server is ahead of the app', () {
    test('drops a transition this build cannot honour', () {
      // Offering a button that always fails is worse than offering none.
      final job = jobFromWire(
        ride(transitions: const ['passengerOnboard', 'teleported']),
      )!;

      expect(job.availableTransitions, [RideStatus.passengerOnboard]);
    });

    test('keeps the job when only a transition is unrecognised', () {
      // The trip is still real and the addresses still need driving to.
      expect(jobFromWire(ride(transitions: const ['teleported'])), isNotNull);
    });

    test('rejects an unparseable status outright', () {
      expect(RideStatus.tryParse('teleported'), isNull);
      expect(RideStatus.tryParse(null), isNull);
    });
  });

  group('the driver', () {
    test('carries the vehicle a family will be looking for at the kerb', () {
      final profile = profileFromWire(
        wire.DriverProfileDto(
          driverId: 'driver-1',
          organizationId: 'org-1',
          organizationName: 'Meridian Transit Partners',
          displayName: 'Marcus T.',
          status: wire.DriverStatus.approved,
          onShift: true,
          vehicle: wire.VehicleDto(
            id: 'vehicle-1',
            make: 'Toyota',
            model: 'Sienna',
            color: 'Silver',
            licensePlate: 'OH-1234',
            isWheelchairAccessible: true,
          ),
          canWork: true,
          suspensionReason: null,
        ),
      );

      expect(profile.displayName, 'Marcus T.');
      expect(profile.organizationName, 'Meridian Transit Partners');
      expect(profile.vehicle.description, 'Silver Toyota Sienna');
      expect(profile.canWork, isTrue);
    });
  });
}
