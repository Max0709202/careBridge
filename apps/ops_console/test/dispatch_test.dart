import 'package:carebridge_ops_console/domain/dispatch.dart';
import 'package:flutter_test/flutter_test.dart';

/// The console's mirror of the server's dispatch rules. Mirrors
/// apps/api/src/domain/dispatch.spec.ts and driver-status.spec.ts.
///
/// This copy decides nothing — the server asserts every assignment — so what
/// is worth testing is that it does not *disagree* with the server about which
/// controls are offered. A mirror that drifts shows a dispatcher a button the
/// API then refuses, which reads as the app being broken.
void main() {
  group('urgency', () {
    test('round-trips every band', () {
      for (final urgency in DispatchUrgency.values) {
        expect(DispatchUrgency.tryParse(urgency.wire), urgency);
      }
    });

    test('drops a band it does not recognise rather than guessing', () {
      // A row with an invented band sorts into the wrong place, and the wrong
      // place for an overdue ride is below the ones that are merely upcoming.
      expect(DispatchUrgency.tryParse('extremely_urgent'), isNull);
      expect(DispatchUrgency.tryParse(null), isNull);
    });

    test('orders overdue first, matching the server', () {
      final ordered = [...DispatchUrgency.values]
        ..sort((a, b) => a.order.compareTo(b.order));

      expect(ordered, [
        DispatchUrgency.overdue,
        DispatchUrgency.imminent,
        DispatchUrgency.soon,
        DispatchUrgency.later,
      ]);
    });

    test('treats overdue as its own thing, not the top of imminent', () {
      // A pickup time that has passed with nobody assigned is a failure
      // already in progress — somebody is standing in a hallway waiting.
      expect(DispatchUrgency.overdue.isPressing, isTrue);
      expect(DispatchUrgency.imminent.isPressing, isTrue);
      expect(DispatchUrgency.soon.isPressing, isFalse);
      expect(DispatchUrgency.later.isPressing, isFalse);
      expect(
        DispatchUrgency.overdue.label,
        isNot(DispatchUrgency.imminent.label),
      );
    });

    test('labels every band, because colour alone is not a label', () {
      for (final urgency in DispatchUrgency.values) {
        expect(urgency.label, isNotEmpty);
      }
    });
  });

  group('why a driver cannot take a trip', () {
    test('round-trips every reason the server can send', () {
      for (final reason in IneligibilityReason.values) {
        expect(IneligibilityReason.tryParse(reason.wire), reason);
      }
    });

    test('names all four, so an empty candidate list is explainable', () {
      // "Nobody is on shift" and "nobody has an accessible vehicle" need
      // different phone calls. Collapsing them turns a two-minute fix into a
      // cancelled appointment.
      expect(IneligibilityReason.values, hasLength(4));
      for (final reason in IneligibilityReason.values) {
        expect(reason.label, isNotEmpty);
      }
    });

    test('offers a remedy only where there is one', () {
      expect(IneligibilityReason.offShift.remedy, isNotNull);
      expect(IneligibilityReason.notApproved.remedy, isNotNull);
      expect(IneligibilityReason.alreadyOnARide.remedy, isNotNull);

      // Deliberately none: the answer is another vehicle, not another
      // decision, and offering "assign anyway" is exactly the affordance the
      // server refuses.
      expect(IneligibilityReason.noAccessibleVehicle.remedy, isNull);
    });
  });

  group('the driver lifecycle', () {
    test('round-trips every status', () {
      for (final status in DriverStatus.values) {
        expect(DriverStatus.tryParse(status.wire), status);
      }
      expect(DriverStatus.tryParse('probationary'), isNull);
    });

    test('only an approved driver may be assigned or occupies a seat', () {
      for (final status in DriverStatus.values) {
        final expected = status == DriverStatus.approved;
        expect(status.isAssignable, expected);
        // One definition on each side, and the server's is what bills.
        expect(status.occupiesSeat, expected);
      }
    });

    test('never offers approval straight from invited', () {
      // Approval is a decision about documents somebody submitted. An operator
      // that can approve an empty file has an onboarding control that does
      // nothing, and a driver on the road nobody checked.
      expect(
        canTransitionDriver(DriverStatus.invited, DriverStatus.approved),
        isFalse,
      );
      expect(
        canTransitionDriver(
          DriverStatus.pendingApproval,
          DriverStatus.approved,
        ),
        isTrue,
      );
    });

    test(
      'lets a suspension be lifted but never revives an offboarded driver',
      () {
        expect(
          canTransitionDriver(DriverStatus.suspended, DriverStatus.approved),
          isTrue,
        );
        for (final to in DriverStatus.values) {
          expect(canTransitionDriver(DriverStatus.offboarded, to), isFalse);
        }
        expect(DriverStatus.offboarded.isTerminal, isTrue);
        expect(DriverStatus.approved.isTerminal, isFalse);
      },
    );

    test('offers no transition out of a terminal status', () {
      expect(nextStatusesFor(DriverStatus.offboarded), isEmpty);
    });

    test('insists on a reason for the two that end somebody earning', () {
      // A suspension or an offboarding with no reason attached is
      // unanswerable three months later when the driver asks why.
      expect(transitionNeedsReason(DriverStatus.suspended), isTrue);
      expect(transitionNeedsReason(DriverStatus.offboarded), isTrue);
      expect(transitionNeedsReason(DriverStatus.approved), isFalse);
      expect(transitionNeedsReason(DriverStatus.pendingApproval), isFalse);
    });
  });
}
