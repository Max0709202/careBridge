import 'package:carebridge_family/core/money.dart';
import 'package:carebridge_family/domain/pricing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final rule = PricingRule.standard();

  group('Money', () {
    test('formats dollars and cents', () {
      expect(const Money(1200).format(), r'$12.00');
      expect(const Money(1834).format(), r'$18.34');
      expect(const Money(5).format(), r'$0.05');
      expect(const Money(-250).format(), r'-$2.50');
    });

    test('stays exact across the additions a fare is built from', () {
      // The float version of this (0.1 + 0.2) is famously not 0.3.
      var total = const Money.zero();
      for (var i = 0; i < 10; i++) {
        total = total + const Money(10);
      }
      expect(total.cents, 100);
    });

    test('rounds once, at multiplication', () {
      expect((const Money(225) * 2.4).cents, 540);
      expect(
        (const Money(225) * 0.5).cents,
        113,
      ); // 112.5 rounds away from zero
    });
  });

  group('fare estimation', () {
    test('adds base, distance and time', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 4,
        durationMinutes: 16,
      );

      expect(estimate.base, const Money(1200));
      expect(estimate.distanceCharge, const Money(900)); // 4 × $2.25
      expect(estimate.timeCharge, const Money(720)); // 16 × $0.45
      expect(estimate.total, const Money(2820));
      expect(estimate.minimumApplied, isFalse);
    });

    test('applies the minimum fare on a very short trip', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 0.2,
        durationMinutes: 2,
      );

      expect(estimate.total, rule.minimumFare);
      expect(estimate.minimumApplied, isTrue);
    });

    test('itemises the accessible-vehicle surcharge rather than hiding it', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 4,
        durationMinutes: 16,
        wheelchairAccessRequired: true,
      );

      expect(estimate.surcharges, hasLength(1));
      expect(estimate.surcharges.first.label, contains('Wheelchair'));
      expect(estimate.surcharges.first.amount, const Money(1500));
      expect(estimate.total, const Money(4320));
    });

    test('adds both surcharges when both apply', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 4,
        durationMinutes: 16,
        wheelchairAccessRequired: true,
        assistanceRequired: true,
      );

      expect(estimate.surcharges, hasLength(2));
      expect(estimate.total, const Money(5120));
    });

    test('records the rule version so a charge can always be explained', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 1,
        durationMinutes: 5,
      );
      expect(estimate.ruleVersion, rule.version);
    });

    test('rejects negative inputs', () {
      expect(
        () => estimateFare(rule: rule, distanceMiles: -1, durationMinutes: 5),
        throwsArgumentError,
      );
      expect(
        () => estimateFare(rule: rule, distanceMiles: 1, durationMinutes: -5),
        throwsArgumentError,
      );
    });

    test('a zero-distance quote falls back to the minimum, not to zero', () {
      final estimate = estimateFare(
        rule: rule,
        distanceMiles: 0,
        durationMinutes: 0,
      );
      expect(estimate.total, rule.minimumFare);
    });

    test('rounds identically to the server, to the cent', () {
      // The server is authoritative for fares, but the app renders the same
      // itemised figures from the same integers. These cases are pinned in
      // apps/api/src/domain/pricing.spec.ts as well: a one-cent disagreement
      // would surface as a total that does not match its own line items.
      //
      // 225 × 4.1 is 922.4999… in binary floating point, not 922.5, so it
      // rounds *down* — the intuitive answer is the wrong one here.
      expect((const Money(225) * 4.1).cents, 922);
      expect((const Money(45) * 17).cents, 765);

      // Dart's `num.round()` goes half away from zero, which is what the
      // server's helper reimplements. `Math.round` alone would not.
      expect((const Money(100) * 0.005).cents, 1);
      expect((const Money(-100) * 0.005).cents, -1);
      expect((const Money(1) * 0.5).cents, 1);
      expect((const Money(-1) * 0.5).cents, -1);
    });
  });
}
