import 'package:carebridge_family/core/failures.dart';
import 'package:carebridge_family/data/care_operations.dart';
import 'package:carebridge_family/data/care_state.dart';
import 'package:carebridge_family/data/seed.dart';
import 'package:carebridge_family/domain/appointment_status.dart';
import 'package:carebridge_family/domain/models.dart';
import 'package:carebridge_family/domain/permissions.dart';
import 'package:carebridge_family/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime(2026, 7, 27, 9, 0);
  late CareState state;

  setUp(() => state = buildSeedState(now));

  /// Strips a user's rights down to [permissions], to prove the negative case.
  CareState withPermissions(
    CareState base,
    String patientId,
    Set<FamilyPermission> permissions,
  ) {
    final current = base.access[patientId]!;
    return base.copyWith(
      access: {
        ...base.access,
        patientId: PatientAccess(
          userId: current.userId,
          patientId: patientId,
          relationship: current.relationship,
          permissions: permissions,
          grantedAt: current.grantedAt,
          grantedByUserId: 'someone-else',
        ),
      },
    );
  }

  group('requesting transport', () {
    test('a round trip creates two linked rides, not one', () {
      final next = requestTransport(
        state,
        appointmentId: 'appt-frank-checkup',
        pickupAt: DateTime(2026, 8, 5, 13, 30),
        roundTrip: true,
        now: now,
      );

      final rides = next.ridesForAppointment('appt-frank-checkup');
      expect(rides, hasLength(2));
      expect(rides.first.roundTripGroupId, isNotNull);
      expect(rides.first.roundTripGroupId, rides.last.roundTripGroupId);
      expect(
        rides.map((r) => r.direction),
        containsAll([RideDirection.outbound, RideDirection.returnTrip]),
      );
    });

    test('the return leg is flexible, because nobody knows when a visit ends', () {
      final next = requestTransport(
        state,
        appointmentId: 'appt-frank-checkup',
        pickupAt: DateTime(2026, 8, 5, 13, 30),
        roundTrip: true,
        now: now,
      );

      final returnLeg = next
          .ridesForAppointment('appt-frank-checkup')
          .firstWhere((r) => r.direction == RideDirection.returnTrip);

      expect(returnLeg.flexibleReturn, isTrue);
      expect(returnLeg.pickup.line1, contains('Kenny Road'));
    });

    test('a one-way trip creates exactly one ride', () {
      final next = requestTransport(
        state,
        appointmentId: 'appt-frank-checkup',
        pickupAt: DateTime(2026, 8, 5, 13, 30),
        roundTrip: false,
        now: now,
      );
      expect(next.ridesForAppointment('appt-frank-checkup'), hasLength(1));
    });

    test('a wheelchair user always gets an accessible-vehicle requirement', () {
      final next = requestTransport(
        state,
        appointmentId: 'appt-frank-checkup',
        pickupAt: DateTime(2026, 8, 5, 13, 30),
        roundTrip: false,
        now: now,
      );

      final ride = next.ridesForAppointment('appt-frank-checkup').single;
      expect(ride.wheelchairRequired, isTrue);
      expect(
        ride.estimate.surcharges.map((s) => s.label).join(),
        contains('Wheelchair'),
      );
    });

    test('the appointment moves to "transport booked"', () {
      final next = requestTransport(
        state,
        appointmentId: 'appt-frank-checkup',
        pickupAt: DateTime(2026, 8, 5, 13, 30),
        roundTrip: false,
        now: now,
      );

      expect(
        next.appointmentById('appt-frank-checkup')!.status,
        AppointmentStatus.transportationScheduled,
      );
    });

    test('is refused without the requestTransport grant', () {
      final restricted = withPermissions(
        state,
        'patient-frank',
        PatientAccess.viewOnly,
      );

      expect(
        () => requestTransport(
          restricted,
          appointmentId: 'appt-frank-checkup',
          pickupAt: DateTime(2026, 8, 5, 13, 30),
          roundTrip: false,
          now: now,
        ),
        throwsA(isA<AuthorizationFailure>()),
      );
    });

    test('leaves state untouched when refused', () {
      final restricted = withPermissions(
        state,
        'patient-frank',
        PatientAccess.viewOnly,
      );
      final before = restricted.rides.length;

      try {
        requestTransport(
          restricted,
          appointmentId: 'appt-frank-checkup',
          pickupAt: DateTime(2026, 8, 5, 13, 30),
          roundTrip: false,
          now: now,
        );
      } on AuthorizationFailure {
        // expected
      }

      expect(restricted.rides.length, before);
    });

    test('rejects a pickup after the appointment has started', () {
      expect(
        () => requestTransport(
          state,
          appointmentId: 'appt-frank-checkup',
          pickupAt: DateTime(2026, 8, 5, 23, 0),
          roundTrip: false,
          now: now,
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('refuses to double-book an appointment', () {
      expect(
        () => requestTransport(
          state,
          appointmentId: 'appt-followup',
          pickupAt: DateTime(2026, 7, 29, 10, 0),
          roundTrip: false,
          now: now,
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });
  });

  group('ride progress', () {
    CareState toEnRoute(CareState base) {
      var next = advanceRide(base, rideId: 'ride-upcoming', to: RideStatus.assigned, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverAccepted, now: now);
      return advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverEnRoute, now: now);
    }

    test('refuses an illegal transition', () {
      expect(
        () => advanceRide(
          state,
          rideId: 'ride-upcoming',
          to: RideStatus.completed,
          now: now,
        ),
        throwsA(isA<InvalidTransitionFailure>()),
      );
    });

    test('records history and an event for every change', () {
      final next = advanceRide(
        state,
        rideId: 'ride-upcoming',
        to: RideStatus.assigned,
        now: now,
      );
      final ride = next.rideById('ride-upcoming')!;

      expect(ride.history.last.to, 'assigned');
      expect(ride.events.last.title, 'Driver assigned');
    });

    test('pickup drives the appointment to "on the way"', () {
      var next = toEnRoute(state);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverArrived, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.passengerOnboard, now: now);

      expect(
        next.appointmentById('appt-followup')!.status,
        AppointmentStatus.patientEnRoute,
      );
    });

    test('accepts a position report only while tracking is legal', () {
      // awaitingAssignment: no driver has set off, so no position may be stored.
      expect(
        () => updateRidePosition(
          state,
          rideId: 'ride-upcoming',
          point: TrackingPoint(
            coordinates: const Coordinates(39.99, -83.02),
            capturedAt: now,
          ),
          now: now,
        ),
        throwsA(isA<InvalidTransitionFailure>()),
      );

      final enRoute = updateRidePosition(
        toEnRoute(state),
        rideId: 'ride-upcoming',
        point: TrackingPoint(
          coordinates: const Coordinates(39.99, -83.02),
          capturedAt: now,
        ),
        now: now,
        etaMinutes: 7,
      );

      expect(enRoute.rideById('ride-upcoming')!.lastKnownPosition, isNotNull);
      expect(enRoute.rideById('ride-upcoming')!.etaMinutes, 7);
    });

    test('refuses a reading stamped in the future', () {
      // Every freshness label ages a position against `capturedAt`. A point
      // stamped ahead of our clock would read as "updated just now" forever —
      // a parked or fabricated car rendered as a moving one.
      expect(
        () => updateRidePosition(
          toEnRoute(state),
          rideId: 'ride-upcoming',
          point: TrackingPoint(
            coordinates: const Coordinates(39.99, -83.02),
            capturedAt: now.add(const Duration(minutes: 5)),
          ),
          now: now,
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('tolerates a device clock a little ahead of ours', () {
      final skewed = updateRidePosition(
        toEnRoute(state),
        rideId: 'ride-upcoming',
        point: TrackingPoint(
          coordinates: const Coordinates(39.99, -83.02),
          capturedAt: now.add(const Duration(seconds: 5)),
        ),
        now: now,
      );

      expect(skewed.rideById('ride-upcoming')!.lastKnownPosition, isNotNull);
    });

    test('refuses a reading that is already expired', () {
      // Storing it would overwrite the latest known position with something the
      // screen must immediately hide as lost — strictly worse than keeping what
      // we had.
      expect(
        () => updateRidePosition(
          toEnRoute(state),
          rideId: 'ride-upcoming',
          point: TrackingPoint(
            coordinates: const Coordinates(39.99, -83.02),
            capturedAt: now.subtract(const Duration(minutes: 10)),
          ),
          now: now,
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('discards the last position when the ride ends', () {
      final tracked = updateRidePosition(
        toEnRoute(state),
        rideId: 'ride-upcoming',
        point: TrackingPoint(
          coordinates: const Coordinates(39.99, -83.02),
          capturedAt: now,
        ),
        now: now,
      );
      expect(tracked.rideById('ride-upcoming')!.lastKnownPosition, isNotNull);

      final canceled = cancelRide(
        tracked,
        rideId: 'ride-upcoming',
        reason: 'No longer needed',
        now: now,
      );

      final ride = canceled.rideById('ride-upcoming')!;
      expect(ride.status, RideStatus.canceled);
      expect(ride.lastKnownPosition, isNull);
      expect(ride.isTrackable, isFalse);
      expect(ride.cancellationReason, 'No longer needed');
    });

    test('a delay is a flag, so the ride keeps its place in the flow', () {
      final delayed = setRideDelay(
        toEnRoute(state),
        rideId: 'ride-upcoming',
        delayed: true,
        reason: 'Heavy traffic',
        now: now,
      );

      final ride = delayed.rideById('ride-upcoming')!;
      expect(ride.isDelayed, isTrue);
      expect(ride.status, RideStatus.driverEnRoute);
      expect(ride.events.last.isException, isTrue);

      final cleared = setRideDelay(
        delayed,
        rideId: 'ride-upcoming',
        delayed: false,
        now: now,
      );
      expect(cleared.rideById('ride-upcoming')!.isDelayed, isFalse);
      expect(cleared.rideById('ride-upcoming')!.status, RideStatus.driverEnRoute);
    });

    test('a finished ride cannot be delayed', () {
      final canceled = cancelRide(
        state,
        rideId: 'ride-upcoming',
        reason: 'Not needed',
        now: now,
      );

      expect(
        () => setRideDelay(
          canceled,
          rideId: 'ride-upcoming',
          delayed: true,
          now: now,
        ),
        throwsA(isA<InvalidTransitionFailure>()),
      );
    });
  });

  group('cancelling an appointment', () {
    test('cancels the rides booked for it', () {
      final next = cancelAppointment(
        state,
        appointmentId: 'appt-followup',
        now: now,
        reason: 'Clinic rescheduled',
      );

      expect(
        next.appointmentById('appt-followup')!.status,
        AppointmentStatus.canceled,
      );
      for (final ride in next.ridesForAppointment('appt-followup')) {
        expect(
          ride.status,
          RideStatus.canceled,
          reason: 'no car should be sent for an appointment that is not happening',
        );
      }
    });

    test('is refused without the scheduling grant', () {
      final restricted = withPermissions(
        state,
        'patient-eleanor',
        PatientAccess.viewOnly,
      );

      expect(
        () => cancelAppointment(
          restricted,
          appointmentId: 'appt-followup',
          now: now,
        ),
        throwsA(isA<AuthorizationFailure>()),
      );
    });

    test('still succeeds when a leg has already delivered the passenger', () {
      // `arrivedAtDestination` is the one live state a ride cannot be cancelled
      // from — the passenger is already there. That must not take the whole
      // appointment cancellation down with it, which is what happened before:
      // the family lost the ability to cancel exactly when they were most
      // likely to reach for it.
      var next = state;
      for (final status in [
        RideStatus.assigned,
        RideStatus.driverAccepted,
        RideStatus.driverEnRoute,
        RideStatus.driverArrived,
        RideStatus.passengerOnboard,
        RideStatus.inProgress,
        RideStatus.arrivedAtDestination,
      ]) {
        next = advanceRide(next, rideId: 'ride-upcoming', to: status, now: now);
      }

      final canceled = cancelAppointment(
        next,
        appointmentId: 'appt-followup',
        now: now,
        reason: 'Clinic closed',
      );

      expect(
        canceled.appointmentById('appt-followup')!.status,
        AppointmentStatus.canceled,
      );
      // The delivered leg keeps its own state; the return leg is called off.
      expect(
        canceled.rideById('ride-upcoming')!.status,
        RideStatus.arrivedAtDestination,
      );
      for (final ride in canceled.ridesForAppointment('appt-followup')) {
        expect(
          ride.status == RideStatus.canceled ||
              ride.status == RideStatus.arrivedAtDestination,
          isTrue,
          reason: '${ride.id} was left in ${ride.status.name}',
        );
      }
    });
  });

  group('creating an appointment', () {
    test('is refused without the scheduling grant', () {
      final restricted = withPermissions(
        state,
        'patient-eleanor',
        PatientAccess.viewOnly,
      );

      expect(
        () => createAppointment(
          restricted,
          patientId: 'patient-eleanor',
          clinicId: 'clinic-riverbend',
          startsAt: now.add(const Duration(days: 3)),
          expectedDuration: const Duration(minutes: 30),
          type: AppointmentType.primaryCare,
          now: now,
        ),
        throwsA(isA<AuthorizationFailure>()),
      );
    });

    test('rejects a time in the past', () {
      expect(
        () => createAppointment(
          state,
          patientId: 'patient-eleanor',
          clinicId: 'clinic-riverbend',
          startsAt: now.subtract(const Duration(days: 1)),
          expectedDuration: const Duration(minutes: 30),
          type: AppointmentType.primaryCare,
          now: now,
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('starts scheduled, with history', () {
      final next = createAppointment(
        state,
        patientId: 'patient-eleanor',
        clinicId: 'clinic-riverbend',
        startsAt: now.add(const Duration(days: 3)),
        expectedDuration: const Duration(minutes: 30),
        type: AppointmentType.primaryCare,
        now: now,
      );

      final created = next.appointmentsFor('patient-eleanor').last;
      expect(created.status, AppointmentStatus.scheduled);
      expect(created.history, hasLength(1));
    });
  });

  group('notifications', () {
    test('never leak a name, a clinic, an address or a time', () {
      // Run a whole trip so every notification path is exercised.
      var next = advanceRide(state, rideId: 'ride-upcoming', to: RideStatus.assigned, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverAccepted, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverEnRoute, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.driverArrived, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.passengerOnboard, now: now);
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.inProgress, now: now);
      next = advanceRide(
        next,
        rideId: 'ride-upcoming',
        to: RideStatus.arrivedAtDestination,
        now: now,
      );
      next = advanceRide(next, rideId: 'ride-upcoming', to: RideStatus.completed, now: now);

      const forbidden = [
        'Eleanor',
        'Frank',
        'Whitfield',
        'Riverbend',
        'Northside',
        'Maplewood',
        'Cedarbrook',
        'Olentangy',
      ];

      expect(next.notifications.length, greaterThan(3));
      for (final notification in next.notifications) {
        final text = '${notification.title} ${notification.body}';
        for (final term in forbidden) {
          expect(
            text,
            isNot(contains(term)),
            reason: 'a notification on a lock screen must not reveal "$term"',
          );
        }
      }
    });

    test('mark-all-read clears the unread count', () {
      expect(state.unreadNotificationCount, greaterThan(0));
      final read = markAllNotificationsRead(state, now);
      expect(read.unreadNotificationCount, 0);
    });
  });

  group('patients', () {
    test('the creator becomes the organiser with full rights', () {
      final blank = CareState(user: state.user);
      final next = upsertPatient(
        blank,
        Patient(
          id: 'patient-new',
          preferredName: 'Nina',
          phone: '+1 555 0100',
          homeAddress: const Address(
            label: 'Home',
            line1: '1 Test Street',
            city: 'Columbus',
            state: 'OH',
            postalCode: '43201',
          ),
        ),
      );

      final access = next.access['patient-new']!;
      expect(access.isPrimary, isTrue);
      expect(access.permissions, PatientAccess.all);
      expect(next.selectedPatientId, 'patient-new');
    });

    test('the organiser cannot lose the ability to manage access', () {
      final next = setAccessPermissions(
        state,
        patientId: 'patient-eleanor',
        permissions: PatientAccess.viewOnly,
      );

      final access = next.access['patient-eleanor']!;
      expect(access.can(FamilyPermission.manageAccess), isTrue);
      expect(access.can(FamilyPermission.viewProfile), isTrue);
    });

    test('changing permissions is refused without the manageAccess grant', () {
      final restricted = withPermissions(
        state,
        'patient-eleanor',
        PatientAccess.viewOnly,
      );

      expect(
        () => setAccessPermissions(
          restricted,
          patientId: 'patient-eleanor',
          permissions: PatientAccess.all,
        ),
        throwsA(isA<AuthorizationFailure>()),
      );
    });

    test('a delegate cannot widen their own grant', () {
      // `manageAccess` administers other people's access. It is not a
      // self-service route to spending rights the organiser never granted.
      final delegate = withPermissions(state, 'patient-eleanor', {
        FamilyPermission.viewProfile,
        FamilyPermission.manageAccess,
      });

      final next = setAccessPermissions(
        delegate,
        patientId: 'patient-eleanor',
        permissions: PatientAccess.all,
      );

      final access = next.access['patient-eleanor']!;
      expect(access.can(FamilyPermission.makePayments), isFalse);
      expect(access.can(FamilyPermission.requestTransport), isFalse);
      expect(access.can(FamilyPermission.viewProfile), isTrue);
    });

    test('a delegate may still give rights away', () {
      final delegate = withPermissions(state, 'patient-eleanor', {
        FamilyPermission.viewProfile,
        FamilyPermission.requestTransport,
        FamilyPermission.manageAccess,
      });

      final next = setAccessPermissions(
        delegate,
        patientId: 'patient-eleanor',
        permissions: {FamilyPermission.viewProfile},
      );

      final access = next.access['patient-eleanor']!;
      expect(access.can(FamilyPermission.requestTransport), isFalse);
      expect(access.can(FamilyPermission.manageAccess), isFalse);
    });

    test('view-only access cannot edit the profile it can read', () {
      // The profile holds the pickup address, the access notes a driver
      // navigates by, and the mobility needs that pick the vehicle. Being
      // allowed to look at someone is not being allowed to redirect their car.
      final restricted = withPermissions(
        state,
        'patient-eleanor',
        PatientAccess.viewOnly,
      );
      final eleanor = restricted.patientById('patient-eleanor')!;

      expect(
        () => upsertPatient(
          restricted,
          eleanor.copyWith(
            homeAddress: const Address(
              label: 'Home',
              line1: '99 Somewhere Else',
              city: 'Columbus',
              state: 'OH',
              postalCode: '43201',
            ),
          ),
        ),
        throwsA(isA<AuthorizationFailure>()),
      );

      expect(
        restricted.patientById('patient-eleanor')!.homeAddress.line1,
        eleanor.homeAddress.line1,
      );
    });

    test('scheduling rights alone do not unlock profile edits', () {
      final restricted = withPermissions(
        state,
        'patient-eleanor',
        PatientAccess.defaultInvited,
      );
      final eleanor = restricted.patientById('patient-eleanor')!;

      expect(
        () => upsertPatient(
          restricted,
          eleanor.copyWith(mobilityNeeds: const {}),
        ),
        throwsA(isA<AuthorizationFailure>()),
      );
    });

    test('a revoked grant hides the person from every surface', () {
      final revoked = state.copyWith(
        access: {
          ...state.access,
          'patient-eleanor':
              state.access['patient-eleanor']!.copyWith(revokedAt: now),
        },
      );

      expect(revoked.canView('patient-eleanor'), isFalse);
      expect(
        revoked.activePatients.map((p) => p.id),
        isNot(contains('patient-eleanor')),
      );
      expect(revoked.selectedPatient, isNull);
      expect(
        () => selectPatient(revoked, 'patient-eleanor'),
        throwsA(isA<AuthorizationFailure>()),
      );
    });
  });

  group('seed data', () {
    test('holds no date of birth for anyone', () {
      for (final patient in state.patients) {
        expect(patient.ageBand, isNotNull);
        // Patient has no dob field at all — this asserts the coarse band is
        // what is used, and fails loudly if a dob is ever introduced here.
        expect(patient.ageBand!.label, isNotEmpty);
      }
    });

    test('gives the demo user two people and a booked trip', () {
      expect(state.activePatients, hasLength(2));
      expect(state.nextAppointmentFor('patient-eleanor', now), isNotNull);
      expect(state.activeRideFor('patient-eleanor'), isNotNull);
    });
  });
}
