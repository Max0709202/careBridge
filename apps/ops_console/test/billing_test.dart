import 'package:carebridge_ops_console/core/money.dart';
import 'package:carebridge_ops_console/domain/billing.dart';
import 'package:flutter_test/flutter_test.dart';

/// The answers the operator billing screen renders without asking the server.
///
/// None of them authorise anything — entitlements are resolved server-side and
/// read here. What they decide is what an operator is *told*, and two of those
/// are the ones worth guarding: that a subscription about to bill a card which
/// is not there says so before the renewal rather than after, and that an
/// invoice nothing will retry still offers a way to pay it.

BillingQuote quote({int total = 24900}) => BillingQuote(
  planCode: 'operator-standard',
  interval: BillingInterval.monthly,
  seats: 11,
  billableSeats: 6,
  lines: const [],
  totalCents: total,
);

OperatorSubscription subscription({
  SubscriptionStatus status = SubscriptionStatus.active,
  DateTime? cancelRequestedAt,
}) => OperatorSubscription(
  id: 'sub-1',
  status: status,
  interval: BillingInterval.monthly,
  planCode: 'operator-standard',
  planName: 'Dispatch Standard',
  seats: 11,
  currentPeriodStart: DateTime.utc(2026, 8),
  currentPeriodEnd: DateTime.utc(2026, 9),
  entitlements: const ['dispatchConsole'],
  renewalQuote: quote(),
  carriedCreditCents: 0,
  cancelRequestedAt: cancelRequestedAt,
);

Invoice invoice({
  InvoiceStatus status = InvoiceStatus.open,
  int attempts = 0,
}) => Invoice(
  id: 'invoice-1',
  number: 'INV-24',
  reason: InvoiceReason.subscriptionPeriod,
  status: status,
  subtotalCents: 24900,
  creditAppliedCents: 0,
  totalCents: 24900,
  amountPaidCents: 0,
  lines: const [],
  issuedAt: DateTime.utc(2026, 8),
  attemptCount: attempts,
);

const card = PaymentMethod(
  id: 'pm-1',
  brand: 'visa',
  last4: '4242',
  expMonth: 6,
  expYear: 2026,
  isDefault: true,
);

void main() {
  group('money', () {
    test('is formatted from cents and never from a double', () {
      expect(formatCents(24900), r'$249.00');
      expect(formatCents(5), r'$0.05');
      expect(formatCents(0), r'$0.00');
    });

    test('a credit keeps its sign in front of the currency', () {
      expect(formatCents(-1250), r'-$12.50');
    });
  });

  group('an unknown wire value', () {
    test('is dropped rather than guessed at', () {
      // An invoice rendered as "Paid" because this build did not recognise a
      // status is a bill somebody believes is settled.
      expect(InvoiceStatus.tryParse('something_new'), isNull);
      expect(SubscriptionStatus.tryParse('grandfathered'), isNull);
      expect(BillingInterval.tryParse('weekly'), isNull);
    });

    test('void survives being a Dart keyword without changing on the wire', () {
      expect(InvoiceStatus.tryParse('void'), InvoiceStatus.void$);
    });
  });

  group('an invoice', () {
    test('open and never attempted has not failed', () {
      expect(invoice().hasFailed, isFalse);
    });

    test('open after an attempt is in dunning', () {
      expect(invoice(attempts: 2).hasFailed, isTrue);
    });

    test('paid is never in dunning, whatever it took to get there', () {
      expect(
        invoice(status: InvoiceStatus.paid, attempts: 3).hasFailed,
        isFalse,
      );
    });

    test('uncollectible can still be paid by hand', () {
      // The retries stopped; the money is still owed. Somebody with a new card
      // should not have to telephone anybody to use it.
      expect(invoice(status: InvoiceStatus.uncollectible).isPayable, isTrue);
    });

    test('a cancelled invoice is not payable', () {
      expect(invoice(status: InvoiceStatus.void$).isPayable, isFalse);
    });
  });

  group('a card', () {
    test('is spent the moment its month is over', () {
      expect(card.hasExpired(DateTime.utc(2026, 6, 30)), isFalse);
      expect(card.hasExpired(DateTime.utc(2026, 7, 1)), isTrue);
    });

    test('shows four digits and a brand, because that is all there is', () {
      expect(card.label, 'visa •••• 4242');
    });
  });

  group('an account', () {
    test('a plan with no card is called out before the renewal, not after', () {
      final account = BillingAccount(
        id: 'acct-1',
        billingEmail: 'ops@example.com',
        amountDueCents: 0,
        subscription: subscription(),
      );
      expect(account.willBillWithoutACard, isTrue);
    });

    test('no plan and no card is not a warning, it is just no plan', () {
      const account = BillingAccount(
        id: 'acct-1',
        billingEmail: 'ops@example.com',
        amountDueCents: 0,
      );
      expect(account.hasSubscription, isFalse);
      expect(account.willBillWithoutACard, isFalse);
    });
  });

  group('a subscription', () {
    test('past due asks for attention', () {
      expect(SubscriptionStatus.pastDue.needsAttention, isTrue);
    });

    test('a pending cancellation does not, because it was a decision', () {
      expect(SubscriptionStatus.pendingCancellation.needsAttention, isFalse);
      expect(
        subscription(cancelRequestedAt: DateTime.utc(2026, 8, 20)).isCancelling,
        isTrue,
      );
    });
  });
}
