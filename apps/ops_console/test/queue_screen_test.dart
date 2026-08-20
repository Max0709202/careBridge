import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_ops_console/domain/dispatch.dart';
import 'package:carebridge_ops_console/domain/models.dart';
import 'package:carebridge_ops_console/features/queue/queue_screen.dart';
import 'package:carebridge_ops_console/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// What a dispatcher actually sees.
///
/// The assertions here are about the one distinction the screen exists to
/// make: a ride that needs a **tap** versus a ride that needs a **phone
/// call**. Presenting those identically is the failure mode — it buries the
/// second behind the first, and the second is the one where somebody ends up
/// stranded.

QueueItem item({
  String id = 'ride-1',
  DispatchUrgency urgency = DispatchUrgency.soon,
  List<Candidate> candidates = const [],
  bool wheelchair = false,
}) => QueueItem(
  rideId: id,
  status: 'awaitingAssignment',
  patientName: 'Eleanor R.',
  pickupLine: '18 Rosemary Ave',
  destinationLine: 'Riverside Cardiology',
  scheduledPickupAt: DateTime.utc(2026, 6, 15, 14),
  wheelchairRequired: wheelchair,
  assistanceRequired: false,
  urgency: urgency,
  candidates: candidates,
);

Future<void> pumpQueue(WidgetTester tester, DispatchQueue queue) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        selectedOrganizationIdProvider.overrideWith(
          () => _FixedOrganization('org-1'),
        ),
        queueProvider('org-1').overrideWith((ref) async => queue),
      ],
      child: const MaterialApp(home: Scaffold(body: QueueScreen())),
    ),
  );
  await tester.pumpAndSettle();
}

class _FixedOrganization extends SelectedOrganizationController {
  _FixedOrganization(this._id);

  final String _id;

  @override
  String? build() => _id;
}

void main() {
  testWidgets('an empty queue says so rather than showing a blank panel', (
    tester,
  ) async {
    await pumpQueue(
      tester,
      const DispatchQueue(
        organizationId: 'org-1',
        items: [],
        availableDrivers: 3,
      ),
    );

    expect(find.text('Nothing waiting'), findsOneWidget);
    expect(find.textContaining('3 driver(s) free'), findsOneWidget);
  });

  testWidgets('a ride with an available driver offers a tap', (tester) async {
    await pumpQueue(
      tester,
      DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 1,
        items: [
          item(
            candidates: [
              const Candidate(
                driverId: 'd1',
                displayName: 'Marcus T.',
                eligible: true,
                reasons: [],
              ),
            ],
          ),
        ],
      ),
    );

    expect(find.textContaining('Assign (1 available)'), findsOneWidget);
    expect(find.textContaining('needs a call'), findsNothing);
  });

  testWidgets('a ride nobody can take says so, and says why', (tester) async {
    // The whole reason the API returns *every* reason rather than the first.
    await pumpQueue(
      tester,
      DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 0,
        items: [
          item(
            wheelchair: true,
            candidates: const [
              Candidate(
                driverId: 'd1',
                displayName: 'Marcus T.',
                eligible: false,
                reasons: [IneligibilityReason.noAccessibleVehicle],
              ),
              Candidate(
                driverId: 'd2',
                displayName: 'Priya N.',
                eligible: false,
                reasons: [IneligibilityReason.offShift],
              ),
            ],
          ),
        ],
      ),
    );

    expect(find.text('Nobody available for this trip'), findsOneWidget);
    // Both reasons, counted — "one off shift" is a different call from
    // "four off shift", and one of the two has no remedy at all.
    expect(
      find.textContaining(IneligibilityReason.noAccessibleVehicle.label),
      findsOneWidget,
    );
    expect(
      find.textContaining(IneligibilityReason.offShift.label),
      findsOneWidget,
    );
    // No assign button: the server would refuse, and offering it anyway makes
    // the refusal a surprise.
    expect(find.textContaining('Assign ('), findsNothing);
  });

  testWidgets('the summary separates a tap problem from a call problem', (
    tester,
  ) async {
    await pumpQueue(
      tester,
      DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 1,
        items: [
          item(
            id: 'a',
            urgency: DispatchUrgency.overdue,
            candidates: const [
              Candidate(
                driverId: 'd1',
                displayName: 'Marcus T.',
                eligible: true,
                reasons: [],
              ),
            ],
          ),
          item(id: 'b', candidates: const []),
        ],
      ),
    );

    expect(find.textContaining('2 waiting'), findsOneWidget);
    expect(find.textContaining('1 past their pickup time'), findsOneWidget);
    expect(find.textContaining('needs a call, not a tap'), findsOneWidget);
  });

  testWidgets('urgency is never colour alone', (tester) async {
    // WCAG 1.4.1. Red-for-overdue against green-for-fine is the obvious
    // encoding and the one roughly 8% of men cannot read.
    await pumpQueue(
      tester,
      DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 0,
        items: [item(urgency: DispatchUrgency.overdue)],
      ),
    );

    expect(find.text(DispatchUrgency.overdue.label), findsOneWidget);
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
  });

  testWidgets('a wheelchair requirement is on the row, not behind a tap', (
    tester,
  ) async {
    // A hard constraint on assignment, never a preference — so a dispatcher
    // scanning the queue sees it without opening anything.
    await pumpQueue(
      tester,
      DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 0,
        items: [item(wheelchair: true)],
      ),
    );

    expect(find.byIcon(Icons.accessible), findsOneWidget);
  });

  testWidgets('a failure offers a retry rather than a stack trace', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          selectedOrganizationIdProvider.overrideWith(
            () => _FixedOrganization('org-1'),
          ),
          queueProvider(
            'org-1',
          ).overrideWith((ref) async => throw const NetworkFailure()),
        ],
        child: const MaterialApp(home: Scaffold(body: QueueScreen())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Could not load the queue'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });
}
