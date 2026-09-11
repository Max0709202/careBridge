import 'package:carebridge_ops_console/domain/billing.dart';
import 'package:carebridge_ops_console/features/billing/billing_screen.dart';
import 'package:carebridge_ops_console/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'billing_test.dart' show card, invoice, quote, subscription;

/// What an operator sees about what they are paying.
///
/// The assertions are about the three things this screen exists to say before
/// somebody finds them out the hard way: that a plan with no card behind it
/// will fail at the next renewal; that a failed payment has not switched the
/// console off; and that switching monthly to annual moves money today rather
/// than at the next renewal.

class _FixedOrganization extends SelectedOrganizationController {
  _FixedOrganization(this._id);

  final String _id;

  @override
  String? build() => _id;
}

Future<void> pumpBilling(
  WidgetTester tester, {
  required BillingAccount account,
  List<Invoice> invoices = const [],
  List<OperatorPlan> plans = const [],
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        selectedOrganizationIdProvider.overrideWith(
          () => _FixedOrganization('org-1'),
        ),
        billingProvider('org-1').overrideWith((ref) async => account),
        invoicesProvider('org-1').overrideWith((ref) async => invoices),
        operatorPlansProvider.overrideWith((ref) async => plans),
      ],
      child: const MaterialApp(home: Scaffold(body: BillingScreen())),
    ),
  );
  await tester.pumpAndSettle();
}

BillingAccount account({
  OperatorSubscription? plan,
  PaymentMethod? method,
  int due = 0,
}) => BillingAccount(
  id: 'acct-1',
  billingEmail: 'ops@example.com',
  amountDueCents: due,
  organizationId: 'org-1',
  subscription: plan,
  paymentMethod: method,
);

OperatorPlan plan() => const OperatorPlan(
  code: 'operator-standard',
  version: '2026-08',
  interval: BillingInterval.monthly,
  name: 'Dispatch Standard',
  description: 'The console, the driver app and assignment.',
  basePriceCents: 9900,
  includedSeats: 5,
  seatTiers: [
    SeatTier(upToSeats: 20, unitPriceCents: 1500),
    SeatTier(upToSeats: null, unitPriceCents: 1200),
  ],
  entitlements: ['dispatchConsole'],
  trialDays: 14,
  graceDays: 7,
);

void main() {
  testWidgets('an operator with no plan is told what happens instead', (
    tester,
  ) async {
    await pumpBilling(tester, account: account(), plans: [plan()]);

    expect(find.text('No plan'), findsOneWidget);
    // Not a nag. Without a subscription the platform takes a margin on each
    // fare, and an operator deciding whether to subscribe needs that fact.
    expect(find.textContaining('takes a margin on each fare'), findsOneWidget);
  });

  testWidgets('a plan card prices the ladder rather than one number', (
    tester,
  ) async {
    await pumpBilling(tester, account: account(), plans: [plan()]);

    expect(find.text(r'$99.00 a month'), findsOneWidget);
    expect(find.textContaining('Covers 5 driver(s)'), findsOneWidget);
    expect(find.text(r'Up to 20 drivers: $15.00 each'), findsOneWidget);
    expect(find.text(r'Beyond that: $12.00 per driver'), findsOneWidget);
    // Both are asked at the moment of subscribing rather than later.
    expect(
      find.textContaining(
        '14-day free trial. A failed payment keeps working '
        'for 7 day(s).',
      ),
      findsOneWidget,
    );
  });

  testWidgets('a subscription with no card behind it says so', (tester) async {
    await pumpBilling(tester, account: account(plan: subscription()));

    expect(find.text('No card on file.'), findsOneWidget);
    expect(
      find.textContaining('will bill a card that is not there'),
      findsOneWidget,
    );
  });

  testWidgets('a card on file is not warned about', (tester) async {
    await pumpBilling(
      tester,
      account: account(plan: subscription(), method: card),
    );

    expect(find.text('visa •••• 4242'), findsOneWidget);
    expect(
      find.textContaining('will bill a card that is not there'),
      findsNothing,
    );
  });

  testWidgets('a failed payment says the console is still working', (
    tester,
  ) async {
    await pumpBilling(
      tester,
      account: account(
        plan: subscription(status: SubscriptionStatus.pastDue),
        method: card,
      ),
    );

    expect(find.text('Payment failed'), findsOneWidget);
    // The grace window exists so somebody finds out by being told rather than
    // by a shift that stops, and the screen is where they are told.
    expect(find.textContaining('grace window'), findsOneWidget);
  });

  testWidgets('a cancelled plan says what keeps working and until when', (
    tester,
  ) async {
    await pumpBilling(
      tester,
      account: account(
        plan: subscription(cancelRequestedAt: DateTime.utc(2026, 8, 20)),
        method: card,
      ),
    );

    expect(
      find.textContaining('because that period is paid for'),
      findsOneWidget,
    );
    // Cancelling twice is not a thing, and neither is switching interval on a
    // plan that is ending.
    expect(find.text('Cancel plan'), findsNothing);
  });

  testWidgets('switching interval explains that money moves today', (
    tester,
  ) async {
    await pumpBilling(
      tester,
      account: account(plan: subscription(), method: card),
    );

    await tester.tap(find.text('Switch to yearly'));
    await tester.pumpAndSettle();

    expect(find.textContaining('a fresh period starts today'), findsOneWidget);
    expect(
      find.textContaining('carried against future renewals'),
      findsOneWidget,
    );
  });

  testWidgets('an invoice in dunning offers a way to pay it now', (
    tester,
  ) async {
    await pumpBilling(
      tester,
      account: account(plan: subscription(), method: card, due: 24900),
      invoices: [invoice(attempts: 2)],
    );

    expect(find.textContaining('Payment failed 2 time(s)'), findsOneWidget);
    expect(find.text('Pay now'), findsOneWidget);
    expect(find.textContaining(r'Outstanding: $249.00'), findsOneWidget);
  });

  testWidgets('the renewal is itemised rather than asserted', (tester) async {
    await pumpBilling(
      tester,
      account: account(plan: subscription(), method: card),
    );

    // "Why is it $249?" is answered by the lines rather than by a support
    // conversation. The quote here carries none, so the total still has to be
    // on screen.
    expect(find.text(r'$249.00'), findsWidgets);
    expect(quote().totalCents, 24900);
  });

  testWidgets('a card number is never asked for', (tester) async {
    await pumpBilling(tester, account: account(plan: subscription()));

    await tester.tap(find.text('Add a card'));
    await tester.pumpAndSettle();

    // ADR-0006: the boundary is at the client. The dialog asks for the
    // processor's token and says so, and a test asserts the promise rather
    // than trusting the copy to stay.
    expect(find.textContaining('never sees a card number'), findsOneWidget);
    expect(find.text('Processor token'), findsOneWidget);
    expect(find.textContaining('Card number'), findsNothing);
  });
}
