import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/clock.dart';
import '../core/failures.dart';
import '../core/geo.dart';
import '../domain/appointment_status.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import '../domain/ride_status.dart';
import '../data/care_operations.dart' as ops;
import '../data/care_state.dart';
import '../data/seed.dart';

final clockProvider = Provider<Clock>((ref) => const SystemClock());

final careProvider = NotifierProvider<CareNotifier, CareState>(CareNotifier.new);

/// The patient currently being viewed. Null until one is chosen, which is the
/// empty state a brand-new account starts in.
final selectedPatientProvider = Provider<Patient?>(
  (ref) => ref.watch(careProvider).selectedPatient,
);

final unreadCountProvider = Provider<int>(
  (ref) => ref.watch(careProvider).unreadNotificationCount,
);

final simplifiedModeProvider = Provider<bool>(
  (ref) => ref.watch(careProvider).simplifiedMode,
);

/// Ticks once a second while a demo trip is running, so freshness ages ("updated
/// 12 seconds ago") stay honest without every widget owning a timer.
final tickerProvider = StreamProvider<DateTime>((ref) {
  final clock = ref.watch(clockProvider);
  return Stream<DateTime>.periodic(const Duration(seconds: 1), (_) => clock.now());
});

class CareNotifier extends Notifier<CareState> {
  Timer? _demoTimer;
  int _demoElapsedSeconds = 0;
  String? _demoRideId;

  @override
  CareState build() {
    ref.onDispose(() => _demoTimer?.cancel());
    return const CareState();
  }

  DateTime get _now => ref.read(clockProvider).now();

  String? get runningDemoRideId => _demoRideId;

  // ─── session ──────────────────────────────────────────────────────────────

  /// Local-only sign-in against seeded demo data.
  ///
  /// There is no credential check here on purpose: this is a stand-in, and
  /// pretending otherwise would be worse than being obvious about it. Real
  /// authentication is server-side — argon2id, short-lived access tokens,
  /// rotating refresh tokens. See docs/FOUNDATION.md §9.
  void signIn({required String email, required String password}) {
    if (email.trim().isEmpty || !email.contains('@')) {
      throw const ValidationFailure('Enter the email address you signed up with.', field: 'email');
    }
    if (password.isEmpty) {
      throw const ValidationFailure('Enter your password.', field: 'password');
    }
    state = buildSeedState(_now);
  }

  /// Registers a new account. Starts genuinely empty — no patients, no
  /// appointments — so the first-run experience is the one a real user gets.
  void register({
    required String fullName,
    required String email,
    required String password,
  }) {
    if (fullName.trim().isEmpty) {
      throw const ValidationFailure('Enter your name.', field: 'fullName');
    }
    if (!email.contains('@')) {
      throw const ValidationFailure('Enter a valid email address.', field: 'email');
    }
    if (password.length < 10) {
      throw const ValidationFailure(
        'Use at least 10 characters. Length matters more than symbols.',
        field: 'password',
      );
    }
    state = CareState(
      user: AppUser(
        id: 'user-${email.hashCode.abs()}',
        email: email.trim(),
        fullName: fullName.trim(),
      ),
    );
  }

  void signOut() {
    _stopDemo();
    state = const CareState();
  }

  // ─── patients ─────────────────────────────────────────────────────────────

  void selectPatient(String patientId) =>
      state = ops.selectPatient(state, patientId);

  void savePatient(Patient patient) => state = ops.upsertPatient(state, patient);

  void archivePatient(String patientId) =>
      state = ops.archivePatient(state, patientId, _now);

  void setPermissions(String patientId, Set<FamilyPermission> permissions) =>
      state = ops.setAccessPermissions(
        state,
        patientId: patientId,
        permissions: permissions,
      );

  void addClinic(Clinic clinic) => state = ops.addClinic(state, clinic);

  // ─── appointments ─────────────────────────────────────────────────────────

