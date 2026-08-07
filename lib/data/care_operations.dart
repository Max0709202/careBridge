/// Business rules, as pure functions `CareState -> CareState`.
///
/// Three invariants hold for every operation in this file:
///
/// 1. **Permission is checked before anything changes.** A caller that lacks the
///    grant gets [AuthorizationFailure] and the state is untouched.
/// 2. **Status changes go through the state machine.** Nothing here writes a
///    status without `assertRideTransition` / `assertAppointmentTransition`.
/// 3. **Every change that a family would want to know about produces a
///    notification**, and every status change appends to history. Neither is
///    optional or "added later".
///
/// When the NestJS API lands these become client calls — but the server will
/// enforce exactly the same three rules, because a client cannot be trusted to.
library;

import '../core/failures.dart';
import '../core/geo.dart';
import '../core/ids.dart';
import '../domain/appointment_status.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import '../domain/pricing.dart';
import '../domain/ride_status.dart';
import 'care_state.dart';

// ─── patients ───────────────────────────────────────────────────────────────

CareState selectPatient(CareState state, String patientId) {
  if (state.patientById(patientId) == null) throw const NotFoundFailure();
  if (!state.canView(patientId)) throw const AuthorizationFailure();
  return state.copyWith(selectedPatientId: patientId);
}

CareState upsertPatient(CareState state, Patient patient) {
  final existing = state.patientById(patient.id);

  // Editing an existing profile takes `manageAccess`, not `viewProfile`. The
  // profile is not a read-only description of someone: it holds the pickup
  // address, the access notes a driver navigates by, and the mobility needs
  // that decide which vehicle is sent. Someone who may only *look* at a person
  // must not be able to redirect the car that collects them, or quietly drop a
  // wheelchair requirement. Same bar as archiving, for the same reason.
  if (existing != null && !state.can(patient.id, FamilyPermission.manageAccess)) {
    throw const AuthorizationFailure();
  }

  final patients = [...state.patients];
  final index = patients.indexWhere((p) => p.id == patient.id);
  if (index >= 0) {
    patients[index] = patient;
    return state.copyWith(patients: patients);
  }

  patients.add(patient);

  // Whoever creates the patient record is the organiser: full rights, and
  // `manageAccess` cannot be taken away — otherwise a family could lock itself
  // out of its own patient with no recovery short of support.
  final access = {...state.access};
  access[patient.id] = PatientAccess(
    userId: state.user?.id ?? 'unknown',
    patientId: patient.id,
    relationship: RelationshipType.other,
    permissions: PatientAccess.all,
    grantedAt: DateTime.now(),
  );

  return state.copyWith(
    patients: patients,
    access: access,
    selectedPatientId: state.selectedPatientId ?? patient.id,
  );
}

CareState archivePatient(CareState state, String patientId, DateTime now) {
  final patient = state.patientById(patientId);
  if (patient == null) throw const NotFoundFailure();
  if (!state.can(patientId, FamilyPermission.manageAccess)) {
    throw const AuthorizationFailure();
  }
  return upsertPatient(state, patient.copyWith(archivedAt: now));
}

CareState setAccessPermissions(
  CareState state, {
  required String patientId,
  required Set<FamilyPermission> permissions,
}) {
  final current = state.access[patientId];
  if (current == null) throw const NotFoundFailure();
  if (!current.can(FamilyPermission.manageAccess)) {
    throw const AuthorizationFailure();
  }

  // This edits the caller's *own* grant, so two rules apply.
  //
  // The organiser keeps `manageAccess` whatever the UI submitted — otherwise a
  // family can lock itself out of its own patient with no recovery path.
  //
  // A delegate may only narrow their grant, never widen it. `manageAccess` is
  // the right to administer other people's access; letting it write arbitrary
  // permissions back onto the holder's own record would turn it into a
  // self-service route to spending rights the organiser never granted. Giving
  // rights away stays available; taking new ones is not.
  final effective = current.isPrimary
      ? {...permissions, FamilyPermission.manageAccess}
      : permissions.intersection(current.permissions);

  final access = {...state.access};
  access[patientId] = current.copyWith(permissions: effective);
  return state.copyWith(access: access);
}

// ─── clinics ────────────────────────────────────────────────────────────────

CareState addClinic(CareState state, Clinic clinic) =>
    state.copyWith(clinics: [...state.clinics, clinic]);

