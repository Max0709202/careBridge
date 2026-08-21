/// How often the device takes a position fix.
///
/// This exists because of a named risk rather than a preference: continuous
/// high-rate GPS across an eight-hour shift flattens a phone, and a driver
/// whose phone dies is a driver who stops using the app — the failure mode is
/// not a bad map, it is no map at all.
///
/// The governing idea is that **cadence should track how fast the answer is
/// changing, not how much anyone cares about it.** A car stopped at a red
/// light two hundred metres from the house is the moment a daughter is
/// refreshing hardest, and it is also the moment when sampling twice a second
/// would produce the same coordinate two hundred times. Sampling follows
/// movement.
///
/// One number is deliberately outside the range the rest respects:
/// [_criticalBattery]. Every other cadence here is shorter than
/// [staleAfter], so a working device is never labelled out of date. Below five
/// per cent, the app accepts being labelled stale in order to leave the driver
/// a phone that can still make a telephone call and run a navigation app. A
/// visibly stale marker with a working driver behind it is a far better
/// outcome than a fresh marker that stops for good twenty minutes later.
library;

import 'ride_status.dart';
import 'driver_authority.dart';

/// The freshness bound the family's screen uses, mirrored from
/// apps/api/src/domain/tracking.ts. Every ordinary cadence below stays inside
/// it; see the note about critical battery above.
const staleAfter = Duration(seconds: 45);

/// Below this, the vehicle is not moving in any way the map can show.
///
/// One metre per second is a slow walking pace — chosen rather than zero
/// because a stationary GPS fix wanders by a few metres a second on its own,
/// and a threshold of zero would classify a parked car as moving.
const stationarySpeed = 1.0;

/// Approaching the pickup: the fastest ordinary rate.
///
/// This is the stretch where the question being asked is "is the car outside
/// yet", and it is also the shortest — a few minutes at most, so the battery
/// cost is bounded by the phase itself.
const _approaching = Duration(seconds: 4);

/// Carrying a passenger, or driving between stops. Half the pace of the
/// approach: the interesting question has become the arrival time rather than
/// the doorstep, and an ETA does not improve with a four-second fix.
const _driving = Duration(seconds: 10);

/// Stopped — at a light, in traffic, or parked at the kerb. Slow enough to
/// cost almost nothing, still comfortably inside [staleAfter] so the position
/// never carries a warning it has not earned.
const _stopped = Duration(seconds: 25);

/// Below fifteen per cent, and not charging.
const _lowBattery = Duration(seconds: 30);

/// Below five per cent, and not charging. The one cadence that exceeds
/// [staleAfter], for the reason set out at the top of this file.
const _criticalBattery = Duration(seconds: 90);

/// How the battery is doing, as the cadence rule cares about it.
enum BatteryPressure {
  /// Plenty, or plugged into the cradle — which is where a working driver's
  /// phone spends most of a shift, and why the ordinary cadences can afford
  /// to be as short as they are.
  none,
  low,
  critical;

  static BatteryPressure from({int? percent, bool charging = false}) {
    // Charging outranks the reading. A phone at four per cent on a car charger
    // is a phone that will be at forty in half an hour, and backing off then
    // would mean the map degrades exactly when the driver has just plugged in.
    if (charging || percent == null) return BatteryPressure.none;
    if (percent <= 5) return BatteryPressure.critical;
    if (percent <= 15) return BatteryPressure.low;
    return BatteryPressure.none;
  }
}

/// Everything the cadence rule reads.
class CadenceInputs {
  const CadenceInputs({
    required this.status,
    this.speedMetersPerSecond,
    this.battery = BatteryPressure.none,
  });

  final RideStatus status;

  /// From the last fix. Null when nothing has been measured yet, which is
  /// treated as moving — the alternative is opening a ride at the slow rate
  /// and taking half a minute to notice the car has set off.
  final double? speedMetersPerSecond;

  final BatteryPressure battery;

  bool get isStationary {
    final speed = speedMetersPerSecond;
    return speed != null && speed < stationarySpeed;
  }
}

/// How long to wait before the next fix, or null to stop sampling entirely.
///
/// Null is the most important answer here. Location is collectable only while
/// the ride is in a state that permits it, and that rule is the server's — this
/// mirrors it so the app never fills a queue with readings the server would
/// refuse, which would spend a battery to build something unflushable.
///
/// The first fix after a phase change is taken immediately by the caller
/// rather than after an interval: a driver who has just tapped "I have
/// arrived" should not wait twenty-five seconds for the family's map to agree
/// with them.
Duration? cadenceFor(CadenceInputs inputs) {
  if (!sharesLocation(inputs.status)) return null;

  // Battery first, and unconditionally. Every other consideration here is
  // about the quality of somebody's map; this one is about whether the driver
  // still has a phone at four o'clock.
  switch (inputs.battery) {
    case BatteryPressure.critical:
      return _criticalBattery;
    case BatteryPressure.low:
      return _lowBattery;
    case BatteryPressure.none:
      break;
  }

  // A stopped car reports the same coordinate however often it is asked. This
  // sits above the phase rules deliberately: being stopped two hundred metres
  // from the pickup is still being stopped.
  if (inputs.isStationary) return _stopped;

  return switch (inputs.status) {
    RideStatus.driverEnRoute => _approaching,
    // Parked at the kerb with the engine running. Speed may read as noise
    // above the threshold, so the phase says what the speed cannot.
    RideStatus.driverArrived || RideStatus.arrivedAtDestination => _stopped,
    _ => _driving,
  };
}
