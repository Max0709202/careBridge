import 'dart:async';

import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/driver_api.dart';
import '../domain/models.dart';
import '../domain/ride_status.dart';
import '../services/location_service.dart';
import '../services/position_source.dart';

/// Wiring. Every dependency is a provider rather than a constructor call
/// inside a widget, so a test can replace the satellite, the battery and the
/// server at once.
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final driverApiProvider = Provider<DriverApi>((ref) {
  final api = DriverApi(tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(api.dispose);
  return api;
});

final positionSourceProvider = Provider<PositionSource>(
  (ref) => GeolocatorPositionSource(),
);

final batterySourceProvider = Provider<BatterySource>(
  (ref) => BatteryPlusSource(),
);

final locationServiceProvider = Provider<LocationService>((ref) {
  final service = LocationService(
    api: ref.watch(driverApiProvider),
    positions: ref.watch(positionSourceProvider),
    battery: ref.watch(batterySourceProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});

final sharingStateProvider = StreamProvider<SharingState>(
  (ref) => ref.watch(locationServiceProvider).states,
);

/// Whether a session exists, as far as this device knows.
///
/// Deliberately not "is the token valid" — only the server can answer that,
/// and a client that tried would either duplicate the check or cache a stale
/// answer.
class SessionController extends Notifier<bool> {
  @override
  bool build() {
    Future(restore);
    return false;
  }

  Future<void> restore() async {
    final tokens = await ref.read(tokenStoreProvider).read();
    state = tokens != null;
  }

  Future<void> signIn({required String email, required String password}) async {
    await ref.read(driverApiProvider).signIn(email: email, password: password);
    state = true;
  }

  Future<void> signOut() async {
    // Sampling stops before the session does. A service still holding a queue
    // after sign-out would try to flush it with a token that no longer exists.
    await ref.read(locationServiceProvider).stop();
    await ref.read(driverApiProvider).signOut();
    ref.invalidate(profileProvider);
    ref.invalidate(jobsProvider);
    state = false;
  }
}

final sessionProvider = NotifierProvider<SessionController, bool>(
  SessionController.new,
);

final profileProvider = FutureProvider<DriverProfile>(
  (ref) => ref.watch(driverApiProvider).profile(),
);

/// How often the work list re-reads itself.
///
/// A dispatcher can assign a ride at any moment and the driver has to see it
/// without pressing anything. Twenty seconds rather than the console's ten:
/// this runs on cellular data in a moving vehicle all day, and the position
/// stream — which is the part that has to be prompt — is pushed rather than
/// polled.
const jobsPollInterval = Duration(seconds: 20);

final jobsProvider = FutureProvider<List<Job>>((ref) async {
  final jobs = await ref.watch(driverApiProvider).jobs();

  // Following the active job is a consequence of reading the list rather than
  // a separate call a screen has to remember to make. A driver who navigates
  // away from the job screen is still driving, and the family's map must not
  // stop because a widget was disposed.
  unawaited(ref.read(locationServiceProvider).follow(_activeIn(jobs)));
  return jobs;
});

/// The one job the driver is actually on.
///
/// At most one, because the eligibility rules only ever assign a driver one
/// passenger at a time. When there is none, the earliest thing they still have
/// to accept is what the screen leads with.
Job? _activeIn(List<Job> jobs) {
  for (final job in jobs) {
    if (job.sharesLocation) return job;
  }
  return null;
}

final activeJobProvider = Provider<Job?>(
  (ref) => _activeIn(ref.watch(jobsProvider).value ?? const []),
);

/// The job the driver should be looking at.
///
/// The one under way if there is one; otherwise the next thing to accept.
final currentJobProvider = Provider<Job?>((ref) {
  final jobs = ref.watch(jobsProvider).value ?? const [];
  return _activeIn(jobs) ?? (jobs.isEmpty ? null : jobs.first);
});

/// Moves a ride along and refreshes everything the move can change.
class JobController extends Notifier<AsyncValue<void>> {
  @override
  AsyncValue<void> build() => const AsyncData(null);

  Future<bool> advance(String rideId, RideStatus to) async {
    state = const AsyncLoading();
    try {
      await ref.read(driverApiProvider).advance(rideId, to);
      ref.invalidate(jobsProvider);
      ref.invalidate(profileProvider);
      state = const AsyncData(null);
      return true;
    } on Failure catch (error, stack) {
      state = AsyncError(error, stack);
      return false;
    }
  }
}

final jobControllerProvider = NotifierProvider<JobController, AsyncValue<void>>(
  JobController.new,
);

/// Starting and ending a shift.
class ShiftController extends Notifier<AsyncValue<void>> {
  @override
  AsyncValue<void> build() => const AsyncData(null);

  Future<Failure?> setShift(bool onShift) async {
    state = const AsyncLoading();
    try {
      await ref.read(driverApiProvider).setShift(onShift);
      ref.invalidate(profileProvider);
      ref.invalidate(jobsProvider);
      state = const AsyncData(null);
      return null;
    } on Failure catch (error, stack) {
      state = AsyncError(error, stack);
      return error;
    }
  }
}

final shiftControllerProvider =
    NotifierProvider<ShiftController, AsyncValue<void>>(ShiftController.new);
