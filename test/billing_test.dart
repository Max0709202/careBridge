import 'package:carebridge_family/domain/billing.dart';
import 'package:flutter_test/flutter_test.dart';

/// The client's view of a subscription.
///
/// The assertions worth having here are the parsing ones. Everything the app
/// shows about billing arrives as a string on the wire, and a value the client
/// silently mis-parses is a screen that offers a control the server then
/// refuses — which reads to the user as the app being broken, not as their
/// plan having lapsed.
void main() {
  Subscription subscription({
    SubscriptionStatus status = SubscriptionStatus.active,
    Set<Entitlement> entitlements = const {
      Entitlement.requestTransport,
      Entitlement.liveTracking,
    },
  }) => Subscription(
    id: 'sub-1',
    payer: BillingPayer.family,
    status: status,
    interval: BillingInterval.monthly,
    planCode: 'family-standard',
    planName: 'Family plan',
    planVersion: 'v1-pilot',
    seats: 0,
    currentPeriodStart: DateTime.utc(2026, 6, 1),
    currentPeriodEnd: DateTime.utc(2026, 7, 1),
    entitlements: entitlements,
    renewalTotalCents: 2900,
  );

  group('wire parsing', () {
    test('round-trips every payer, interval and status', () {
      for (final payer in BillingPayer.values) {
        expect(BillingPayer.tryParse(payer.wire), payer);
      }
      for (final interval in BillingInterval.values) {
        expect(BillingInterval.tryParse(interval.wire), interval);
      }
      for (final status in SubscriptionStatus.values) {
        expect(SubscriptionStatus.tryParse(status.wire), status);
      }
      for (final entitlement in Entitlement.values) {
        expect(Entitlement.tryParse(entitlement.wire), entitlement);
      }
    });

    test('drops a value it does not recognise rather than guessing', () {
      // A client that invents an entitlement shows a control the server
      // refuses.
      expect(Entitlement.tryParse('teleportation'), isNull);
      expect(SubscriptionStatus.tryParse(null), isNull);
      expect(BillingPayer.tryParse('someone-else'), isNull);
      expect(BillingInterval.tryParse('weekly'), isNull);
    });
  });

  group('what the app shows', () {
    test('reads entitlements rather than deriving them', () {
      // Resolved server-side from status, period and grace. Re-deriving it
      // here would be a second implementation of an authorisation rule.
      final sub = subscription();
      expect(sub.allows(Entitlement.liveTracking), isTrue);
      expect(sub.allows(Entitlement.prioritySupport), isFalse);
    });

    test('flags a failing payment without calling it switched off', () {
      // The grace window exists so a family finds out by being told, not by a
      // blank map mid-trip.
      expect(
        subscription(status: SubscriptionStatus.pastDue).needsAttention,
        isTrue,
      );
      expect(
        subscription(
          status: SubscriptionStatus.pendingCancellation,
        ).needsAttention,
        isTrue,
      );
      expect(subscription().needsAttention, isFalse);
      expect(
        subscription(status: SubscriptionStatus.trialing).isTrialing,
        isTrue,
      );
    });

    test('summarises every status in one line', () {
      for (final status in SubscriptionStatus.values) {
        expect(subscription(status: status).summary, isNotEmpty);
      }
    });

    test('labels intervals the way a person reads a price', () {
      expect(BillingInterval.monthly.cadence, 'a month');
      expect(BillingInterval.annual.cadence, 'a year');
      expect(BillingInterval.annual.label, 'Yearly');
      expect(BillingInterval.monthly.label, 'Monthly');
    });

    test('names every entitlement', () {
      for (final entitlement in Entitlement.values) {
        expect(entitlement.label, isNotEmpty);
      }
    });
  });
}
