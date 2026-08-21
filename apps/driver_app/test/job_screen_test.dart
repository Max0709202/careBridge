import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_driver/domain/models.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:carebridge_driver/features/job/job_screen.dart';
import 'package:carebridge_driver/features/today/today_screen.dart';
import 'package:carebridge_driver/services/location_service.dart';
import 'package:carebridge_driver/services/position_source.dart';
import 'package:carebridge_driver/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// What a driver sees at the kerb.
///
/// Two properties carry the weight. The **primary action is a single button**
/// saying what the driver did rather than what state the ride moves to, and
/// the **no-show is not one of them** — it ends a ride and tells a family
/// their relative did not come out, so it sits apart, counts down, and asks
/// again before it fires.

Job job({
  RideStatus status = RideStatus.driverArrived,
  List<RideStatus> transitions = const [
    RideStatus.passengerOnboard,
    RideStatus.noShow,
  ],
  int? noShowIn,
  bool wheelchair = false,
  bool assistance = false,
  String? notes,
}) => Job(
  id: 'ride-1',
  status: status,
  scheduledPickupAt: DateTime.utc(2026, 6, 15, 14),
  passengerName: 'Margaret',
  passengerPhone: '+1-555-0147',
  pickup: const Place(
    label: 'Home',
    line1: '400 Parkside Avenue',
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11226',
    accessNotes: 'Ring the buzzer marked 3B, the front door sticks.',
  ),
  destination: const Place(
    label: 'Clinic',
    line1: '451 Clarkson Avenue',
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11203',
  ),
  wheelchairRequired: wheelchair,
  assistanceRequired: assistance,
  notesForDriver: notes,
  availableTransitions: transitions,
  noShowAvailableInSeconds: noShowIn,
);

DriverProfile profile({
  bool onShift = true,
  bool canWork = true,
  String? suspensionReason,
}) => DriverProfile(
  driverId: 'driver-1',
  organizationName: 'Meridian Transit Partners',
  displayName: 'Marcus T.',
  status: canWork ? 'approved' : 'pendingApproval',
  onShift: onShift,
  canWork: canWork,
  vehicle: const Vehicle(
    make: 'Toyota',
    model: 'Sienna',
    color: 'Silver',
    licensePlate: 'OH-1234',
    isWheelchairAccessible: true,
  ),
  suspensionReason: suspensionReason,
);

Future<void> pumpJob(
  WidgetTester tester,
  Job value, {
  SharingState sharing = const SharingState(),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        jobsProvider.overrideWith((ref) async => [value]),
        sharingStateProvider.overrideWith((ref) => Stream.value(sharing)),
      ],
      child: const MaterialApp(home: JobScreen(rideId: 'ride-1')),
    ),
  );
  await tester.pumpAndSettle();
}

/// The sharing card sits below the fold on a 600px test surface, and a
/// ListView does not build what it has not scrolled to.
Future<void> scrollToSharing(WidgetTester tester) async {
  await tester.drag(find.byType(ListView), const Offset(0, -400));
  await tester.pumpAndSettle();
}

