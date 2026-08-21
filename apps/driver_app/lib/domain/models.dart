import 'ride_status.dart';
import 'driver_authority.dart';

/// A position fix taken by this device.
class Fix {
  const Fix({
    required this.latitude,
    required this.longitude,
    required this.capturedAt,
    this.accuracyMeters = 12,
    this.speedMetersPerSecond,
  });

  final double latitude;
  final double longitude;

  /// When the **device** took the reading. Everything the family sees is aged
  /// against this rather than against arrival time, which is precisely what
  /// makes a queue flushed after a tunnel safe to send.
  final DateTime capturedAt;

  final double accuracyMeters;

  /// From the platform's own fix. Used locally to decide how often to sample —
  /// cadence follows movement — and deliberately not sent: the server has no
  /// use for it, and a position report should carry the position and nothing
  /// it could be second-guessed by.
  final double? speedMetersPerSecond;

  /// Note what is absent: an arrival estimate. The server computes that from
  /// the reported position, because an ETA is a promise made to somebody
  /// waiting by a window — and a device that could set it could hold a family
  /// at "two minutes" indefinitely.
  Map<String, dynamic> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
    'accuracyMeters': accuracyMeters,
    'capturedAt': capturedAt.toUtc().toIso8601String(),
  };
}

/// The vehicle the operator has put this driver in.
class Vehicle {
  const Vehicle({
    required this.make,
    required this.model,
    required this.color,
    required this.licensePlate,
    required this.isWheelchairAccessible,
  });

  final String make;
  final String model;
  final String color;
  final String licensePlate;
  final bool isWheelchairAccessible;

  String get description => '$color $make $model';
}

/// The signed-in driver.
class DriverProfile {
  const DriverProfile({
    required this.driverId,
    required this.organizationName,
    required this.displayName,
    required this.status,
    required this.onShift,
    required this.canWork,
    required this.vehicle,
    this.suspensionReason,
  });

  final String driverId;
  final String organizationName;
  final String displayName;
  final String status;
  final bool onShift;

  /// Whether the operator has approved this driver to carry a passenger at
  /// all. Distinct from [onShift], which is a scheduling fact that changes
  /// several times a day.
  final bool canWork;

  final Vehicle vehicle;
  final String? suspensionReason;
}

/// A postal address, with the note that stops a driver waiting at the wrong
/// entrance while a passenger waits at the right one.
class Place {
  const Place({
    required this.label,
    required this.line1,
    required this.city,
    required this.state,
    required this.postalCode,
    this.line2,
    this.accessNotes,
  });

  final String label;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String postalCode;
  final String? accessNotes;

  String get oneLine => [
    line1,
    if (line2 != null && line2!.isNotEmpty) line2,
    '$city, $state $postalCode',
  ].join(', ');
}

/// One piece of work.
class Job {
  const Job({
    required this.id,
    required this.status,
    required this.scheduledPickupAt,
    required this.passengerName,
    required this.pickup,
    required this.destination,
    required this.wheelchairRequired,
    required this.assistanceRequired,
    required this.availableTransitions,
    this.passengerPhone,
    this.notesForDriver,
    this.isDelayed = false,
    this.noShowAvailableInSeconds,
  });

  final String id;
  final RideStatus status;
  final DateTime scheduledPickupAt;
  final String passengerName;
  final String? passengerPhone;
  final Place pickup;
  final Place destination;
  final bool wheelchairRequired;
  final bool assistanceRequired;
  final String? notesForDriver;
  final bool isDelayed;

  /// What the server says this driver may do next. Advisory — the server
  /// asserts it again — but it is what decides which button appears.
  final List<RideStatus> availableTransitions;

  /// Seconds left on the kerbside wait, or null when a no-show is not on
  /// offer. Counted down locally between refreshes so the button does not sit
  /// there refusing without explaining itself.
  final int? noShowAvailableInSeconds;

  /// Whether the device should be sampling for this job.
  bool get sharesLocation => sharesLocationFor(status);

  /// The single move a driver is normally offered. `driverArrived` is the one
  /// state with two, and the second — a no-show — is deliberately not the
  /// primary button.
  RideStatus? get primaryMove => availableTransitions
      .where((move) => move != RideStatus.noShow)
      .firstOrNull;

  bool get offersNoShow => availableTransitions.contains(RideStatus.noShow);

  bool get noShowReady => (noShowAvailableInSeconds ?? 1) <= 0;
}

/// Named so it does not collide with [Job.sharesLocation].
bool sharesLocationFor(RideStatus status) => sharesLocation(status);

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
