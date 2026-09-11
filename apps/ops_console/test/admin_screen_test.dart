import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_ops_console/data/ops_api.dart';
import 'package:carebridge_ops_console/domain/admin.dart';
import 'package:carebridge_ops_console/features/admin/audit_screen.dart';
import 'package:carebridge_ops_console/features/admin/flags_screen.dart';
import 'package:carebridge_ops_console/features/admin/overview_screen.dart';
import 'package:carebridge_ops_console/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_test.dart' show stats;

/// What an administrator actually sees.
///
/// The assertions are about the distinction each screen exists to make. On the
/// overview it is **work versus information**: four of the fourteen numbers
/// are queues that need a person today, and a dashboard that renders them
/// beside "trips last week" buries them. On the flags screen it is that
/// narrowing a rollout is announced *before* it is sent, rather than surfacing
/// as the server's refusal.

/// A window tall enough to hold the whole dashboard.
///
/// The overview is a scrolling list and the default 800×600 test surface cuts
/// it off part way down, which makes an assertion about the completion
/// sentence a test of the viewport rather than of the screen.
void useTallWindow(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> pumpOverview(WidgetTester tester, PlatformStats data) async {
  useTallWindow(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [platformStatsProvider.overrideWith((ref) async => data)],
      child: const MaterialApp(home: Scaffold(body: AdminOverviewScreen())),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> pumpFlags(WidgetTester tester, List<FeatureFlag> flags) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [featureFlagsProvider.overrideWith((ref) async => flags)],
      child: const MaterialApp(home: FlagsScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

FeatureFlag flag({
  String key = 'marketplace',
  bool enabled = true,
  int percent = 40,
}) => FeatureFlag(
  key: key,
  description: 'Caregiver marketplace',
  enabled: enabled,
  rolloutPercent: percent,
  updatedAt: DateTime.utc(2026, 8, 1),
  updatedByName: 'Priya N.',
);

/// A store with nothing in it. `OpsApi` needs one to be constructed; nothing
/// in these tests reaches the network, so nothing reads it.
class _NoTokens implements TokenStore {
  @override
  Future<AuthTokens?> read() async => null;

  @override
  Future<void> clear() async {}

  @override
  Future<void> write(AuthTokens tokens) async {}
}

/// An audit log that answers from a script, one page per call.
///
/// Subclassed rather than mocked so the screen is exercised through the real
/// method signature — including the cursor, which is the part of this screen
/// that can silently go wrong. What was asked for is recorded in [calls]; the
/// answers come off the script in order, so a test says what the server
/// returns without also having to model it.
class ScriptedAudit extends OpsApi {
  ScriptedAudit(this.pages) : super(tokens: _NoTokens());

  final List<AuditPage> pages;
  final List<({AuditFilter filter, String? cursor})> calls = [];
  int _next = 0;

  @override
  Future<AuditPage> auditLog({
    AuditFilter filter = const AuditFilter(),
    String? cursor,
  }) async {
    calls.add((filter: filter, cursor: cursor));
    return pages[_next++];
  }
}

AuditEntry entry({
  String id = 'entry-1',
  String action = 'driver.approved',
  String? actorName = 'Priya N.',
  String? actorUserId = 'user-1',
  List<String> changed = const ['status'],
}) => AuditEntry(
  id: id,
  at: DateTime.utc(2026, 8, 3, 9, 30),
  action: action,
  entityType: 'Driver',
  changedFields: changed,
  actorUserId: actorUserId,
  actorName: actorName,
  entityId: 'driver-7',
  correlationId: 'corr-1',
);

Future<ScriptedAudit> pumpAudit(
  WidgetTester tester,
  List<AuditPage> pages,
) async {
  useTallWindow(tester);
  final api = ScriptedAudit(pages);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [opsApiProvider.overrideWithValue(api)],
      child: const MaterialApp(home: Scaffold(body: AuditScreen())),
    ),
  );
  await tester.pumpAndSettle();
  return api;
}

void main() {
  group('the overview', () {
    testWidgets('says so plainly when nothing needs a person', (tester) async {
      await pumpOverview(tester, stats(rides: 12, completed: 12));

      expect(
        find.text('Nothing is waiting on a person right now.'),
        findsOneWidget,
      );
      expect(find.text('Waiting on a person'), findsNothing);
    });

    testWidgets('a stale trip is presented as a telephone call', (
      tester,
    ) async {
      await pumpOverview(tester, stats(rides: 4, completed: 3, stale: 2));

      expect(find.text('Waiting on a person'), findsOneWidget);
      expect(
        find.textContaining('have not reported a position recently'),
        findsOneWidget,
      );
      // The number alone is not the point — the sentence beside it says what
      // to do with it.
      expect(find.textContaining('Telephone the driver'), findsOneWidget);
    });

    testWidgets('each queue explains what happens if nobody acts', (
      tester,
    ) async {
      await pumpOverview(
        tester,
        stats(awaitingReview: 3, expiring: 1, pastDue: 2),
      );

      expect(find.textContaining('cannot be assigned'), findsOneWidget);
      expect(find.textContaining('they come off the road'), findsOneWidget);
      expect(find.textContaining('needs a conversation'), findsOneWidget);
    });

    testWidgets('a week where nothing finished is not reported as 0%', (
      tester,
    ) async {
      await pumpOverview(tester, stats(rides: 3));

      expect(
        find.text('No trips have reached an end state in the last seven days.'),
        findsOneWidget,
      );
    });

    testWidgets('completion is stated as a share of what ended', (
      tester,
    ) async {
      await pumpOverview(
        tester,
        stats(rides: 10, completed: 6, noShow: 2, cancelled: 2),
      );

      expect(
        find.text('60% of the trips that ended were completed.'),
        findsOneWidget,
      );
    });

    testWidgets('a failure offers a retry rather than a stack trace', (
      tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            platformStatsProvider.overrideWith(
              (ref) async => throw Exception('boom'),
            ),
          ],
          child: const MaterialApp(home: Scaffold(body: AdminOverviewScreen())),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Could not load the dashboard'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.textContaining('boom'), findsNothing);
    });
  });

  group('the flags', () {
    testWidgets('a flag says what it is doing, not what it is set to', (
      tester,
    ) async {
      await pumpFlags(tester, [flag(percent: 40)]);

      expect(find.text('marketplace'), findsOneWidget);
      expect(find.text('On for 40% of subjects'), findsOneWidget);
    });

    testWidgets('a disabled flag is off for everybody, whatever the rollout', (
      tester,
    ) async {
      await pumpFlags(tester, [flag(enabled: false, percent: 90)]);

      expect(find.text('Off for everybody'), findsOneWidget);
    });

    testWidgets('narrowing warns before it is sent, not after', (tester) async {
      await pumpFlags(tester, [flag(percent: 80)]);

      await tester.tap(find.text('marketplace'));
      await tester.pumpAndSettle();

      // Nothing yet: the editor opens at the current value, which takes
      // nothing away.
      expect(
        find.textContaining('takes the feature away from people who have it'),
        findsNothing,
      );

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      // Switching the master off is the widest narrowing there is, and the
      // warning appears on the form rather than arriving as the server's
      // refusal.
      expect(
        find.textContaining('takes the feature away from people who have it'),
        findsOneWidget,
      );
    });

    testWidgets('a new flag can never narrow anything', (tester) async {
      await pumpFlags(tester, const []);

      await tester.tap(find.text('New flag'));
      await tester.pumpAndSettle();

      expect(find.text('New flag'), findsWidgets);
      expect(
        find.textContaining('takes the feature away from people who have it'),
        findsNothing,
      );
    });

    testWidgets('an empty list explains itself rather than showing a blank', (
      tester,
    ) async {
      await pumpFlags(tester, const []);

      expect(find.text('No flags yet'), findsOneWidget);
    });
  });

  group('the audit log', () {
    testWidgets('names the system when nobody did it', (tester) async {
      await pumpAudit(tester, [
        AuditPage(
          entries: [
            entry(
              action: 'billing.period_renewed',
              actorName: null,
              actorUserId: null,
            ),
          ],
          nextCursor: null,
        ),
      ]);

      expect(find.text('CareBridge — billing.period_renewed'), findsOneWidget);
    });

    testWidgets('says field names and says that is what they are', (
      tester,
    ) async {
      // The server sends names without values on purpose, so support staff
      // can read this log without being entitled to the records it describes.
      // The wording says so rather than leaving a reader to wonder whether a
      // value was withheld or simply not changed.
      await pumpAudit(tester, [
        AuditPage(
          entries: [
            entry(changed: const ['status', 'approvedAt']),
          ],
          nextCursor: null,
        ),
      ]);

      expect(find.text('Fields changed: status, approvedAt'), findsOneWidget);
    });

    testWidgets('the end of the log is stated, not left as a dead button', (
      tester,
    ) async {
      await pumpAudit(tester, [
        AuditPage(entries: [entry()], nextCursor: null),
      ]);

      expect(find.text('End of the log for this filter.'), findsOneWidget);
      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('a further page is appended, not swapped in', (tester) async {
      // Appending is the whole reason this screen holds its own list: a log
      // you have to re-read from the top to scroll is a log nobody scrolls.
      final api = await pumpAudit(tester, [
        AuditPage(
          entries: [entry(id: 'a')],
          nextCursor: 'cursor-1',
        ),
        AuditPage(
          entries: [entry(id: 'b', action: 'ride.assigned')],
          nextCursor: null,
        ),
      ]);

      await tester.tap(find.text('Load more'));
      await tester.pumpAndSettle();

      expect(find.text('Priya N. — driver.approved'), findsOneWidget);
      expect(find.text('Priya N. — ride.assigned'), findsOneWidget);
      // The cursor came from the previous page and from nowhere else.
      expect(api.calls.last.cursor, 'cursor-1');
    });

    testWidgets('a filter starts a new walk rather than paging the old one', (
      tester,
    ) async {
      final api = await pumpAudit(tester, [
        AuditPage(
          entries: [entry(id: 'a')],
          nextCursor: 'cursor-1',
        ),
        AuditPage(
          entries: [entry(id: 'c', action: 'billing.refund_issued')],
          nextCursor: null,
        ),
      ]);

      await tester.enterText(
        find.widgetWithText(TextField, 'Action'),
        'billing.',
      );
      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();

      expect(api.calls.last.cursor, isNull);
      expect(api.calls.last.filter.action, 'billing.');
      // The rows from the previous question are gone, rather than sitting
      // above rows that answer a different one.
      expect(find.text('Priya N. — driver.approved'), findsNothing);
      expect(find.text('Priya N. — billing.refund_issued'), findsOneWidget);
    });

    testWidgets('an empty result under a filter explains the shape of one', (
      tester,
    ) async {
      await pumpAudit(tester, [
        const AuditPage(entries: [], nextCursor: null),
        const AuditPage(entries: [], nextCursor: null),
      ]);

      expect(find.text('Nothing matches'), findsOneWidget);
      expect(
        find.textContaining('No audited actions have been recorded yet.'),
        findsOneWidget,
      );

      await tester.enterText(find.widgetWithText(TextField, 'Action'), 'nope');
      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('like driver.approved or ride.assigned'),
        findsOneWidget,
      );
    });
  });
}
