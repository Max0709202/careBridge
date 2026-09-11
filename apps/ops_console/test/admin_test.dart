import 'package:carebridge_ops_console/domain/admin.dart';
import 'package:flutter_test/flutter_test.dart';

/// The derived answers the administration screens render.
///
/// Two of them are worth more than the rest. `FeatureFlag.takesAwayBy` decides
/// whether somebody is asked to confirm before a feature disappears from
/// people who have it — the server refuses an unconfirmed narrowing, so a
/// wrong answer here is either a refusal presented as an error or a
/// confirmation nobody was shown. `PlatformStats.completionRate` decides
/// whether a quiet week is reported as a quiet week or as a broken product.

PlatformStats stats({
  int rides = 0,
  int completed = 0,
  int noShow = 0,
  int cancelled = 0,
  int stale = 0,
  int awaitingReview = 0,
  int expiring = 0,
  int pastDue = 0,
  int revenue = 0,
  int refunded = 0,
}) => PlatformStats(
  ridesLast7Days: rides,
  ridesCompletedLast7Days: completed,
  ridesNoShowLast7Days: noShow,
  ridesCancelledLast7Days: cancelled,
  activeRidesNow: 0,
  staleTrackingNow: stale,
  familiesSubscribed: 0,
  operatorsSubscribed: 0,
  driversApproved: 0,
  driversWithExpiringDocuments: expiring,
  documentsAwaitingReview: awaitingReview,
  invoicesPastDue: pastDue,
  revenueCentsLast30Days: revenue,
  refundedCentsLast30Days: refunded,
);

FeatureFlag flag({bool enabled = true, int percent = 50}) => FeatureFlag(
  key: 'marketplace',
  description: 'Caregiver marketplace',
  enabled: enabled,
  rolloutPercent: percent,
  updatedAt: DateTime.utc(2026, 8, 1),
);

Refund refund({
  RefundStatus status = RefundStatus.succeeded,
  int amount = 1000,
}) => Refund(
  id: 'refund-1',
  invoiceId: 'invoice-1',
  invoiceNumber: 'INV-1',
  amountCents: amount,
  currency: 'usd',
  reason: 'Duplicate charge',
  status: status,
  requestedByName: 'Priya N.',
  createdAt: DateTime.utc(2026, 8, 2),
);

void main() {
  group('the dashboard', () {
    test('says nothing needs a person when no queue has anything in it', () {
      expect(stats(rides: 40, completed: 38).needsAttention, isFalse);
    });

    test('any one of the four queues asks for attention', () {
      expect(stats(stale: 1).needsAttention, isTrue);
      expect(stats(awaitingReview: 1).needsAttention, isTrue);
      expect(stats(expiring: 1).needsAttention, isTrue);
      expect(stats(pastDue: 1).needsAttention, isTrue);
    });

    test('a week in which nothing ended has no completion rate at all', () {
      // Not zero. "0% completed" and "no trips have finished" are different
      // facts, and printing the first for the second reports a quiet week as
      // a broken product.
      expect(stats(rides: 3).completionRate, isNull);
    });

    test('completion is measured against everything that ended', () {
      final rate = stats(completed: 6, noShow: 2, cancelled: 2).completionRate;
      expect(rate, closeTo(0.6, 0.0001));
    });

    test('what was kept is what settled less what went back', () {
      expect(
        stats(revenue: 500000, refunded: 25000).netRevenueCentsLast30Days,
        475000,
      );
    });
  });

  group('a feature flag', () {
    test(
      'says what it is doing rather than leaving two numbers to combine',
      () {
        expect(flag(enabled: false).summary, 'Off for everybody');
        expect(flag(percent: 100).summary, 'On for everybody');
        expect(flag(percent: 0).summary, 'On, but rolled out to nobody');
        expect(flag(percent: 25).summary, 'On for 25% of subjects');
      },
    );

    test('widening takes nothing away', () {
      expect(
        flag(percent: 50).takesAwayBy(nextEnabled: true, nextPercent: 80),
        isFalse,
      );
    });

    test('narrowing takes the feature away from people who have it', () {
      expect(
        flag(percent: 50).takesAwayBy(nextEnabled: true, nextPercent: 10),
        isTrue,
      );
    });

    test('switching the master off is the widest narrowing there is', () {
      // The one people reach for in a hurry, and the one that removes the
      // feature from everybody at once. Confirmed for the same reason.
      expect(
        flag(percent: 100).takesAwayBy(nextEnabled: false, nextPercent: 100),
        isTrue,
      );
    });

    test('a flag already off takes nothing away, whatever it moves to', () {
      expect(
        flag(
          enabled: false,
          percent: 90,
        ).takesAwayBy(nextEnabled: false, nextPercent: 0),
        isFalse,
      );
    });
  });

  group('an audit row', () {
    test('names the system when nobody did it', () {
      final entry = AuditEntry(
        id: 'a',
        at: DateTime.utc(2026, 8, 3),
        action: 'billing.period_renewed',
        entityType: 'Subscription',
        changedFields: const [],
      );
      expect(entry.isSystem, isTrue);
      expect(entry.actorLabel, 'CareBridge');
    });

    test('names the person when one did it', () {
      final entry = AuditEntry(
        id: 'a',
        at: DateTime.utc(2026, 8, 3),
        action: 'driver.approved',
        entityType: 'Driver',
        changedFields: const ['status'],
        actorUserId: 'user-1',
        actorName: 'Priya N.',
      );
      expect(entry.actorLabel, 'Priya N.');
      expect(entry.isSystem, isFalse);
    });
  });

  group('a filter', () {
    test('two identical filters are the same key', () {
      // Value equality is what makes two readers asking the same question one
      // request rather than two.
      expect(
        const AuditFilter(action: 'driver.'),
        const AuditFilter(action: 'driver.'),
      );
    });

    test('blank fields count as no filter at all', () {
      expect(const AuditFilter(action: '', entityType: '').isEmpty, isTrue);
      expect(const AuditFilter(action: 'ride.').isEmpty, isFalse);
    });
  });

  group('a refundable invoice', () {
    test('what was refunded is the payment less what is left', () {
      const invoice = RefundableInvoice(
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-1',
        paymentId: 'payment-1',
        paidCents: 5000,
        refundableCents: 2000,
        refunds: [],
      );
      expect(invoice.refundedCents, 3000);
      expect(invoice.isFullyRefunded, isFalse);
    });

    test('nothing left means nothing more may be sent back', () {
      final invoice = RefundableInvoice(
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-1',
        paymentId: 'payment-1',
        paidCents: 5000,
        refundableCents: 0,
        refunds: [refund(amount: 5000)],
      );
      expect(invoice.isFullyRefunded, isTrue);
    });

    test('a pending refund is money that may still be moving', () {
      // Surfaced rather than counted as done: issuing a second refund on top
      // of one in flight is how an account gets credited twice.
      final invoice = RefundableInvoice(
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-1',
        paymentId: 'payment-1',
        paidCents: 5000,
        refundableCents: 4000,
        refunds: [refund(status: RefundStatus.pending, amount: 1000)],
      );
      expect(invoice.hasInFlightRefund, isTrue);
    });

    test('a failed refund is not in flight', () {
      final invoice = RefundableInvoice(
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-1',
        paymentId: 'payment-1',
        paidCents: 5000,
        refundableCents: 5000,
        refunds: [refund(status: RefundStatus.failed)],
      );
      expect(invoice.hasInFlightRefund, isFalse);
    });
  });
}
