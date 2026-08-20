import 'package:carebridge_ops_console/domain/dispatch.dart';
import 'package:carebridge_ops_console/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// The derived answers the queue screen renders.
///
/// Every one of these is a question a dispatcher asks of the screen rather
/// than of the server, so getting one wrong shows the wrong number rather
/// than causing a wrong assignment — which is exactly why they are cheap to
/// test and worth testing.

Candidate candidate({
  String id = 'driver-1',
  bool eligible = true,
  List<IneligibilityReason> reasons = const [],
  List<String> unrecognised = const [],
}) => Candidate(
  driverId: id,
  displayName: 'Marcus T.',
  eligible: eligible,
  reasons: reasons,
  unrecognisedReasons: unrecognised,
);

QueueItem item({
  String id = 'ride-1',
  String status = 'awaitingAssignment',
  DispatchUrgency urgency = DispatchUrgency.soon,
  List<Candidate> candidates = const [],
}) => QueueItem(
  rideId: id,
  status: status,
  patientName: 'Eleanor R.',
  pickupLine: '18 Rosemary Ave',
  destinationLine: 'Riverside Cardiology',
  scheduledPickupAt: DateTime.utc(2026, 6, 15, 14),
  wheelchairRequired: false,
  assistanceRequired: false,
  urgency: urgency,
  candidates: candidates,
);

void main() {
  group('a queue item', () {
    test('is stranded when nobody is eligible', () {
      final stranded = item(
        candidates: [
          candidate(eligible: false, reasons: [IneligibilityReason.offShift]),
        ],
      );
      expect(stranded.hasAnyoneAvailable, isFalse);
      expect(stranded.eligibleCandidates, isEmpty);
    });

    test('is assignable when at least one candidate is eligible', () {
      final assignable = item(
        candidates: [
          candidate(
            id: 'a',
            eligible: false,
            reasons: [IneligibilityReason.alreadyOnARide],
          ),
          candidate(id: 'b'),
        ],
      );
      expect(assignable.hasAnyoneAvailable, isTrue);
      expect(assignable.eligibleCandidates.single.driverId, 'b');
    });

    test('knows a reassignment from a first assignment', () {
      // The family timeline records that the first driver dropped it, so the
      // console must not present the two as the same action.
      expect(item(status: 'reassignmentRequired').isReassignment, isTrue);
      expect(item(status: 'awaitingAssignment').isReassignment, isFalse);
    });
  });

  group('a candidate', () {
    test('reads back every reason it was given', () {
      final subject = candidate(
        eligible: false,
        reasons: [
          IneligibilityReason.offShift,
          IneligibilityReason.noAccessibleVehicle,
        ],
      );
      expect(subject.reasonLabels, hasLength(2));
    });

    test('keeps a reason it does not recognise rather than dropping it', () {
      // Dropping it would leave the row looking merely unexplained instead of
      // unavailable, which invites a tap the server then refuses.
      final subject = candidate(
        eligible: false,
        reasons: [IneligibilityReason.offShift],
        unrecognised: ['licence_expired'],
      );
      expect(subject.reasonLabels, contains('licence_expired'));
      expect(subject.reasonLabels, hasLength(2));
    });
  });

  group('the queue as a whole', () {
    test('counts the rides that need a phone call, not a tap', () {
      final queue = DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 1,
        items: [
          item(id: 'a', candidates: [candidate()]),
          item(
            id: 'b',
            candidates: [
              candidate(
                eligible: false,
                reasons: [IneligibilityReason.offShift],
              ),
            ],
          ),
          item(id: 'c', candidates: const []),
        ],
      );

      // 'b' has a driver who cannot take it; 'c' has no roster at all. Both
      // need somebody to make a call — no amount of tapping fixes either.
      expect(queue.strandedCount, 2);
      expect(queue.isEmpty, isFalse);
    });

    test('counts the rides already past their pickup time', () {
      final queue = DispatchQueue(
        organizationId: 'org-1',
        availableDrivers: 0,
        items: [
          item(id: 'a', urgency: DispatchUrgency.overdue),
          item(id: 'b', urgency: DispatchUrgency.overdue),
          item(id: 'c', urgency: DispatchUrgency.imminent),
        ],
      );
      expect(queue.overdueCount, 2);
    });
  });

  group('a driver', () {
    Driver driver({
      DriverStatus status = DriverStatus.approved,
      bool onShift = true,
      int activeRides = 0,
    }) => Driver(
      id: 'driver-1',
      displayName: 'Marcus T.',
      status: status,
      onShift: onShift,
      rating: 4.9,
      yearsDriving: 6,
      vehicle: const Vehicle(
        id: 'v1',
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: 'OH·4KJ 219',
        isWheelchairAccessible: false,
      ),
      occupiesSeat: status == DriverStatus.approved,
      activeRideCount: activeRides,
    );

    test('is available only when approved, on shift and free', () {
      expect(driver().isAvailableNow, isTrue);
      expect(driver(status: DriverStatus.suspended).isAvailableNow, isFalse);
      expect(driver(onShift: false).isAvailableNow, isFalse);
      // One passenger at a time: a driver cannot be two places at once.
      expect(driver(activeRides: 1).isAvailableNow, isFalse);
    });

    test('describes its vehicle the way a dispatcher would say it', () {
      expect(driver().vehicle.label, 'Silver Toyota Sienna');
    });
  });

  group('seats', () {
    test('explains the gap between drivers on the road and seats billed', () {
      // Not a discrepancy: a seat granted mid-period is charged immediately by
      // proration and folded into the recurring amount at renewal.
      const summary = SeatSummary(
        organizationId: 'org-1',
        activeDrivers: 12,
        billedSeats: 10,
        renewalTotalCents: 30_500,
        ledger: [],
      );
      expect(summary.pendingAtRenewal, 2);
    });

    test('reports a release as a negative, because it is not a refund', () {
      const summary = SeatSummary(
        organizationId: 'org-1',
        activeDrivers: 8,
        billedSeats: 10,
        renewalTotalCents: null,
        ledger: [],
      );
      expect(summary.pendingAtRenewal, -2);
    });
  });
}