  void createAppointment({
    required String patientId,
    required String clinicId,
    required DateTime startsAt,
    required Duration expectedDuration,
    required AppointmentType type,
    String? coordinationNotes,
    bool transportRequired = false,
  }) {
    state = ops.createAppointment(
      state,
      patientId: patientId,
      clinicId: clinicId,
      startsAt: startsAt,
      expectedDuration: expectedDuration,
      type: type,
      coordinationNotes: coordinationNotes,
      transportRequired: transportRequired,
      now: _now,
    );
  }

  void rescheduleAppointment(String appointmentId, DateTime startsAt) =>
      state = ops.rescheduleAppointment(
        state,
        appointmentId: appointmentId,
        startsAt: startsAt,
        now: _now,
      );

  void cancelAppointment(String appointmentId, {String? reason}) =>
      state = ops.cancelAppointment(
        state,
        appointmentId: appointmentId,
        now: _now,
        reason: reason,
      );

  void setAppointmentStatus(String appointmentId, AppointmentStatus to) =>
      state = ops.setAppointmentStatus(
        state,
        appointmentId: appointmentId,
        to: to,
        now: _now,
        actor: state.user?.fullName ?? 'You',
      );

  // ─── transportation ───────────────────────────────────────────────────────

  void requestTransport({
    required String appointmentId,
    required DateTime pickupAt,
    required bool roundTrip,
    String? notesForDriver,
  }) {
    state = ops.requestTransport(
      state,
      appointmentId: appointmentId,
      pickupAt: pickupAt,
      roundTrip: roundTrip,
      notesForDriver: notesForDriver,
      now: _now,
    );
  }

  void cancelRide(String rideId, String reason) {
    if (_demoRideId == rideId) _stopDemo();
    state = ops.cancelRide(state, rideId: rideId, reason: reason, now: _now);
  }

  void advanceRide(String rideId, RideStatus to, {Driver? driver, String? reason}) =>
      state = ops.advanceRide(
        state,
        rideId: rideId,
        to: to,
        now: _now,
        driver: driver,
        reason: reason,
      );

  void setDelay(String rideId, {required bool delayed, String? reason}) =>
      state = ops.setRideDelay(
        state,
        rideId: rideId,
        delayed: delayed,
        reason: reason,
        now: _now,
      );

  // ─── notifications & preferences ──────────────────────────────────────────

  void markNotificationRead(String id) =>
      state = ops.markNotificationRead(state, id, _now);

  void markAllNotificationsRead() =>
      state = ops.markAllNotificationsRead(state, _now);

  void setSimplifiedMode(bool enabled) =>
      state = ops.setSimplifiedMode(state, enabled);

  // ─── demo trip ────────────────────────────────────────────────────────────

  /// Drives a ride through its full lifecycle, emitting position reports.
  ///
  /// This is a **stand-in for the driver app and the dispatch service**, not a
  /// simulation of them. It exists so the family-side experience — assignment,
  /// live position, staleness, arrival, completion — can be built and reviewed
  /// before those pieces exist. It runs only when explicitly started, and it
  /// goes through exactly the same `advanceRide` state machine the server will
  /// enforce; it has no privileged path.
  void startDemoTrip(String rideId) {
    final ride = state.rideById(rideId);
    if (ride == null || ride.status.isTerminal) return;

    _stopDemo();
    _demoRideId = rideId;
    _demoElapsedSeconds = 0;

    if (state.rideById(rideId)!.status == RideStatus.requested) {
      advanceRide(rideId, RideStatus.awaitingAssignment);
    }

    _demoTimer = Timer.periodic(const Duration(seconds: 1), (_) => _demoTick());
  }

  void stopDemoTrip() => _stopDemo();

  void _stopDemo() {
    _demoTimer?.cancel();
    _demoTimer = null;
    _demoRideId = null;
    _demoElapsedSeconds = 0;
  }

