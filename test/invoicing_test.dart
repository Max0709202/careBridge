import 'package:carebridge_family/domain/invoicing.dart';
import 'package:flutter_test/flutter_test.dart';

/// The client's mirror of what an invoice is. Mirrors
/// apps/api/src/domain/invoicing.spec.ts where the rules are shared, and adds
/// the two things only the client has: how a card's expiry is judged, and how
/// a failed payment is worded.

Invoice invoice({
  InvoiceStatus status = InvoiceStatus.open,
  InvoiceReason reason = InvoiceReason.subscriptionPeriod,
  int totalCents = 2900,
  int amountPaidCents = 0,
  int creditAppliedCents = 0,
  int attemptCount = 0,
  DateTime? nextAttemptAt,
}) => Invoice(
  id: 'inv_1',
  number: 'CB-001000',
  reason: reason,
  status: status,
  subtotalCents: totalCents + creditAppliedCents,
  creditAppliedCents: creditAppliedCents,
  totalCents: totalCents,
  amountPaidCents: amountPaidCents,
  lines: const [
    InvoiceLine(
      label: 'family-standard',
      quantity: 1,
      unitPriceCents: 2900,
      amountCents: 2900,
    ),
  ],
  issuedAt: DateTime.utc(2026, 6, 1),
  attemptCount: attemptCount,
  nextAttemptAt: nextAttemptAt,
);