// ─── appointments ───────────────────────────────────────────────────────────

CareState createAppointment(
  CareState state, {
  required String patientId,
  required String clinicId,
  required DateTime startsAt,
  required Duration expectedDuration,
  required AppointmentType type,
  required DateTime now,
  String? coordinationNotes,
  bool transportRequired = false,
  String timeZoneLabel = 'clinic time',
}) {
  if (!state.can(patientId, FamilyPermission.scheduleAppointments)) {
    throw const AuthorizationFailure();
  }
  if (state.patientById(patientId) == null) throw const NotFoundFailure();
  if (state.clinicById(clinicId) == null) throw const NotFoundFailure();
  if (startsAt.isBefore(now)) {
    throw const ValidationFailure(
      'Choose a date and time in the future.',
      field: 'startsAt',
    );
  }

  final appointment = Appointment(
    id: newId(),
    patientId: patientId,
    clinicId: clinicId,
    startsAt: startsAt,
    expectedDuration: expectedDuration,
    type: type,
    status: AppointmentStatus.scheduled,
    coordinationNotes: coordinationNotes,
    transportRequired: transportRequired,
    timeZoneLabel: timeZoneLabel,
    createdAt: now,
    history: [
      recordChange(
        at: now,
        from: AppointmentStatus.draft,
        to: AppointmentStatus.scheduled,
        actor: state.user?.fullName ?? 'You',
      ),
    ],
  );

  return _withNotification(
    state.copyWith(appointments: [...state.appointments, appointment]),
    kind: NotificationKind.appointmentCreated,
    title: 'Appointment added',
    body: 'An appointment has been added to the calendar.',
    now: now,
    appointmentId: appointment.id,
  );
}

CareState updateAppointment(
  CareState state,
  Appointment updated, {
  required DateTime now,
  bool notify = true,
}) {
  if (!state.can(updated.patientId, FamilyPermission.scheduleAppointments)) {
    throw const AuthorizationFailure();
  }
  final index = state.appointments.indexWhere((a) => a.id == updated.id);
  if (index < 0) throw const NotFoundFailure();

  final appointments = [...state.appointments];
  appointments[index] = updated;
  final next = state.copyWith(appointments: appointments);

  if (!notify) return next;
  return _withNotification(
    next,
    kind: NotificationKind.appointmentChanged,
    title: 'Appointment updated',
    body: 'An appointment has changed. Open CareBridge to see the details.',
    now: now,
    appointmentId: updated.id,
  );
}

CareState rescheduleAppointment(
  CareState state, {
  required String appointmentId,
  required DateTime startsAt,
  required DateTime now,
}) {
  final appointment = state.appointmentById(appointmentId);
  if (appointment == null) throw const NotFoundFailure();
  if (appointment.status.isTerminal) {
    throw InvalidTransitionFailure(appointment.status.name, 'rescheduled');
  }
  if (startsAt.isBefore(now)) {
    throw const ValidationFailure(
      'Choose a date and time in the future.',
      field: 'startsAt',
    );
  }

  return updateAppointment(
    state,
    appointment.copyWith(
      startsAt: startsAt,
      history: [
        ...appointment.history,
        recordChange(
          at: now,
          from: appointment.status,
          to: appointment.status,
          actor: state.user?.fullName ?? 'You',
          reason: 'Rescheduled',
        ),
      ],
    ),
    now: now,
  );
}

CareState setAppointmentStatus(
  CareState state, {
  required String appointmentId,
  required AppointmentStatus to,
  required DateTime now,
  String? reason,
  String actor = 'CareBridge',
  bool notify = true,
}) {
  final appointment = state.appointmentById(appointmentId);
  if (appointment == null) throw const NotFoundFailure();
  assertAppointmentTransition(appointment.status, to);

  final updated = appointment.copyWith(
    status: to,
    history: [
      ...appointment.history,
      recordChange(
        at: now,
        from: appointment.status,
        to: to,
        actor: actor,
        reason: reason,
      ),
    ],
  );

  final appointments = [...state.appointments];
  appointments[state.appointments.indexOf(appointment)] = updated;
  var next = state.copyWith(appointments: appointments);

  if (notify && to == AppointmentStatus.canceled) {
    next = _withNotification(
      next,
      kind: NotificationKind.appointmentCanceled,
      title: 'Appointment canceled',
      body: 'An appointment has been canceled.',
      now: now,
      appointmentId: appointmentId,
    );
  }
  return next;
}

