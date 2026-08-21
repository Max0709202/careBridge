import 'dart:async';

import '../data/driver_api.dart';
import '../data/location_queue.dart';
import '../domain/location_cadence.dart';
import '../domain/models.dart';
import '../domain/ride_status.dart';
import 'position_source.dart';

/// What the screen needs to know about location sharing.
class SharingState {
  const SharingState({
    this.rideId,
    this.access = LocationAccess.granted,
    this.queued = 0,
    this.lastSentAt,
    this.cadence,
  });

  /// The ride being followed, or null when nothing is being shared.
  final String? rideId;

  final LocationAccess access;

  /// How many fixes are waiting for signal. Shown to the driver, because a
  /// number that keeps climbing is the only visible sign of a dead zone — and
  /// a driver who can see it can mention it.
  final int queued;

  final DateTime? lastSentAt;

  /// The interval currently being asked of the platform. Surfaced so the
  /// battery back-off is visible rather than mysterious: a driver whose app
  /// suddenly updates less often deserves to be told why.
  final Duration? cadence;

  bool get sharing => rideId != null;
}

/// Samples position for the ride in hand, and gets it to the server.
///
/// The three parts are deliberately separate and separately testable: when to
/// sample ([cadenceFor]), what to do with a fix that cannot be sent
/// ([LocationQueue]), and where fixes come from ([PositionSource]). This class
/// is only the wiring between them.
///
/// It stops when the ride stops, and that is not a detail. Location is
/// collectable only while the ride is in a state that permits it — the server
/// enforces it on arrival and this mirrors it, so the app never spends battery
/// filling a queue that can never be flushed.
class LocationService {
  LocationService({
    required this.api,
    required this.positions,
    required this.battery,
    LocationQueue? queue,
    this.batchSize = 240,
  }) : _queue = queue ?? LocationQueue();

  final DriverApi api;
  final PositionSource positions;
  final BatterySource battery;
  final LocationQueue _queue;

  /// The server's own cap on one batch. Matching it means a long backlog
  /// drains in several requests rather than being refused whole.
  final int batchSize;

  final _states = StreamController<SharingState>.broadcast();
  Stream<SharingState> get states => _states.stream;

  StreamSubscription<Fix>? _fixes;
  String? _rideId;

  /// The phase the current subscription was opened for.
  ///
  /// Held rather than re-read on each fix: `follow` is the only thing that
  /// knows it, and a fix arriving between polls must not be classified against
  /// a status this service has not been told about.
  RideStatus _status = RideStatus.driverEnRoute;

  Duration? _cadence;
  BatteryPressure _pressure = BatteryPressure.none;
  DateTime? _lastSentAt;
  bool _flushing = false;
  LocationAccess _access = LocationAccess.granted;

  SharingState get state => SharingState(
    rideId: _rideId,
    access: _access,
    queued: _queue.length,
    lastSentAt: _lastSentAt,
    cadence: _cadence,
  );

  /// Follows [job], or stops if it is null or no longer shareable.
  ///
  /// Called every time the work list refreshes. Idempotent: following the same
  /// ride in the same phase changes nothing, which matters because the phase
  /// is re-read on every poll and restarting the platform stream would flicker
  /// the foreground notification several times a minute.
  Future<void> follow(Job? job) async {
    if (job == null || !job.sharesLocation) {
      await stop();
      return;
    }

    if (_rideId != null && _rideId != job.id) {
      // A different ride. The old queue belongs to a journey that is over, and
      // sending it now would write positions the server would refuse anyway.
      _queue.clear();
    }
    _rideId = job.id;
    _status = job.status;

    _pressure = await battery.pressure();
    final wanted = cadenceFor(
      CadenceInputs(status: job.status, battery: _pressure),
    );
    if (wanted == null) {
      await stop();
      return;
    }

    if (_fixes == null) {
      _access = await positions.ensureAccess();
      if (_access != LocationAccess.granted) {
        _publish();
        return;
      }
    }

    await _subscribe(wanted);
    _publish();
  }

  /// Stops sampling and forgets what was queued.
  ///
  /// The queue goes with the subscription rather than being flushed on the way
  /// out. Once a ride reaches a state that does not permit sharing, its
  /// positions are no longer collectable — a farewell flush would be sending
  /// exactly the readings the rule exists to stop.
  Future<void> stop() async {
    if (_rideId == null && _fixes == null) return;

    await _fixes?.cancel();
    _fixes = null;
    await positions.stop();
    _queue.clear();
    _rideId = null;
    _cadence = null;
    _publish();
  }

  Future<void> dispose() async {
    await stop();
    await _states.close();
  }

  Future<void> _subscribe(Duration cadence) async {
    // Re-subscribing is what actually changes the rate the platform runs the
    // radio at, so it cannot be skipped — but it restarts the foreground
    // service, so it is done only when the interval genuinely changes. The
    // cadence rule returns one of a handful of values, which makes that a few
    // times a ride rather than continuously.
    if (_fixes != null && _cadence == cadence) return;

    await _fixes?.cancel();
    _cadence = cadence;
    _fixes = positions.watch(cadence: cadence).listen(_onFix, onError: (_) {});
  }

  Future<void> _onFix(Fix fix) async {
    final rideId = _rideId;
    if (rideId == null) return;

    _queue.add(fix);
    _publish();

    // Speed comes from the fix that has just arrived, so the cadence responds
    // to the car actually setting off rather than to a status change somebody
    // remembered to make.
    final wanted = cadenceFor(
      CadenceInputs(
        status: _status,
        speedMetersPerSecond: fix.speedMetersPerSecond,
        battery: _pressure,
      ),
    );
    if (wanted != null && wanted != _cadence) await _subscribe(wanted);

    await _flush(rideId);
  }

  Future<void> _flush(String rideId) async {
    if (_flushing || _queue.isEmpty) return;
    _flushing = true;

    try {
      final batch = _queue.peek(max: batchSize, now: DateTime.now().toUtc());
      if (batch.isEmpty) return;

      await api.flush(rideId, batch);
      _queue.commit(batch);
      _lastSentAt = DateTime.now();
    } catch (_) {
      // Kept. The next fix tries again, which on a patchy road is a retry
      // every few seconds without a timer to leak.
    } finally {
      _flushing = false;
      _publish();
    }
  }

  void _publish() {
    if (!_states.isClosed) _states.add(state);
  }
}
