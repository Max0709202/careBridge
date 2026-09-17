import 'package:carebridge_family/app/theme.dart';
import 'package:carebridge_family/features/settings/delete_account_screen.dart';
import 'package:carebridge_family/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_api.dart';

/// The deletion screen.
///
/// What is worth testing here is not that the button posts — the API suite
/// covers the endpoint — but the three things this screen has to get right for
/// the person reading it: that it says what is *kept* as well as what goes,
/// that a refusal arrives with its remedy rather than as a dead button, and
/// that once the deletion is scheduled the export is actually on screen. That
/// last one matters because by then the session is gone, so a screen that
/// merely says "done" has silently dropped the copy of their data.
///
/// There is no test for an "already scheduled" state because there is no such
/// state to reach: the request signs every device out and signing back in
/// cancels the deletion, so no session can observe one.
void main() {
  /// A signed-in screen.
  ///
  /// The sign-in is not incidental: `ApiTransport` refuses to send an
  /// authenticated request with no stored token, so a screen pumped without
  /// one renders its error state and every assertion below would be testing
  /// the error state instead of the screen.
  Future<Widget> screenWith(FakeApi fake) async {
    final api = fake.build();
    await api.signIn(email: 'sarah@example.com', password: 'demo-password');
    fake.requests.clear();

    return ProviderScope(
      overrides: [careApiProvider.overrideWith((ref) => api)],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const DeleteAccountScreen(),
      ),
    );
  }

  testWidgets('says what is removed and what is kept', (tester) async {
    await tester.pumpWidget(await screenWith(FakeApi()));
    await tester.pumpAndSettle();

    expect(find.text('What happens'), findsOneWidget);
    expect(find.text('What is kept'), findsOneWidget);

    // The undo has to be visible before the confirmation, not after it.
    expect(
      find.textContaining('Signing in again before then cancels it'),
      findsOneWidget,
    );
    // And the part somebody would otherwise discover on an invoice.
    expect(
      find.textContaining('financial and audit rules require'),
      findsOneWidget,
    );

    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Delete my account'),
    );
    expect(button.onPressed, isNotNull);
  });

  testWidgets('a refusal arrives with its remedy, not as a dead button', (
    tester,
  ) async {
    final fake = FakeApi(
      deletionStatus: {
        'blockers': ['rideInFlight'],
        'blockerMessages': [
          'A journey is under way right now. Deletion waits until it finishes.',
        ],
        'graceDays': 30,
      },
    );

    await tester.pumpWidget(await screenWith(fake));
    await tester.pumpAndSettle();

    expect(find.text('Not just yet'), findsOneWidget);
    expect(find.textContaining('A journey is under way'), findsOneWidget);

    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Delete my account'),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('hands over the export once the deletion is scheduled', (
    tester,
  ) async {
    final fake = FakeApi();
    await tester.pumpWidget(await screenWith(fake));
    await tester.pumpAndSettle();

    // The button sits below the fold on a phone-sized viewport, and a tap that
    // does not hit-test silently does nothing.
    final deleteButton = find.widgetWithText(FilledButton, 'Delete my account');
    await tester.ensureVisible(deleteButton);
    await tester.pumpAndSettle();
    await tester.tap(deleteButton);
    await tester.pumpAndSettle();

    // The confirmation, which states the undo again.
    expect(
      find.textContaining('Every device is signed out now'),
      findsOneWidget,
    );
    // Scoped to the dialog: the screen's own button carries the same label, so
    // an unscoped finder matches two and taps neither.
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(FilledButton, 'Delete my account'),
      ),
    );
    await tester.pumpAndSettle();

    expect(fake.requests, contains('DELETE /api/v1/auth/account'));

    expect(find.text('Your account is scheduled for deletion'), findsOneWidget);
    expect(find.text('Your data'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Copy my data'), findsOneWidget);
    // The data itself, not just an offer of it.
    expect(find.textContaining('formatVersion'), findsOneWidget);
  });
}