CareState cancelAppointment(
  CareState state, {
  required String appointmentId,
  required DateTime now,
  String? reason,
}) {
  final appointment = state.appointmentById(appointmentId);
  if (appointment == null) throw const NotFoundFailure();
  if (!state.can(appointment.patientId, FamilyPermission.scheduleAppointments)) {
    throw const AuthorizationFailure();
  }

  var next = setAppointmentStatus(
    state,
    appointmentId: appointmentId,
    to: AppointmentStatus.canceled,
    now: now,
    reason: reason,
    actor: state.user?.fullName ?? 'You',
  );

  // Cancelling the appointment must cancel the rides booked for it. Leaving a
  // car to arrive for an appointment that is not happening is the kind of
  // failure that ends a pilot.
  //
  // A leg that has already delivered the passenger is the exception: there is
  // nothing left to call off, and the state machine rightly forbids it. Skip it
  // rather than letting it throw — otherwise the family loses the ability to
  // cancel the appointment at all for the minutes between arrival and
  // completion, which is precisely when they are most likely to try.
  for (final ride in next.ridesForAppointment(appointmentId)) {
    if (ride.isActive && canTransitionRide(ride.status, RideStatus.canceled)) {
      next = cancelRide(
        next,
        rideId: ride.id,
        reason: 'Appointment canceled',
        now: now,
        checkPermission: false,
      );
    }
  }
  return next;
}

// ─── transportation ─────────────────────────────────────────────────────────

/// Creates the ride(s) for an appointment.
///
/// A round trip produces **two rides** sharing a `roundTripGroupId`. The return
/// leg is marked [Ride.flexibleReturn] because nobody knows when a cardiology
/// follow-up will actually finish; it is dispatched when the family says the
/// visit is over, not at a time guessed days earlier.
CareState requestTransport(
  CareState state, {
  required String appointmentId,
  required DateTime pickupAt,
  required bool roundTrip,
  required DateTime now,
  String? notesForDriver,
}) {
  final appointment = state.appointmentById(appointmentId);
  if (appointment == null) throw const NotFoundFailure();
  if (!state.can(appointment.patientId, FamilyPermission.requestTransport)) {
    throw const AuthorizationFailure();
  }

  final patient = state.patientById(appointment.patientId);
  final clinic = state.clinicById(appointment.clinicId);
  if (patient == null || clinic == null) throw const NotFoundFailure();

  if (pickupAt.isAfter(appointment.startsAt)) {
    throw const ValidationFailure(
      'Pickup must be before the appointment starts.',
      field: 'pickupAt',
    );
  }

  final existing = state.ridesForAppointment(appointmentId).where((r) => r.isActive);
  if (existing.isNotEmpty) {
    throw const ValidationFailure('Transportation is already booked for this appointment.');
  }

  final groupId = roundTrip ? newId() : null;
  final estimate = _estimateFor(
    from: patient.homeAddress,
    to: clinic.address,
    patient: patient,
  );

  final outbound = Ride(
    id: newId(),
    patientId: patient.id,
    appointmentId: appointmentId,
    roundTripGroupId: groupId,
    direction: RideDirection.outbound,
    pickup: patient.homeAddress,
    destination: clinic.address,
    scheduledPickupAt: pickupAt,
    status: RideStatus.requested,
    wheelchairRequired: patient.requiresWheelchairVehicle,
    assistanceRequired: patient.requiresAssistance,
    notesForDriver: notesForDriver,
    estimate: estimate,
    createdAt: now,
    history: [
      recordChange(
        at: now,
        from: RideStatus.draft,
        to: RideStatus.requested,
        actor: state.user?.fullName ?? 'You',
      ),
    ],
    events: [RideEvent(at: now, title: 'Ride requested')],
  );

  final rides = <Ride>[outbound];

  if (roundTrip) {
    rides.add(
      Ride(
        id: newId(),
        patientId: patient.id,
        appointmentId: appointmentId,
        roundTripGroupId: groupId,
        direction: RideDirection.returnTrip,
        pickup: clinic.address,
        destination: patient.homeAddress,
        scheduledPickupAt: appointment.endsAt,
        flexibleReturn: true,
        status: RideStatus.requested,
        wheelchairRequired: patient.requiresWheelchairVehicle,
        assistanceRequired: patient.requiresAssistance,
        notesForDriver: notesForDriver,
        estimate: estimate,
        createdAt: now,
        history: [
          recordChange(
            at: now,
            from: RideStatus.draft,
            to: RideStatus.requested,
            actor: state.user?.fullName ?? 'You',
          ),
        ],
        events: [
          RideEvent(
            at: now,
            title: 'Return ride requested',
            detail: 'Pickup time is flexible — we will send a car when the visit ends.',
          ),
        ],
      ),
    );
  }

  var next = state.copyWith(rides: [...state.rides, ...rides]);

  if (canTransitionAppointment(
    appointment.status,
    AppointmentStatus.transportationScheduled,
  )) {
    next = setAppointmentStatus(
      next,
      appointmentId: appointmentId,
      to: AppointmentStatus.transportationScheduled,
      now: now,
      actor: 'CareBridge',
      notify: false,
    );
  }

  return _withNotification(
    next,
    kind: NotificationKind.rideRequested,
    title: roundTrip ? 'Round trip requested' : 'Ride requested',
    body: 'We are finding a driver. You will be notified when one is assigned.',
    now: now,
    rideId: outbound.id,
  );
}