  void _demoTick() {
    final rideId = _demoRideId;
    if (rideId == null) return;
    final ride = state.rideById(rideId);
    if (ride == null || ride.status.isTerminal) {
      _stopDemo();
      return;
    }

    _demoElapsedSeconds++;
    final t = _demoElapsedSeconds;

    // Status changes at fixed points in the script.
    final next = switch (t) {
      2 => RideStatus.assigned,
      5 => RideStatus.driverAccepted,
      8 => RideStatus.driverEnRoute,
      30 => RideStatus.driverArrived,
      36 => RideStatus.passengerOnboard,
      39 => RideStatus.inProgress,
      75 => RideStatus.arrivedAtDestination,
      82 => RideStatus.completed,
      _ => null,
    };

    if (next != null && canTransitionRide(ride.status, next)) {
      advanceRide(
        rideId,
        next,
        driver: next == RideStatus.assigned ? _demoDriver(ride) : null,
        reason: 'Demo trip',
      );
    }

    final current = state.rideById(rideId);
    if (current == null) return;

    // Position reports only while the ride is in a state that permits tracking.
    if (current.status.allowsLocationSharing) {
      final progress = _demoProgress(t, current.status);
      final position = _demoPosition(current, progress);
      if (position != null) {
        state = ops.updateRidePosition(
          state,
          rideId: rideId,
          point: TrackingPoint(coordinates: position, capturedAt: _now),
          etaMinutes: _demoEta(t, current.status),
        );
      }
    }

    if (state.rideById(rideId)?.status.isTerminal ?? true) _stopDemo();
  }

  Driver _demoDriver(Ride ride) => Driver(
        id: 'driver-demo',
        displayName: ride.wheelchairRequired ? 'Priya N.' : 'Marcus T.',
        rating: 4.9,
        yearsDriving: 6,
        vehicle: ride.wheelchairRequired
            ? const Vehicle(
                make: 'Ford',
                model: 'Transit',
                color: 'White',
                licensePlate: 'OH·8RT 660',
                isWheelchairAccessible: true,
              )
            : const Vehicle(
                make: 'Toyota',
                model: 'Sienna',
                color: 'Silver',
                licensePlate: 'OH·4KJ 219',
              ),
      );

  double _demoProgress(int t, RideStatus status) {
    if (status == RideStatus.driverEnRoute) {
      return ((t - 8) / 22).clamp(0.0, 1.0);
    }
    if (status == RideStatus.inProgress) {
      return ((t - 39) / 36).clamp(0.0, 1.0);
    }
    if (status == RideStatus.driverArrived ||
        status == RideStatus.passengerOnboard) {
      return 0.0;
    }
    return 1.0;
  }

  int? _demoEta(int t, RideStatus status) {
    if (status == RideStatus.driverEnRoute) {
      return (((30 - t) / 60) * 9).ceil().clamp(1, 15);
    }
    if (status == RideStatus.inProgress) {
      return (((75 - t) / 60) * 14).ceil().clamp(1, 25);
    }
    return null;
  }

  /// Where the car is. On the way to pickup it approaches from a point about a
  /// mile away; after pickup it runs from the pickup address to the destination.
  Coordinates? _demoPosition(Ride ride, double progress) {
    final pickup = ride.pickup.coordinates;
    final destination = ride.destination.coordinates;
    if (pickup == null || destination == null) return null;

    return switch (ride.status) {
      RideStatus.driverEnRoute => Coordinates(
          pickup.latitude - 0.018,
          pickup.longitude - 0.021,
        ).lerp(pickup, progress),
      RideStatus.driverArrived || RideStatus.passengerOnboard => pickup,
      RideStatus.inProgress => pickup.lerp(destination, progress),
      RideStatus.arrivedAtDestination => destination,
      _ => null,
    };
  }
}

/// Straight-line distance from the driver's last known position to the pickup,
/// for the "about a mile away" line on the tracking screen.
double? milesToPickup(Ride ride) {
  final position = ride.lastKnownPosition?.coordinates;
  final target = ride.status.passengerIsOnboard
      ? ride.destination.coordinates
      : ride.pickup.coordinates;
  if (position == null || target == null) return null;
  return distanceMiles(position, target, detourFactor: 1.0);
}
