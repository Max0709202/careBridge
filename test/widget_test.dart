import 'package:carebridge_family/core/clock.dart';
import 'package:carebridge_family/data/care_state.dart';
import 'package:carebridge_family/data/seed.dart';
import 'package:carebridge_family/features/rides/ride_timeline.dart';
import 'package:carebridge_family/main.dart';
import 'package:carebridge_family/state/providers.dart';
import 'package:carebridge_family/widgets/status_pill.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime(2026, 7, 27, 9, 0);

  Widget appWith(FixedClock clock) => ProviderScope(
        overrides: [clockProvider.overrideWithValue(clock)],
        child: const CareBridgeApp(),
      );

  testWidgets('opens on the sign-in screen when signed out', (tester) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets);
    expect(find.text('Create an account'), findsOneWidget);
    // The preview build must say plainly that credentials are not checked.
    expect(find.textContaining('Credentials are not checked'), findsOneWidget);
  });

  testWidgets('signing in lands on the dashboard with the patient in view',
      (tester) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Eleanor'), findsWidgets);
    expect(find.text('Next appointment'), findsOneWidget);
  });

  testWidgets('the dashboard surfaces the active ride and its status',
      (tester) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Finding a driver'), findsWidgets);
  });

  testWidgets('a new account starts empty and asks for a profile',
      (tester) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Create an account'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Your name'),
      'Jordan Reyes',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Email address'),
      'jordan@example.com',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Password'),
      'a-long-enough-passphrase',
    );

    // Consent is an explicit, unticked action, and the form is long enough that
    // both it and the submit button need scrolling into view first.
    final consent = find.byType(CheckboxListTile);
    await tester.ensureVisible(consent);
    await tester.pumpAndSettle();
    await tester.tap(consent);
    await tester.pumpAndSettle();

    final submit = find.widgetWithText(FilledButton, 'Create account');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(find.text('Add the person you care for'), findsOneWidget);
  });

  group('status pill', () {
    testWidgets('carries an icon and a word, never colour alone',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: StatusPill(
              label: 'Driver on the way',
              icon: Icons.directions_car_filled_outlined,
              ink: Color(0xFF0B4A6F),
            ),
          ),
        ),
      );

      expect(find.text('Driver on the way'), findsOneWidget);
      expect(find.byIcon(Icons.directions_car_filled_outlined), findsOneWidget);
    });
  });

  group('ride timeline', () {
    testWidgets('shows an empty message rather than an empty box',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: RideTimeline(events: [])),
        ),
      );
      expect(find.textContaining('Nothing has happened yet'), findsOneWidget);
    });

    testWidgets('renders the events of a completed ride', (tester) async {
      final state = buildSeedState(now);
      final ride = state.rideById('ride-past')!;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: RideTimeline(events: ride.events),
            ),
          ),
        ),
      );

      expect(find.text('Ride completed'), findsOneWidget);
      expect(find.text('Picked up safely'), findsOneWidget);
    });
  });

  group('CareState queries', () {
    test('active ride prefers the one being tracked', () {
      final state = buildSeedState(now);
      expect(state.activeRideFor('patient-eleanor')?.id, 'ride-upcoming');
    });

    test('past appointments exclude upcoming ones', () {
      final state = buildSeedState(now);
      final past = state.pastFor('patient-eleanor', now);
      expect(past.map((a) => a.id), contains('appt-past'));
      expect(past.map((a) => a.id), isNot(contains('appt-followup')));
    });

    test('an unknown id yields nothing rather than throwing', () {
      const empty = CareState();
      expect(empty.patientById('nope'), isNull);
      expect(empty.rideById('nope'), isNull);
      expect(empty.appointmentsFor('nope'), isEmpty);
    });
  });
}