/// Moves a ride to [to], enforcing the state machine.
///
/// [actor] is the driver or dispatcher in production. Family permission is not
/// checked here because families do not drive cars — cancellation is the one
/// family-initiated transition and it has its own function.
CareState advanceRide(
  CareState state, {
  required String rideId,
  required RideStatus to,
  required DateTime now,
  Driver? driver,
  String? reason,
  String actor = 'CareBridge',
}) {
  final ride = state.rideById(rideId);
  if (ride == null) throw const NotFoundFailure();
  assertRideTransition(ride.status, to);

  final event = _eventFor(to, now, driver ?? ride.driver);

  var updated = ride.copyWith(
    status: to,
    driver: driver,
    isDelayed: to.isTerminal ? false : ride.isDelayed,
    history: [
      ...ride.history,
      recordChange(at: now, from: ride.status, to: to, actor: actor, reason: reason),
    ],
    events: event == null ? ride.events : [...ride.events, event],
  );

  // Tracking stops the moment a ride leaves a state where sharing is legal, and
  // the last known position and ETA go with it. Nothing should be able to
  // render a position for a finished ride.
  //
  // Done through `copyWith` rather than by rebuilding the ride field by field:
  // a rebuild silently drops any field added to `Ride` later, which would make
  // "we added a column and it vanished on completion" a bug waiting to happen.
  if (!to.allowsLocationSharing) {
    updated = updated.copyWith(clearPosition: true, clearEta: true);
  }

  final rides = [...state.rides];
  rides[state.rides.indexOf(ride)] = updated;
  var next = state.copyWith(rides: rides);

  // Ride progress drives appointment progress: the family should not have to
  // hold two separate states in their head.
  final implied = appointmentStatusForRide(to.name);
  if (implied != null && ride.appointmentId != null) {
    final appointment = next.appointmentById(ride.appointmentId!);
    if (appointment != null &&
        canTransitionAppointment(appointment.status, implied)) {
      next = setAppointmentStatus(
        next,
        appointmentId: appointment.id,
        to: implied,
        now: now,
        actor: 'CareBridge',
        notify: false,
      );
    }
  }

  final notification = _notificationFor(to, updated);
  if (notification != null) {
    next = _withNotification(
      next,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      now: now,
      rideId: rideId,
    );
  }

  return next;
}

CareState cancelRide(
  CareState state, {
  required String rideId,
  required String reason,
  required DateTime now,
  bool checkPermission = true,
}) {
  final ride = state.rideById(rideId);
  if (ride == null) throw const NotFoundFailure();
  if (checkPermission &&
      !state.can(ride.patientId, FamilyPermission.requestTransport)) {
    throw const AuthorizationFailure();
  }

  final next = advanceRide(
    state,
    rideId: rideId,
    to: RideStatus.canceled,
    now: now,
    reason: reason,
    actor: checkPermission ? (state.user?.fullName ?? 'You') : 'CareBridge',
  );

  final updated = next.rideById(rideId)!;
  final rides = [...next.rides];
  rides[next.rides.indexOf(updated)] =
      updated.copyWith(cancellationReason: reason);
  return next.copyWith(rides: rides);
}

