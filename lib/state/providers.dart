import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/clock.dart';
import 'package:carebridge_client/carebridge_client.dart';
import '../core/geo.dart';
import '../data/care_api.dart';
import '../data/care_state.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';

final clockProvider = Provider<Clock>((ref) => const SystemClock());

/// Overridden in tests with an [InMemoryTokenStore]; there is no platform
/// channel behind secure storage in a test binding.
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final careApiProvider = Provider<CareApi>((ref) {
  final api = CareApi(tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(api.dispose);
  return api;
});

final careProvider = NotifierProvider<CareNotifier, CareState>(
  CareNotifier.new,
);

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

/// Ticks once a second so freshness ages ("updated 12 seconds ago") stay honest
/// without every widget owning a timer.
final tickerProvider = StreamProvider<DateTime>((ref) {
  final clock = ref.watch(clockProvider);
  return Stream<DateTime>.periodic(
    const Duration(seconds: 1),
    (_) => clock.now(),
  );
});

/// The state everything reads.
///
/// Unchanged in shape from the in-memory build: screens still watch a
/// [CareState] and still read `canView` before rendering anyone. What changed is
/// where it comes from. Every method here posts to the API and replaces the
/// state with the snapshot the server returns, so the server — not this class —
/// decides what a status change implies, which notifications it produces, and
/// whether the caller was allowed to ask.
class CareNotifier extends Notifier<CareState> {
  Timer? _pollTimer;
  Set<String> _runningPreviews = const {};

  @override
  CareState build() {
    ref.onDispose(_stopPolling);
    return const CareState();
  }

  CareApi get _api => ref.read(careApiProvider);

  /// Ride ids the **server** is currently driving with the preview runner.
  /// Read from the snapshot rather than tracked here, so the controls show the
  /// right state after a page refresh or on a second device.
  Set<String> get runningPreviewRides => _runningPreviews;

  bool isPreviewRunning(String rideId) => _runningPreviews.contains(rideId);

  // ─── session ──────────────────────────────────────────────────────────────

  /// Restores a session from secure storage, if there is one.
  ///
  /// Awaited in `main()` before the first frame, so the router never sees a
  /// signed-in user as signed out — otherwise a returning user watches the
  /// sign-in screen flash past before their dashboard appears.
  ///
  /// Never throws: a failure here means "start signed out", which is
  /// recoverable, and an exception during startup is a white screen, which is
  /// not.
  Future<void> restoreSession() async {
    try {
      final snapshot = await _api.restore();
      if (snapshot != null) _apply(snapshot);
    } catch (_) {
      state = const CareState();
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    // Kept client-side so the form can point at the offending field before a
    // round trip. The server validates independently — this is a courtesy.
    if (email.trim().isEmpty || !email.contains('@')) {
      throw const ValidationFailure(
        'Enter the email address you signed up with.',
        field: 'email',
      );
    }
    if (password.isEmpty) {
      throw const ValidationFailure('Enter your password.', field: 'password');
    }
    _apply(await _api.signIn(email: email, password: password));
  }

  /// Registers a new account. The state that comes back is genuinely empty —
  /// no patients, no appointments — because a new account has nothing in it.
  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    bool acceptedTerms = true,
  }) async {
    if (fullName.trim().isEmpty) {
      throw const ValidationFailure('Enter your name.', field: 'fullName');
    }
    if (!email.contains('@')) {
      throw const ValidationFailure(
        'Enter a valid email address.',
        field: 'email',
      );
    }
    if (password.length < 10) {
      throw const ValidationFailure(
        'Use at least 10 characters. Length matters more than symbols.',
        field: 'password',
      );
    }
    _apply(
      await _api.register(
        fullName: fullName,
        email: email,
        password: password,
        acceptedTerms: acceptedTerms,
      ),
    );
  }

  Future<void> signOut() async {
    _stopPolling();
    await _api.signOut();
    _runningPreviews = const {};
    state = const CareState();
  }

  /// Drops the local session without calling the server.
  ///
  /// For the cases where the server has *already* ended it — sign out
  /// everywhere, or a password change — and calling `/auth/logout` afterwards
  /// would be a request with a token that is deliberately already dead.
  void forgetSession() {
    _stopPolling();
    _runningPreviews = const {};
    state = const CareState();
  }

  /// Accepts an invitation and adopts the snapshot it returns.
  ///
  /// The response is the whole state, and it now contains a patient the caller
  /// could not see a moment ago — which is exactly why acceptance returns a
  /// snapshot rather than an id.
  Future<void> acceptInvitation(String token) async =>
      _apply(await _api.acceptInvitation(token));

  /// Re-reads the snapshot. Used by pull-to-refresh and by the preview poll.
  Future<void> refresh() async {
    if (!state.isSignedIn) return;
    _apply(await _api.state());
  }

  // ─── patients ─────────────────────────────────────────────────────────────

  Future<void> selectPatient(String patientId) async =>
      _apply(await _api.selectPatient(patientId));

  Future<void> savePatient(Patient patient) async {
    // A patient built by the form carries a locally generated id only when it
    // is new; the server mints the real one. Anything already in state is an
    // update.
    final exists = state.patientById(patient.id) != null;
    _apply(
      exists
          ? await _api.updatePatient(patient)
          : await _api.createPatient(patient),
    );
  }

  Future<void> archivePatient(String patientId) async =>
      _apply(await _api.archivePatient(patientId));

  Future<void> setPermissions(
    String patientId,
    Set<FamilyPermission> permissions,
  ) async => _apply(await _api.setPermissions(patientId, permissions));

  /// Adds a clinic and returns it **as the server stored it**.
  ///
  /// The caller needs the real id straight away — it adds a clinic from inside
  /// the appointment form and immediately selects it. The id the form invented
  /// locally is not the id the database assigned, and using it would fail the
  /// very next request.
  ///
  /// Identified by diffing ids against the previous snapshot, then confirming
  /// on the fields that were submitted: clinics are shared between accounts, so
  /// another family adding one at the same moment could otherwise put a
  /// stranger's clinic into this appointment.
  Future<Clinic> addClinic(Clinic clinic) async {
    final before = state.clinics.map((c) => c.id).toSet();
    _apply(await _api.addClinic(clinic));

    final added = state.clinics.where((c) => !before.contains(c.id)).toList();
    final match = added.where(
      (c) =>
          c.name == clinic.name.trim() &&
          c.address.line1 == clinic.address.line1.trim() &&
          c.address.postalCode == clinic.address.postalCode.trim(),
    );

    if (match.isNotEmpty) return match.first;
    if (added.isNotEmpty) return added.first;

    // The write succeeded — the snapshot came back — but the clinic is not in
    // it. Better to say so than to hand back an id that does not exist.
    throw const NetworkFailure(
      'The clinic was saved but could not be loaded. Pull to refresh.',
    );
  }

  // ─── appointments ─────────────────────────────────────────────────────────

  Future<void> createAppointment({
    required String patientId,
    required String clinicId,
    required DateTime startsAt,
    required Duration expectedDuration,
    required AppointmentType type,
    String? coordinationNotes,
    bool transportRequired = false,
  }) async => _apply(
    await _api.createAppointment(
      patientId: patientId,
      clinicId: clinicId,
      startsAt: startsAt,
      expectedDuration: expectedDuration,
      type: type,
      coordinationNotes: coordinationNotes,
      transportRequired: transportRequired,
    ),
  );

  Future<void> rescheduleAppointment(
    String appointmentId,
    DateTime startsAt,
  ) async => _apply(await _api.rescheduleAppointment(appointmentId, startsAt));

  Future<void> cancelAppointment(
    String appointmentId, {
    String? reason,
  }) async =>
      _apply(await _api.cancelAppointment(appointmentId, reason: reason));

  // ─── transportation ───────────────────────────────────────────────────────

  Future<void> requestTransport({
    required String appointmentId,
    required DateTime pickupAt,
    required bool roundTrip,
    String? notesForDriver,
  }) async => _apply(
    await _api.requestTransport(
      appointmentId: appointmentId,
      pickupAt: pickupAt,
      roundTrip: roundTrip,
      notesForDriver: notesForDriver,
    ),
  );

  Future<void> cancelRide(String rideId, String reason) async =>
      _apply(await _api.cancelRide(rideId, reason));

  Future<void> setDelay(
    String rideId, {
    required bool delayed,
    String? reason,
  }) async =>
      _apply(await _api.setDelay(rideId, delayed: delayed, reason: reason));

  // ─── notifications & preferences ──────────────────────────────────────────

  Future<void> markNotificationRead(String id) async =>
      _apply(await _api.markNotificationRead(id));

  Future<void> markAllNotificationsRead() async =>
      _apply(await _api.markAllNotificationsRead());

  Future<void> setSimplifiedMode(bool enabled) async =>
      _apply(await _api.setSimplifiedMode(enabled));

  // ─── preview trip ─────────────────────────────────────────────────────────

  /// Asks the **server** to drive a ride through its lifecycle.
  ///
  /// This stands in for the driver app and the dispatch service, and it runs
  /// where their transitions would come from. The previous build ran the script
  /// in a client-side timer, which meant closing the tab stopped the trip and a
  /// refresh lost it. Here the trip carries on, and any family member watching
  /// sees the same thing.
  Future<void> startPreviewTrip(String rideId) async =>
      _apply(await _api.startPreviewTrip(rideId));

  Future<void> stopPreviewTrip(String rideId) async =>
      _apply(await _api.stopPreviewTrip(rideId));

  // ─── plumbing ─────────────────────────────────────────────────────────────

  void _apply(CareSnapshot snapshot) {
    state = snapshot.state;
    _runningPreviews = snapshot.runningPreviews;
    _syncPolling();
  }

  /// Polls only while the server is actually running a trip.
  ///
  /// A permanent poll would keep a phone awake and a database busy for the
  /// 99% of the time when nothing is moving. Long-lived push over the
  /// WebSocket gateway replaces this in Stage 3; until then, polling exactly
  /// when there is something to see is the honest middle.
  void _syncPolling() {
    if (_runningPreviews.isEmpty) {
      _stopPolling();
      return;
    }
    _pollTimer ??= Timer.periodic(
      const Duration(milliseconds: 1500),
      (_) => unawaited(_poll()),
    );
  }

  Future<void> _poll() async {
    try {
      _apply(await _api.state());
    } catch (_) {
      // A dropped poll is not worth interrupting the screen for. The next tick
      // tries again, and the freshness label already tells the user the
      // position is ageing.
    }
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
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