void main() {
  group('the wire vocabulary', () {
    test('round-trips every reason', () {
      for (final reason in InvoiceReason.values) {
        expect(InvoiceReason.tryParse(reason.wire), reason);
      }
    });

    // `void` is a Dart keyword, so the enum member carries a trailing `$` and
    // the wire value does not. Getting that mapping wrong in either direction
    // silently drops every withdrawn invoice, so it is pinned both ways.
    test(
      'round-trips every status, including the one named after a keyword',
      () {
        for (final status in InvoiceStatus.values) {
          expect(InvoiceStatus.tryParse(status.wire), status);
        }
        expect(InvoiceStatus.void$.wire, 'void');
        expect(InvoiceStatus.tryParse('void'), InvoiceStatus.void$);
      },
    );

    test('drops a value it does not recognise rather than guessing', () {
      // An invoice rendered as "Paid" because the client did not recognise
      // `uncollectible` is worse than one that does not appear at all.
      expect(InvoiceStatus.tryParse('settled_somehow'), isNull);
      expect(InvoiceStatus.tryParse(null), isNull);
      expect(InvoiceReason.tryParse('something_new'), isNull);
      expect(InvoiceReason.tryParse(null), isNull);
    });

    test('labels every reason and status for a person', () {
      for (final reason in InvoiceReason.values) {
        expect(reason.label, isNotEmpty);
      }
      for (final status in InvoiceStatus.values) {
        expect(status.label, isNotEmpty);
      }
      // Deliberately not "Failed": by the time an invoice is uncollectible the
      // retries are over, and "failed" invites another attempt at a dead card.
      expect(InvoiceStatus.uncollectible.label, isNot(contains('Failed')));
    });
  });

  group('what is owed', () {
    test('is the unpaid remainder of an open invoice', () {
      expect(invoice(totalCents: 2900).amountDueCents, 2900);
      expect(
        invoice(totalCents: 2900, amountPaidCents: 900).amountDueCents,
        2000,
      );
    });

    test('is nothing once the invoice is settled, however it settled', () {
      for (final status in [
        InvoiceStatus.paid,
        InvoiceStatus.uncollectible,
        InvoiceStatus.void$,
      ]) {
        expect(invoice(status: status).amountDueCents, 0);
        expect(status.isSettled, isTrue);
        expect(status.isOutstanding, isFalse);
      }
      expect(InvoiceStatus.open.isOutstanding, isTrue);
      expect(InvoiceStatus.open.isSettled, isFalse);
    });
  });

  group('what the payer can act on', () {
    test('only an open invoice', () {
      // Retrying a paid one takes money twice; retrying an uncollectible one
      // presents a card the issuer has already refused four times.
      expect(invoice().canBePaidNow, isTrue);
      expect(invoice(status: InvoiceStatus.paid).canBePaidNow, isFalse);
      expect(
        invoice(status: InvoiceStatus.uncollectible).canBePaidNow,
        isFalse,
      );
    });

    test(
      'knows whether a retry is still coming without anyone doing anything',
      () {
        expect(invoice().hasScheduledRetry, isFalse);
        expect(
          invoice(nextAttemptAt: DateTime.utc(2026, 6, 2)).hasScheduledRetry,
          isTrue,
        );
      },
    );
  });

  group('a card on file', () {
    PaymentMethod card({int expMonth = 12, int expYear = 2026}) =>
        PaymentMethod(
          id: 'pm_1',
          brand: 'visa',
          last4: '4242',
          expMonth: expMonth,
          expYear: expYear,
          isDefault: true,
        );

    // A card marked 12/2026 works until the last day of December. Treating the
    // 1st as expired would warn a month early, every single time.
    test('is judged against the end of its expiry month, not the start', () {
      final subject = card(expMonth: 12, expYear: 2026);
      expect(subject.hasExpired(DateTime.utc(2026, 12, 1)), isFalse);
      expect(subject.hasExpired(DateTime.utc(2026, 12, 31, 23)), isFalse);
      expect(subject.hasExpired(DateTime.utc(2027, 1, 1)), isTrue);
    });

    test('warns before it lapses rather than after', () {
      // The avoidable half of dunning: a decline nobody could have predicted
      // from this screen.
      final subject = card(expMonth: 12, expYear: 2026);
      expect(subject.expiresSoon(DateTime.utc(2026, 12, 10)), isTrue);
      expect(subject.expiresSoon(DateTime.utc(2026, 6, 1)), isFalse);
    });

    test('stops calling an already-expired card "expiring soon"', () {
      final subject = card(expMonth: 1, expYear: 2020);
      expect(subject.hasExpired(DateTime.utc(2026, 6, 1)), isTrue);
      expect(subject.expiresSoon(DateTime.utc(2026, 6, 1)), isFalse);
    });

    test('names the card so its owner can tell which one is being charged', () {
      expect(card().label, contains('4242'));
      expect(card().label, contains('Visa'));

      const unknown = PaymentMethod(
        id: 'pm_2',
        brand: 'something-new',
        last4: '1111',
        expMonth: 1,
        expYear: 2030,
        isDefault: false,
      );
      expect(unknown.label, 'Card ···· 1111');
    });
  });

  group('how a failed payment is worded', () {
    // The rule: say what has **not** stopped before saying what failed. On a
    // product whose purpose is knowing an elderly relative arrived safely, a
    // message about a declined card is read as "I have lost the ability to see
    // where my mother is" — which is not what happened.
    test('leads with the reassurance while retries are still coming', () {
      final detail = DunningCopy.detail(
        invoice(),
        graceEndsAt: DateTime.utc(2026, 6, 8),
      );

      expect(detail, startsWith('Nothing has been switched off'));
      expect(detail, contains('2026-06-08'));
    });

    test('still reassures when no grace date is known', () {
      expect(
        DunningCopy.detail(invoice()),
        startsWith('Nothing has been switched off'),
      );
    });

    test('stops promising retries once there are none', () {
      final settled = invoice(status: InvoiceStatus.uncollectible);
      expect(DunningCopy.detail(settled), contains('stopped trying'));
      expect(DunningCopy.headline(settled), isNot(contains('did not go')));
    });

    test('never blames the person reading it', () {
      for (final status in [InvoiceStatus.open, InvoiceStatus.uncollectible]) {
        final subject = invoice(status: status);
        final text =
            '${DunningCopy.headline(subject)} '
            '${DunningCopy.detail(subject)}';
        expect(text.toLowerCase(), isNot(contains('you failed')));
        expect(text.toLowerCase(), isNot(contains('overdue')));
      }
    });
  });
}
