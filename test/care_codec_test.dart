import 'package:carebridge_family/core/money.dart';
import 'package:carebridge_family/data/care_codec.dart';
import 'package:carebridge_family/domain/appointment_status.dart';
import 'package:carebridge_family/domain/models.dart';
import 'package:carebridge_family/domain/permissions.dart';
import 'package:carebridge_family/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_api.dart';

/// Decoding is the seam where a server change becomes a client bug, so this
/// runs against a snapshot captured from the real API rather than one written
/// to match what the decoder already expects.
void main() {
  final json = loadSnapshotFixture();

  group('care state snapshot', () {
    test('decodes the signed-in user and their care circle', () {
      final state = careStateFromJson(json);

      expect(state.isSignedIn, isTrue);
      expect(state.user!.email, 'sarah@example.com');
      expect(state.user!.initials, 'SW');
      expect(
        state.patients.map((p) => p.preferredName),
        containsAll(['Eleanor', 'Frank']),
      );
      expect(state.selectedPatient?.preferredName, 'Eleanor');
    });

    test('carries the access grant every patient-scoped screen checks', () {
      final state = careStateFromJson(json);
      final grant = state.access[Seeded.eleanor]!;

      expect(grant.isActive, isTrue);
      expect(
        grant.isPrimary,
        isTrue,
        reason: 'the organiser created the record',
      );
      expect(state.canView(Seeded.eleanor), isTrue);
      expect(
        state.can(Seeded.eleanor, FamilyPermission.requestTransport),
        isTrue,
      );

      // A patient nobody granted access to is invisible, not merely hidden.
      expect(state.canView('00000000-0000-4000-8000-0000000000aa'), isFalse);
    });

    test('keeps no date of birth anywhere in the payload', () {
      // The absence is load-bearing: name + address + DOB is the classic
      // re-identification triple. A coarse band is all the schema offers.
      final encoded = json.toString();
      expect(encoded.contains('dateOfBirth'), isFalse);
      expect(encoded.contains('dob'), isFalse);

      final eleanor = careStateFromJson(json).patientById(Seeded.eleanor)!;
      expect(eleanor.ageBand, AgeBand.from75to84);
    });

    test(
      'decodes mobility needs, including the ones that pick the vehicle',
      () {
        final state = careStateFromJson(json);
        final eleanor = state.patientById(Seeded.eleanor)!;
        final frank = state.patientById(Seeded.frank)!;

        expect(eleanor.mobilityNeeds, contains(MobilityNeed.walker));
        expect(eleanor.requiresAssistance, isTrue);
        expect(eleanor.requiresWheelchairVehicle, isFalse);

        expect(frank.requiresWheelchairVehicle, isTrue);
      },
    );

    test('decodes appointments with their status history', () {
      final state = careStateFromJson(json);
      final followUp = state.appointmentById(Seeded.followUpAppointment)!;

      expect(followUp.status, AppointmentStatus.transportationScheduled);
      expect(followUp.expectedDuration, const Duration(minutes: 45));
      expect(followUp.type, AppointmentType.followUp);
      expect(followUp.history, isNotEmpty);
      expect(followUp.history.first.from, 'draft');
      expect(followUp.endsAt.isAfter(followUp.startsAt), isTrue);
    });

    test('decodes a round trip as two linked, independently-priced legs', () {
      final state = careStateFromJson(json);
      final outbound = state.rideById(Seeded.outboundRide)!;
      final ret = state.rideById(Seeded.returnRide)!;

      expect(outbound.roundTripGroupId, isNotNull);
      expect(ret.roundTripGroupId, outbound.roundTripGroupId);
      expect(outbound.direction, RideDirection.outbound);
      expect(ret.direction, RideDirection.returnTrip);

      // The return leg's time is genuinely unknown when the outbound is booked.
      expect(ret.flexibleReturn, isTrue);
      expect(outbound.flexibleReturn, isFalse);

      // Reversed endpoints, snapshotted per leg.
      expect(ret.pickup.line1, outbound.destination.line1);
      expect(ret.destination.line1, outbound.pickup.line1);
    });

    test('reconstructs money as integer cents, never a float', () {
      final state = careStateFromJson(json);
      final estimate = state.rideById(Seeded.outboundRide)!.estimate;

      expect(estimate.total, isA<Money>());
      expect(estimate.total.cents, 3463);
      expect(estimate.total.format(), r'$34.63');
      expect(estimate.ruleVersion, 'v1-pilot');
      expect(
        estimate.surcharges.map((s) => s.label),
        contains('Door-through-door assistance'),
      );

      // Itemised, and the parts still add up to something explicable.
      final parts = estimate.base.plusAll([
        estimate.distanceCharge,
        estimate.timeCharge,
      ]);
      expect(parts.cents, lessThanOrEqualTo(estimate.total.cents));
    });

    test('a completed ride carries a timeline but no live position', () {
      final state = careStateFromJson(json);
      final past = state.rideById(Seeded.pastRide)!;

      expect(past.status, RideStatus.completed);
      expect(past.status.isTerminal, isTrue);
      expect(past.lastKnownPosition, isNull);
      expect(past.etaMinutes, isNull);
      expect(past.events.map((e) => e.title), contains('Ride completed'));
      expect(past.driver?.displayName, 'Marcus T.');
    });

    test('notification bodies name nobody and nowhere', () {
      // Enforced here as well as on the server: a phone on a kitchen table is
      // readable by whoever is in the room.
      final state = careStateFromJson(json);
      final forbidden = [
        'Eleanor',
        'Frank',
        'Whitfield',
        'Riverbend',
        'Northside',
        'Maplewood',
        'Cedarbrook',
      ];

      for (final notification in state.notifications) {
        for (final term in forbidden) {
          expect(
            notification.body.contains(term),
            isFalse,
            reason: '"${notification.body}" leaks "$term"',
          );
          expect(notification.title.contains(term), isFalse);
        }
      }
    });

    test('an empty payload decodes to the signed-out state', () {
      final state = careStateFromJson(const {});
      expect(state.isSignedIn, isFalse);
      expect(state.patients, isEmpty);
      expect(state.access, isEmpty);
    });

    test(
      'an unknown enum member falls back rather than crashing the screen',
      () {
        // A server that gains a ride status this build has never heard of must
        // not take the whole list down with it.
        final mutated = Map<String, dynamic>.from(json);
        mutated['rides'] = [
          {
            ...(json['rides'] as List).first as Map<String, dynamic>,
            'status': 'somethingAddedLater',
          },
        ];

        final state = careStateFromJson(mutated);
        expect(state.rides, hasLength(1));
        expect(state.rides.first.status, RideStatus.requested);
      },
    );
  });

  group('preview trip flag', () {
    test('is read from the snapshot, not tracked locally', () {
      expect(runningPreviewRideIds(json), isEmpty);

      final running = Map<String, dynamic>.from(json);
      running['rides'] = [
        {
          ...(json['rides'] as List).first as Map<String, dynamic>,
          'id': Seeded.outboundRide,
          'simulationActive': true,
        },
      ];
      expect(runningPreviewRideIds(running), {Seeded.outboundRide});
    });
  });

  group('encoding', () {
    test('a patient round-trips through the wire format', () {
      final eleanor = careStateFromJson(json).patientById(Seeded.eleanor)!;
      final encoded = patientToJson(eleanor);

      expect(encoded['preferredName'], 'Eleanor');
      expect(encoded['ageBand'], 'from75to84');
      expect(encoded['mobilityNeeds'], containsAll(['walker', 'escortToDoor']));
      expect(
        (encoded['homeAddress'] as Map)['accessNotes'],
        contains('Blue front door'),
      );
      expect(
        encoded.containsKey('id'),
        isFalse,
        reason: 'the server owns identity',
      );
    });

    test(
      'an address without coordinates omits them rather than sending nulls',
      () {
        const address = Address(
          label: 'Home',
          line1: '1 Test Street',
          city: 'Columbus',
          state: 'OH',
          postalCode: '43210',
        );
        final encoded = addressToJson(address);
        expect(encoded.containsKey('latitude'), isFalse);
        expect(encoded.containsKey('longitude'), isFalse);
      },
    );
  });
}

extension on Money {
  Money plusAll(List<Money> others) =>
      others.fold(this, (total, next) => total + next);
}
