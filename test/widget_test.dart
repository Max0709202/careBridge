import 'package:carebridge_family/core/clock.dart';
import 'package:carebridge_family/data/care_codec.dart';
import 'package:carebridge_family/data/care_state.dart';
import 'package:carebridge_family/features/rides/ride_timeline.dart';
import 'package:carebridge_family/main.dart';
import 'package:carebridge_family/state/providers.dart';
import 'package:carebridge_family/widgets/status_pill.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_api.dart';

void main() {
  final now = DateTime(2026, 7, 27, 9, 0);
  final snapshotJson = loadSnapshotFixture();

  late FakeApi fake;

  setUp(() => fake = FakeApi(snapshot: snapshotJson));

  /// The app wired to a canned server. `tokenStoreProvider` is overridden too:
  /// there is no secure-storage platform channel under the test binding.
  Widget appWith(FixedClock clock) => ProviderScope(
    overrides: [
      clockProvider.overrideWithValue(clock),
      careApiProvider.overrideWith((ref) => fake.build()),
    ],
    child: const CareBridgeApp(),
  );

  testWidgets('opens on the sign-in screen when signed out', (tester) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsWidgets);
    expect(find.text('Create an account'), findsOneWidget);

    // The notice must describe what the credentials actually are — a seeded
    // account whose password is checked — and must not claim otherwise.
    expect(find.textContaining('checked like any other'), findsOneWidget);
    expect(find.textContaining('Credentials are not checked'), findsNothing);
  });

  testWidgets('signing in reaches the server and lands on the dashboard', (
    tester,
  ) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(fake.requests, contains('POST /api/v1/auth/login'));
    expect(find.text('Eleanor'), findsWidgets);
    expect(find.text('Next appointment'), findsOneWidget);
  });

  testWidgets('the dashboard surfaces the active ride and its status', (
    tester,
  ) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Finding a driver'), findsWidgets);
  });

  testWidgets('a new account starts empty and asks for a profile', (
    tester,
  ) async {
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

    expect(fake.requests, contains('POST /api/v1/auth/register'));
    expect(find.text('Add the person you care for'), findsOneWidget);
  });

  testWidgets('a signed-out user is redirected away from a deep link', (
    tester,
  ) async {
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    // No session, so nothing patient-scoped may render — the router guard
    // hides the screen and the server would refuse the data regardless.
    expect(find.text('Sign in'), findsWidgets);
    expect(find.text('Eleanor'), findsNothing);
  });

  group('status pill', () {
    testWidgets('carries an icon and a word, never colour alone', (
      tester,
    ) async {
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
    testWidgets('shows an empty message rather than an empty box', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: RideTimeline(events: [])),
        ),
      );
      expect(find.textContaining('Nothing has happened yet'), findsOneWidget);
    });

    testWidgets('renders the events of a completed ride', (tester) async {
      final state = careStateFromJson(snapshotJson);
      final ride = state.rideById(Seeded.pastRide)!;

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
      final state = careStateFromJson(snapshotJson);
      expect(state.activeRideFor(Seeded.eleanor)?.id, Seeded.outboundRide);
    });

    test('past appointments exclude upcoming ones', () {
      final state = careStateFromJson(snapshotJson);
      final past = state.pastFor(Seeded.eleanor, now);
      expect(past.map((a) => a.id), contains(Seeded.pastAppointment));
      expect(
        past.map((a) => a.id),
        isNot(contains(Seeded.followUpAppointment)),
      );
    });

    test('an unknown id yields nothing rather than throwing', () {
      const empty = CareState();
      expect(empty.patientById('nope'), isNull);
      expect(empty.rideById('nope'), isNull);
      expect(empty.appointmentsFor('nope'), isEmpty);
    });
  });

  // ─── the verification banner ────────────────────────────────────────────

  testWidgets('prompts an unverified account to confirm its address', (
    tester,
  ) async {
    // Registration deliberately does not block on verification — locking a
    // family out of a ride they have already booked because an email went to
    // spam is the worse outcome. Without this prompt, though, a user meets the
    // invitation wall with no explanation of why.
    await tester.pumpWidget(appWith(FixedClock(now)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm your email address'), findsOneWidget);
    expect(find.text('Send the link again'), findsOneWidget);
  });

  testWidgets('the banner says nothing once the address is confirmed', (
    tester,
  ) async {
    // It renders an empty box rather than a dismissible state, which is what
    // makes it safe to leave at the top of any screen.
    final verified = Map<String, dynamic>.from(snapshotJson);
    verified['user'] = {
      ...snapshotJson['user'] as Map<String, dynamic>,
      'emailVerifiedAt': '2026-08-01T09:00:00.000Z',
    };

    final verifiedFake = FakeApi(snapshot: verified);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          clockProvider.overrideWithValue(FixedClock(now)),
          careApiProvider.overrideWith((ref) => verifiedFake.build()),
        ],
        child: const CareBridgeApp(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Confirm your email address'), findsNothing);
  });
}