/// Raises or clears a delay.
///
/// Delay is a flag rather than a status: a driver stuck in traffic on the way to
/// pickup is still `driverEnRoute`, and turning that into a status would lose
/// the state it has to return to.
CareState setRideDelay(
  CareState state, {
  required String rideId,
  required bool delayed,
  required DateTime now,
  String? reason,
}) {
  final ride = state.rideById(rideId);
  if (ride == null) throw const NotFoundFailure();
  if (ride.status.isTerminal) {
    throw InvalidTransitionFailure(ride.status.name, 'delayed');
  }

  final updated = ride.copyWith(
    isDelayed: delayed,
    delayReason: delayed ? reason : null,
    events: [
      ...ride.events,
      RideEvent(
        at: now,
        title: delayed ? 'Running late' : 'Back on schedule',
        detail: delayed ? reason : null,
        isException: delayed,
      ),
    ],
  );

  final rides = [...state.rides];
  rides[state.rides.indexOf(ride)] = updated;
  var next = state.copyWith(rides: rides);

  if (delayed) {
    next = _withNotification(
      next,
      kind: NotificationKind.rideDelayed,
      title: 'Ride running late',
      body: 'A ride is running behind schedule. Open CareBridge for the latest.',
      now: now,
      rideId: rideId,
    );
  }
  return next;
}

/// Records a position report for an active ride.
///
/// Two checks, both of which the server repeats — along with "is this device the
/// driver currently assigned to this ride", which only it can answer. A ride id
/// is not a capability.
///
/// 1. The ride must be in a state where tracking is legal.
/// 2. The reading's [TrackingPoint.capturedAt] must be sane.
///
/// The second matters more than it looks. Every freshness label in the app ages
/// a position against `capturedAt`, so a point stamped in the future reads as
/// "updated just now" indefinitely — a stale car rendered as a moving one, which
/// is the single failure mode this product cannot have. A point that is already
/// older than [TrackingFreshness.lost] is refused for the mirror-image reason:
/// it would be stored as the latest known position and then immediately hidden
/// as expired, so accepting it only overwrites better data with worse.
CareState updateRidePosition(
  CareState state, {
  required String rideId,
  required TrackingPoint point,
  required DateTime now,
  int? etaMinutes,
}) {
  final ride = state.rideById(rideId);
  if (ride == null) throw const NotFoundFailure();
  if (!ride.status.allowsLocationSharing) {
    throw InvalidTransitionFailure(ride.status.name, 'locationUpdate');
  }

  final age = now.difference(point.capturedAt);
  if (age.isNegative && age.abs() > TrackingFreshness.maxClockSkew) {
    throw const ValidationFailure(
      'That position reading is stamped in the future and cannot be trusted.',
      field: 'capturedAt',
    );
  }
  if (age > TrackingFreshness.lost) {
    throw const ValidationFailure(
      'That position reading is too old to show as a current location.',
      field: 'capturedAt',
    );
  }

  final rides = [...state.rides];
  rides[state.rides.indexOf(ride)] =
      ride.copyWith(lastKnownPosition: point, etaMinutes: etaMinutes);
  return state.copyWith(rides: rides);
}

// ─── notifications & preferences ────────────────────────────────────────────

CareState markNotificationRead(CareState state, String id, DateTime now) {
  final list = state.notifications
      .map((n) => n.id == id && !n.isRead ? n.markRead(now) : n)
      .toList(growable: false);
  return state.copyWith(notifications: list);
}

CareState markAllNotificationsRead(CareState state, DateTime now) {
  final list = state.notifications
      .map((n) => n.isRead ? n : n.markRead(now))
      .toList(growable: false);
  return state.copyWith(notifications: list);
}

CareState setSimplifiedMode(CareState state, bool enabled) =>
    state.copyWith(simplifiedMode: enabled);

// ─── helpers ────────────────────────────────────────────────────────────────