Future<void> pumpToday(
  WidgetTester tester, {
  AsyncValue<DriverProfile>? profileValue,
  List<Job> jobs = const [],
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        if (profileValue != null)
          profileProvider.overrideWith(
            (ref) => profileValue.hasError
                ? Future<DriverProfile>.error(profileValue.error!)
                : Future.value(profileValue.value),
          )
        else
          profileProvider.overrideWith((ref) async => profile()),
        jobsProvider.overrideWith((ref) async => jobs),
        sharingStateProvider.overrideWith(
          (ref) => Stream.value(const SharingState()),
        ),
      ],
      child: const MaterialApp(home: TodayScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('the ride screen', () {
    testWidgets('names the action rather than the state', (tester) async {
      // "Passenger is in the car" is answerable while holding a door open.
      // "passengerOnboard" is not.
      await pumpJob(tester, job(noShowIn: 300));

      expect(find.text('Passenger is in the car'), findsOneWidget);
      expect(find.text('passengerOnboard'), findsNothing);
    });

    testWidgets('puts the passenger and the address on the first screen', (
      tester,
    ) async {
      await pumpJob(tester, job(noShowIn: 300));

      expect(find.text('Margaret'), findsOneWidget);
      expect(find.textContaining('400 Parkside Avenue'), findsOneWidget);
      // What stops a driver waiting at the wrong entrance while a passenger
      // waits at the right one.
      expect(find.textContaining('buzzer marked 3B'), findsOneWidget);
    });

    testWidgets('offers the telephone call as a button', (tester) async {
      // A call from the kerb is what stops a five-minute wait becoming a
      // no-show, so it is not a number to copy out by hand.
      await pumpJob(tester, job(noShowIn: 300));
      expect(find.text('Call Margaret'), findsOneWidget);
    });

    testWidgets('states a wheelchair requirement in words, not colour', (
      tester,
    ) async {
      // WCAG 1.4.1. This and "needs help to the door" are the two facts that
      // decide whether the trip can happen at all.
      await pumpJob(
        tester,
        job(wheelchair: true, assistance: true, noShowIn: 300),
      );

      expect(find.text('Wheelchair'), findsOneWidget);
      expect(find.text('Needs help to the door'), findsOneWidget);
    });

    testWidgets('shows a ride that has left the list as done, not broken', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            jobsProvider.overrideWith((ref) async => <Job>[]),
            sharingStateProvider.overrideWith(
              (ref) => Stream.value(const SharingState()),
            ),
          ],
          child: const MaterialApp(home: JobScreen(rideId: 'ride-1')),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('This ride is done'), findsOneWidget);
    });
  });

  group('the no-show', () {
    testWidgets('refuses until the kerbside wait is served, and says so', (
      tester,
    ) async {
      await pumpJob(tester, job(noShowIn: 120));

      final button = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Nobody came out — wait 2:00'),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('becomes available once the wait is over', (tester) async {
      await pumpJob(tester, job(noShowIn: 0));

      final button = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Nobody came out'),
      );
      expect(button.onPressed, isNotNull);
    });

    testWidgets('asks again before ending the ride', (tester) async {
      await pumpJob(tester, job(noShowIn: 0));
      await tester.tap(find.text('Nobody came out'));
      await tester.pumpAndSettle();

      expect(find.text('Record a no-show?'), findsOneWidget);
      expect(find.textContaining('nobody came out'), findsWidgets);
      // The way out is offered first and reads as the ordinary choice.
      expect(find.text('Keep waiting'), findsOneWidget);
    });

    testWidgets('is not offered before the driver has arrived', (tester) async {
      await pumpJob(
        tester,
        job(
          status: RideStatus.driverEnRoute,
          transitions: const [RideStatus.driverArrived],
        ),
      );

      expect(find.textContaining('Nobody came out'), findsNothing);
      expect(find.text('I have arrived'), findsOneWidget);
    });
  });

  group('what the app says it is doing with a location', () {
    testWidgets('says it is sharing, and how often', (tester) async {
      // Somebody carrying a phone that reports their position is entitled to
      // know it is happening — the same reason the Android notification says
      // so too.
      await pumpJob(
        tester,
        job(noShowIn: 300),
        sharing: const SharingState(
          rideId: 'ride-1',
          cadence: Duration(seconds: 10),
        ),
      );

      await scrollToSharing(tester);

      expect(
        find.text('Sharing your location with the family'),
        findsOneWidget,
      );
      expect(find.text('Updating every 10 seconds.'), findsOneWidget);
    });

    testWidgets('shows a backlog rather than pretending all is well', (
      tester,
    ) async {
      // The only visible sign of a dead zone. A driver who can see it can
      // mention it, which is how a coverage hole ever gets reported.
      await pumpJob(
        tester,
        job(noShowIn: 300),
        sharing: const SharingState(rideId: 'ride-1', queued: 14),
      );

      await scrollToSharing(tester);
      expect(find.text('14 update(s) waiting for signal.'), findsOneWidget);
    });

    testWidgets('sends a driver to settings when permission is blocked', (
      tester,
    ) async {
      // Asking again does nothing once it is permanently denied, so a button
      // that re-requests would be a button that silently fails.
      await pumpJob(
        tester,
        job(noShowIn: 300),
        sharing: const SharingState(access: LocationAccess.blocked),
      );

      await scrollToSharing(tester);
      expect(find.textContaining('phone’s settings'), findsOneWidget);
    });
  });

  group('the shift', () {
    testWidgets('offers to start one, and names the vehicle', (tester) async {
      await pumpToday(tester, profileValue: AsyncData(profile(onShift: false)));

      expect(find.text('Start shift'), findsOneWidget);
      expect(find.textContaining('OH-1234'), findsOneWidget);
    });

    testWidgets('says why a suspended driver cannot work', (tester) async {
      // Being locked out of your own job with no reason given is how a support
      // queue fills up.
      await pumpToday(
        tester,
        profileValue: AsyncData(
          profile(canWork: false, suspensionReason: 'Licence under review'),
        ),
      );

      expect(find.textContaining('Licence under review'), findsOneWidget);
      expect(find.text('Start shift'), findsNothing);
    });

    testWidgets('treats "not on a roster" as a sentence, not an error', (
      tester,
    ) async {
      // Exactly what a family member who installed the wrong app would see,
      // and what a new driver sees before their operator has recorded their
      // address.
      await pumpToday(
        tester,
        profileValue: AsyncError<DriverProfile>(
          const NotFoundFailure(),
          StackTrace.empty,
        ),
      );

      expect(find.text('No driver profile yet'), findsOneWidget);
      expect(find.textContaining('verified'), findsOneWidget);
    });

    testWidgets('says an empty list refreshes itself', (tester) async {
      await pumpToday(tester);
      expect(find.text('Nothing assigned'), findsOneWidget);
    });
  });
}
