import 'package:carebridge_family/core/money.dart';
import 'package:carebridge_family/domain/billing.dart';
import 'package:carebridge_family/domain/subscription_pricing.dart';
import 'package:flutter_test/flutter_test.dart';

/// The client's copy of the subscription price ladder.
///
/// Every number asserted here is also asserted in
/// apps/api/src/domain/subscription-pricing.spec.ts, deliberately: the two
/// copies have to agree to the cent, and a test on only one side would let them
/// drift into showing a total that does not match the invoice.
void main() {
  const familyMonthly = SubscriptionPlan(
    code: 'family-standard',
    version: 'v1-pilot',
    payer: BillingPayer.family,
    interval: BillingInterval.monthly,
    name: 'Family plan',
    description: 'Coordination for one household.',
    basePrice: Money(2900),
    entitlements: {Entitlement.requestTransport, Entitlement.liveTracking},
    trialDays: 14,
  );

  const familyAnnual = SubscriptionPlan(
    code: 'family-standard',
    version: 'v1-pilot',
    payer: BillingPayer.family,
    interval: BillingInterval.annual,
    name: 'Family plan, annual',
    description: 'Billed yearly.',
    basePrice: Money(29000),
    entitlements: {Entitlement.requestTransport, Entitlement.liveTracking},
    trialDays: 14,
  );

  const dispatchMonthly = SubscriptionPlan(
    code: 'dispatch-core',
    version: 'v1-pilot',
    payer: BillingPayer.dispatchOrganization,
    interval: BillingInterval.monthly,
    name: 'Dispatch core',
    description: 'Priced by drivers on the road.',
    basePrice: Money(19900),
    includedSeats: 5,
    seatTiers: [
      SeatTier(upToSeats: 20, unitPriceCents: 1800),
      SeatTier(upToSeats: null, unitPriceCents: 1400),
    ],
    entitlements: {Entitlement.dispatchConsole, Entitlement.driverApp},
    trialDays: 30,
  );

  group('per-driver pricing', () {
    test('charges nothing until the included drivers are used up', () {
      expect(seatCharges(dispatchMonthly, 0), isEmpty);
      expect(seatCharges(dispatchMonthly, 5), isEmpty);
      expect(billableSeats(dispatchMonthly, 3), 0);
      expect(billableSeats(dispatchMonthly, 9), 4);
    });

    test('prices each driver in the band they fall in', () {
      // Graduated, not volume. Volume pricing makes an operator's bill fall
      // when they hire.
      final lines = seatCharges(dispatchMonthly, 25);

      expect(lines.map((l) => l.label), [
        'Drivers 6–20',
        'Drivers 21 and above',
      ]);
      expect(lines[0].quantity, 15);
      expect(lines[0].amount, const Money(27000));
      expect(lines[1].quantity, 5);
      expect(lines[1].amount, const Money(7000));
    });

    test('stops at the band the driver count lands in', () {
      expect(seatCharges(dispatchMonthly, 20).length, 1);
      expect(seatCharges(dispatchMonthly, 21).length, 2);
    });

    test('never re-prices downwards as an operator grows', () {
      var previous = -1;
      for (var seats = 0; seats <= 60; seats++) {
        final total = periodPrice(dispatchMonthly, seats).cents;
        expect(total, greaterThanOrEqualTo(previous));
        previous = total;
      }
    });

    test('refuses a negative driver count', () {
      expect(() => seatCharges(dispatchMonthly, -1), throwsArgumentError);
    });
  });

  group('quoting a period', () {
    test('itemises a family plan as one line', () {
      final quote = quoteSubscription(plan: familyMonthly);

      expect(quote.total, const Money(2900));
      expect(quote.lines.length, 1);
      expect(quote.seats, 0);
      expect(quote.interval, BillingInterval.monthly);
      expect(quote.planVersion, 'v1-pilot');
    });

    test('itemises a dispatch plan so the operator can check the bill', () {
      final quote = quoteSubscription(plan: dispatchMonthly, seats: 25);

      expect(quote.lines.map((l) => l.label), [
        'Dispatch core',
        'Drivers 6–20',
        'Drivers 21 and above',
      ]);
      expect(quote.billableSeats, 20);
      expect(quote.total, const Money(19900 + 27000 + 7000));
    });

    test('refuses to price a household by seats', () {
      expect(
        () => quoteSubscription(plan: familyMonthly, seats: 3),
        throwsArgumentError,
      );
    });

    test('treats annual as a row rather than a multiplier', () {
      // The app must never show a discount the server does not actually apply.
      expect(
        periodPrice(familyAnnual).cents,
        lessThan(periodPrice(familyMonthly).cents * 12),
      );
    });

    test('knows which plans are priced by seats', () {
      expect(dispatchMonthly.isSeatPriced, isTrue);
      expect(familyMonthly.isSeatPriced, isFalse);
    });
  });

  group('proration', () {
    final start = DateTime.utc(2026, 6, 1);
    final end = DateTime.utc(2026, 7, 1);

    test('charges the unused remainder of the period', () {
      expect(
        prorate(
          amount: const Money(3000),
          periodStart: start,
          periodEnd: end,
          effectiveAt: DateTime.utc(2026, 6, 16),
        ),
        const Money(1500),
      );
    });

    test('clamps outside the period rather than going negative', () {
      expect(
        prorate(
          amount: const Money(3000),
          periodStart: start,
          periodEnd: end,
          effectiveAt: DateTime.utc(2026, 8, 1),
        ),
        const Money(0),
      );
      expect(
        prorate(
          amount: const Money(3000),
          periodStart: start,
          periodEnd: end,
          effectiveAt: DateTime.utc(2026, 5, 1),
        ),
        const Money(3000),
      );
    });

    test('rounds the same way the server does', () {
      // Half away from zero, matching Money.times on the API side. A one-cent
      // difference between the preview and the charge is a support ticket.
      expect(
        prorate(
          amount: const Money(1),
          periodStart: start,
          periodEnd: end,
          effectiveAt: DateTime.utc(2026, 6, 16),
        ),
        const Money(1),
      );
    });

    test('refuses a period that does not move forward', () {
      expect(
        () => prorate(
          amount: const Money(100),
          periodStart: end,
          periodEnd: start,
          effectiveAt: start,
        ),
        throwsArgumentError,
      );
    });
  });
}
