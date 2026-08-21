import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:geolocator/geolocator.dart';

import '../domain/location_cadence.dart';
import '../domain/models.dart';

/// Whether the operating system will give this app positions.
enum LocationAccess {
  granted,

  /// The driver said no, and can be asked again.
  denied,

  /// The driver said no permanently, or an administrator did. Asking again
  /// does nothing; the only way out is the system settings screen, and the app
  /// has to say so rather than showing a button that silently fails.
  blocked,

  /// Location services are switched off device-wide.
  disabled,
}

/// Where fixes come from.
///
/// A port, for the same reason every other outside dependency in this codebase
/// is one: the cadence rules and the queue are the parts worth testing, and
/// they must be testable without a satellite. The tests drive a fake; the app
/// runs [GeolocatorPositionSource].
abstract class PositionSource {
  Future<LocationAccess> ensureAccess();

  /// Fixes at roughly [cadence], for as long as the stream is listened to.
  ///
  /// The interval is a **request** to the platform rather than a timer here,
  /// and that distinction is the whole battery argument: a timer would leave
  /// the GPS radio running continuously and merely discard most of what it
  /// produced. Asking the platform for a slower rate is what actually costs
  /// less.
  Stream<Fix> watch({required Duration cadence});

  Future<void> stop();
}

/// The real one.
class GeolocatorPositionSource implements PositionSource {
  StreamSubscription<Position>? _subscription;

  @override
  Future<LocationAccess> ensureAccess() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.disabled;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    return switch (permission) {
      LocationPermission.always ||
      LocationPermission.whileInUse => LocationAccess.granted,
      LocationPermission.deniedForever => LocationAccess.blocked,
      _ => LocationAccess.denied,
    };
  }

  @override
  Stream<Fix> watch({required Duration cadence}) {
    final controller = StreamController<Fix>(onCancel: () => unawaited(stop()));

    _subscription?.cancel();
    _subscription =
        Geolocator.getPositionStream(
          locationSettings: _settingsFor(cadence),
        ).listen(
          (position) => controller.add(_fixFrom(position)),
          // A platform error mid-shift is not a reason to tear the screen down.
          // The queue simply stops filling, the family's map goes stale, and the
          // watchdog on the server says so — which is the honest outcome.
          onError: controller.addError,
        );

    return controller.stream;
  }

  /// Android gets a foreground service; iOS gets background updates.
  ///
  /// Both are the same requirement wearing different clothes. A ride is half
  /// an hour of driving with the phone in a cradle, behind a navigation app or
  /// with the screen off, and without these Android stops delivering positions
  /// within minutes — the family's map freezes with no error anywhere, which
  /// is precisely the silent failure this product cannot have.
  LocationSettings _settingsFor(Duration cadence) => AndroidSettings(
    accuracy: LocationAccuracy.high,
    intervalDuration: cadence,
    // Movement, not just time. A parked car produces no callbacks at all,
    // which is the cheapest possible cadence and needs no rule to arrange.
    distanceFilter: 10,
    foregroundNotificationConfig: const ForegroundNotificationConfig(
      notificationTitle: 'CareBridge — on a ride',
      notificationText: 'Sharing your location with the passenger’s family.',
      // Says what is being shared and with whom, every second it is happening.
      // A location notification that reads "running in the background" tells
      // the person carrying the phone nothing they need to know.
      enableWakeLock: true,
      setOngoing: true,
    ),
  );

  Fix _fixFrom(Position position) => Fix(
    latitude: position.latitude,
    longitude: position.longitude,
    // The device's own clock, which is what everything downstream ages
    // against. Using arrival time would render a queue flushed after a tunnel
    // as a burst of fresh positions.
    capturedAt: position.timestamp.toUtc(),
    accuracyMeters: position.accuracy,
    speedMetersPerSecond: position.speed,
  );

  @override
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }
}

/// What the cadence rule reads about the battery.
/// One look at the battery.
///
/// The raw figures rather than the band, because two callers want different
/// things from the same platform read: the cadence rule wants three bands, and
/// the field-test recorder wants the percentage and whether it is climbing. A
/// port that answered only in bands would have the recorder taking a second
/// reading to learn something the first one already knew.
class BatteryReading {
  const BatteryReading({this.percent, this.charging = false});

  /// Null when the platform will not say.
  final int? percent;
  final bool charging;

  BatteryPressure get pressure =>
      BatteryPressure.from(percent: percent, charging: charging);
}

abstract class BatterySource {
  Future<BatteryReading> read();
}

class BatteryPlusSource implements BatterySource {
  final _battery = Battery();

  @override
  Future<BatteryReading> read() async {
    try {
      final level = await _battery.batteryLevel;
      final state = await _battery.batteryState;
      return BatteryReading(
        percent: level,
        charging: state == BatteryState.charging || state == BatteryState.full,
      );
    } catch (_) {
      // A platform that will not answer is not a reason to back off. Assuming
      // the worst here would slow every driver's cadence on any device whose
      // battery API misbehaves.
      return const BatteryReading();
    }
  }
}
