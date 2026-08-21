import 'dart:async';

import '../domain/field_test.dart';
import '../domain/ride_status.dart';
import 'position_source.dart';

/// Keeps the log a field test is judged from.
///
/// Off unless `--dart-define=CAREBRIDGE_FIELD_TEST=true`. Not because the
/// recording is expensive — a row every thirty seconds is nothing — but because
/// an app that is always writing a behavioural log is an app with a
/// behavioural log to leak, and the export is only useful to somebody who is
/// deliberately running a test.
class FieldRecorder {
  FieldRecorder({required this.battery, bool? enabled})
    : enabled = enabled ?? _configured;

  static const _configured = bool.fromEnvironment(
    'CAREBRIDGE_FIELD_TEST',
    defaultValue: false,
  );

  final BatterySource battery;
  final bool enabled;

  final List<FieldSample> _samples = [];
  Timer? _heartbeat;

  RideStatus _status = RideStatus.driverEnRoute;
  Duration? _cadence;
  int _queueDepth = 0;

  List<FieldSample> get samples => List.unmodifiable(_samples);
  bool get isRecording => _heartbeat != null;

  /// Begins a run. Discards whatever came before: a field test is one drive,
  /// and merging two would produce a battery curve that steps upwards in the
  /// middle for no reason a reader could work out.
  void start() {
    if (!enabled) return;

    _samples.clear();
    _heartbeat?.cancel();
    // Independent of the location cadence, and that is the point: a battery
    // reading every thirty seconds is what makes a drain curve rather than two
    // endpoints, and it has to keep happening when location has backed off to
    // ninety seconds — which is exactly when the curve is most wanted.
    _heartbeat = Timer.periodic(
      fieldHeartbeat,
      (_) => record(FieldEvent.heartbeat),
    );
    record(FieldEvent.heartbeat, note: 'started');
  }

  void stop() {
    if (!enabled) return;
    record(FieldEvent.heartbeat, note: 'stopped');
    _heartbeat?.cancel();
    _heartbeat = null;
  }

  /// Told by the location service, so the log knows which phase each row is in.
  void observe({RideStatus? status, Duration? cadence, int? queueDepth}) {
    if (!enabled) return;

    if (cadence != null && cadence != _cadence) {
      _cadence = cadence;
      record(FieldEvent.cadenceChanged);
    }
    if (status != null) _status = status;
    if (queueDepth != null) _queueDepth = queueDepth;
  }

  void record(
    FieldEvent event, {
    double? speedMetersPerSecond,
    double? accuracyMeters,
    String? note,
  }) {
    if (!enabled) return;

    // The battery read is asynchronous and the caller is not. Recorded with
    // whatever the last reading was and corrected on the next heartbeat, which
    // is close enough for a curve sampled every thirty seconds and avoids
    // making every fix await a platform channel. One read is in flight at a
    // time, so the instrument does not become part of what it is measuring.
    unawaited(_readBattery());

    _samples.add(
      FieldSample(
        at: DateTime.now().toUtc(),
        event: event,
        status: _status,
        cadenceSeconds: _cadence?.inSeconds,
        speedMetersPerSecond: speedMetersPerSecond,
        batteryPercent: _lastPercent,
        charging: _lastCharging,
        queueDepth: _queueDepth,
        accuracyMeters: accuracyMeters,
        note: note,
      ),
    );
  }

  int? _lastPercent;
  bool _lastCharging = false;
  bool _reading = false;

  Future<void> _readBattery() async {
    if (_reading) return;
    _reading = true;
    try {
      final reading = await battery.read();
      _lastPercent = reading.percent;
      _lastCharging = reading.charging;
    } catch (_) {
      // A device whose battery API will not answer still produces a coverage
      // result, which is half the test.
    } finally {
      _reading = false;
    }
  }

  String exportCsv() => toCsv(_samples);

  FieldTestVerdict get verdict => verdictFor(_samples);

  void dispose() {
    _heartbeat?.cancel();
    _heartbeat = null;
  }
}