PriceEstimate _estimateFor({
  required Address from,
  required Address to,
  required Patient patient,
}) {
  final origin = from.coordinates;
  final destination = to.coordinates;

  // Without coordinates we cannot estimate honestly, so fall back to the
  // minimum fare rather than inventing a number that looks precise.
  if (origin == null || destination == null) {
    return estimateFare(
      rule: PricingRule.standard(),
      distanceMiles: 0,
      durationMinutes: 0,
      wheelchairAccessRequired: patient.requiresWheelchairVehicle,
      assistanceRequired: patient.requiresAssistance,
    );
  }

  final miles = distanceMiles(origin, destination);
  return estimateFare(
    rule: PricingRule.standard(),
    distanceMiles: double.parse(miles.toStringAsFixed(1)),
    durationMinutes: estimateDriveMinutes(miles),
    wheelchairAccessRequired: patient.requiresWheelchairVehicle,
    assistanceRequired: patient.requiresAssistance,
  );
}

RideEvent? _eventFor(RideStatus status, DateTime now, Driver? driver) =>
    switch (status) {
      RideStatus.awaitingAssignment =>
        RideEvent(at: now, title: 'Looking for a driver'),
      RideStatus.assigned => RideEvent(
          at: now,
          title: 'Driver assigned',
          detail: driver == null
              ? null
              : '${driver.displayName} — ${driver.vehicle.description}',
        ),
      RideStatus.driverAccepted =>
        RideEvent(at: now, title: 'Driver confirmed the trip'),
      RideStatus.driverEnRoute =>
        RideEvent(at: now, title: 'Driver set off for pickup'),
      RideStatus.driverArrived =>
        RideEvent(at: now, title: 'Driver arrived at pickup'),
      RideStatus.passengerOnboard =>
        RideEvent(at: now, title: 'Picked up safely'),
      RideStatus.inProgress => RideEvent(at: now, title: 'On the way'),
      RideStatus.arrivedAtDestination =>
        RideEvent(at: now, title: 'Arrived at the clinic'),
      RideStatus.completed => RideEvent(at: now, title: 'Ride completed'),
      RideStatus.canceled =>
        RideEvent(at: now, title: 'Ride canceled', isException: true),
      RideStatus.noShow => RideEvent(
          at: now,
          title: 'Nobody came to the door',
          detail: 'The driver waited and could not make contact.',
          isException: true,
        ),
      RideStatus.reassignmentRequired => RideEvent(
          at: now,
          title: 'Finding a replacement driver',
          isException: true,
        ),
      _ => null,
    };

({NotificationKind kind, String title, String body})? _notificationFor(
  RideStatus status,
  Ride ride,
) =>
    switch (status) {
      RideStatus.assigned => (
          kind: NotificationKind.driverAssigned,
          title: 'Driver assigned',
          body: 'A driver has been assigned. Open CareBridge to see the details.',
        ),
      RideStatus.driverEnRoute => (
          kind: NotificationKind.driverEnRoute,
          title: 'Driver on the way',
          body: 'The driver has set off. You can follow the trip in CareBridge.',
        ),
      RideStatus.driverArrived => (
          kind: NotificationKind.driverArrived,
          title: 'Driver has arrived',
          body: 'The driver is at the pickup address.',
        ),
      RideStatus.passengerOnboard => (
          kind: NotificationKind.patientPickedUp,
          title: 'Picked up safely',
          body: 'The trip to the appointment has started.',
        ),
      RideStatus.arrivedAtDestination => (
          kind: NotificationKind.patientArrived,
          title: 'Arrived at the clinic',
          body: 'The trip is complete and the passenger is at the destination.',
        ),
      RideStatus.completed => (
          kind: NotificationKind.rideCompleted,
          title: 'Ride completed',
          body: 'A ride has finished. A receipt is available in CareBridge.',
        ),
      RideStatus.canceled => (
          kind: NotificationKind.rideCanceled,
          title: 'Ride canceled',
          body: 'A ride has been canceled.',
        ),
      RideStatus.noShow => (
          kind: NotificationKind.rideDelayed,
          title: 'Pickup could not be completed',
          body: 'The driver could not make contact. Open CareBridge to review.',
        ),
      _ => null,
    };

/// Appends a notification.
///
/// Bodies never contain a patient name, a clinic name, an address or a time.
/// See [AppNotification] for why.
CareState _withNotification(
  CareState state, {
  required NotificationKind kind,
  required String title,
  required String body,
  required DateTime now,
  String? rideId,
  String? appointmentId,
}) {
  final notification = AppNotification(
    id: newId(),
    kind: kind,
    title: title,
    body: body,
    createdAt: now,
    rideId: rideId,
    appointmentId: appointmentId,
  );
  return state.copyWith(notifications: [...state.notifications, notification]);
}
