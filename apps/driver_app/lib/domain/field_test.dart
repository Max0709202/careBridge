import 'location_cadence.dart';
import 'ride_status.dart';

/// One thing that happened during a shift, worth measuring afterwards.
///
/// The field test FOUNDATION asks for is a real-device trip on a real road,
/// and the trouble with such a test is that it produces anecdotes. "The
/// battery seemed fine" and "it went quiet near the bridge" are not results
/// anybody can act on six months later, and they are certainly not a basis for
/// changing a cadence number.
///
/// So the app records. Every sample, every cadence change, every failed flush
/// and every battery reading, with a timestamp, in memory, exportable as CSV.
/// What comes back from a drive is then a file rather than a memory.
enum FieldEvent {
  /// A position fix arrived from the platform.
  fix,

  /// The cadence rule asked for a different interval, so the platform stream
  /// was re-subscribed. Counted because each one restarts the Android
  /// foreground service, and doing it often would be its own problem.
  cadenceChanged,

  /// A batch went to the server.
  flushSucceeded,

  /// A batch did not. The interesting number in a coverage test: how long the
  /// runs of these are, and where they start.
  flushFailed,

  /// The queue dropped its oldest entry because it was full — which should
  /// never happen on a real trip, and means the dead zone outlasted the design
  /// if it does.
  queueOverflowed,

  /// A periodic reading, taken whether or not anything else happened.
  heartbeat,
}

/// A single row in the log.
class FieldSample {
  const FieldSample({
    required this.at,
    required this.event,
    required this.status,
    this.cadenceSeconds,
    this.speedMetersPerSecond,
    this.batteryPercent,
    this.charging = false,
    this.queueDepth = 0,
    this.accuracyMeters,
    this.note,
  });

  final DateTime at;
  final FieldEvent event;
  final RideStatus status;
  final int? cadenceSeconds;
  final double? speedMetersPerSecond;
  final int? batteryPercent;
  final bool charging;
  final int queueDepth;
  final double? accuracyMeters;
  final String? note;

  /// Deliberately **no coordinates**.
  ///
  /// This file leaves the device and is read by whoever ran the test. It is a
  /// record of how the app behaved, not of where a driver went — and a
  /// diagnostic export that carries a passenger's route is a diagnostic export
  /// that has to be handled like a medical record.
  List<String> toCsvRow() => [
    at.toUtc().toIso8601String(),
    event.name,
    status.name,
    cadenceSeconds?.toString() ?? '',
    speedMetersPerSecond?.toStringAsFixed(1) ?? '',
    batteryPercent?.toString() ?? '',
    charging ? 'yes' : 'no',
    queueDepth.toString(),
    accuracyMeters?.toStringAsFixed(0) ?? '',
    note?.replaceAll(',', ';') ?? '',
  ];

  static const csvHeader = [
    'at',
    'event',
    'rideStatus',
    'cadenceSeconds',
    'speedMps',
    'batteryPercent',
    'charging',
    'queueDepth',
    'accuracyMeters',
    'note',
  ];
}

/// What a drive is judged on.
///
/// The thresholds come from FOUNDATION's own acceptance criteria and from
/// ADR-0005's revisit trigger, so a run either satisfies the things already
/// written down or it does not. Computed rather than eyeballed, because
/// "seemed fine" is how a battery regression ships.
class FieldTestVerdict {
  const FieldTestVerdict({
    required this.duration,
    required this.fixes,
    required this.batteryDrainPercent,
    required this.projectedFourHourDrainPercent,
    required this.longestGap,
    required this.failedFlushes,
    required this.cadenceChanges,
    required this.queueOverflowed,
  });

  final Duration duration;
  final int fixes;

  /// Start minus end. Null when the phone was charging, which invalidates the
  /// battery half of the test — a phone in a cradle on a charger tells you
  /// nothing about drain, and pretending otherwise is how a bad number gets
  /// written down as a good one.
  final int? batteryDrainPercent;

  /// Extrapolated to the four hours ADR-0005 sets its threshold against.
  final double? projectedFourHourDrainPercent;

  /// The longest the family's map went without a new position. The number the
  /// whole tracking design exists to keep small.
  final Duration longestGap;

  final int failedFlushes;
  final int cadenceChanges;
  final bool queueOverflowed;

  /// ADR-0005 revisits the decision if drain exceeds 25% over four hours.
  bool get batteryAcceptable =>
      projectedFourHourDrainPercent == null ||
      projectedFourHourDrainPercent! <= 25;

  /// A gap longer than the lost bound means the family saw no position at all
  /// for that stretch — the failure the whole slice exists to avoid.
  bool get coverageAcceptable => longestGap <= const Duration(minutes: 2);

  bool get passed =>
      batteryAcceptable && coverageAcceptable && !queueOverflowed;
}

/// Derives the verdict from a log.
///
/// Pure, and separate from the recorder, so the arithmetic that decides whether
/// a drive passed can be tested without driving.
FieldTestVerdict verdictFor(List<FieldSample> samples) {
  if (samples.isEmpty) {
    return const FieldTestVerdict(
      duration: Duration.zero,
      fixes: 0,
      batteryDrainPercent: null,
      projectedFourHourDrainPercent: null,
      longestGap: Duration.zero,
      failedFlushes: 0,
      cadenceChanges: 0,
      queueOverflowed: false,
    );
  }

  final ordered = [...samples]..sort((a, b) => a.at.compareTo(b.at));
  final duration = ordered.last.at.difference(ordered.first.at);

  final fixes = ordered.where((s) => s.event == FieldEvent.fix).toList();

  Duration longestGap = Duration.zero;
  for (var i = 1; i < fixes.length; i++) {
    final gap = fixes[i].at.difference(fixes[i - 1].at);
    if (gap > longestGap) longestGap = gap;
  }

  // Any charging reading at all disqualifies the battery measurement. A phone
  // that spent ten minutes on a cradle charger produces a drain figure that
  // looks excellent and means nothing.
  final charged = ordered.any((s) => s.charging);
  final readings = ordered
      .where((s) => s.batteryPercent != null)
      .map((s) => s.batteryPercent!)
      .toList();

  int? drain;
  double? projected;
  if (!charged && readings.length >= 2) {
    drain = readings.first - readings.last;
    final hours = duration.inSeconds / 3600;
    // Below ten minutes the extrapolation is noise: a single percentage point
    // of a coarse battery gauge becomes a wild four-hour figure.
    if (hours >= 1 / 6) projected = (drain / hours) * 4;
  }

  return FieldTestVerdict(
    duration: duration,
    fixes: fixes.length,
    batteryDrainPercent: drain,
    projectedFourHourDrainPercent: projected,
    longestGap: longestGap,
    failedFlushes: ordered
        .where((s) => s.event == FieldEvent.flushFailed)
        .length,
    cadenceChanges: ordered
        .where((s) => s.event == FieldEvent.cadenceChanged)
        .length,
    queueOverflowed: ordered.any((s) => s.event == FieldEvent.queueOverflowed),
  );
}

/// The whole log as a CSV document.
String toCsv(List<FieldSample> samples) {
  final rows = [
    FieldSample.csvHeader.join(','),
    for (final sample in samples) sample.toCsvRow().join(','),
  ];
  return rows.join('\n');
}

/// A one-paragraph summary, for pasting into the results table.
String summarise(FieldTestVerdict verdict) {
  final battery = verdict.projectedFourHourDrainPercent == null
      ? 'not measurable (the phone was charging)'
      : '${verdict.projectedFourHourDrainPercent!.toStringAsFixed(1)}% over four hours';

  return [
    'Duration ${verdict.duration.inMinutes} min',
    '${verdict.fixes} fixes',
    'longest gap ${verdict.longestGap.inSeconds}s',
    '${verdict.failedFlushes} failed flushes',
    '${verdict.cadenceChanges} cadence changes',
    'battery $battery',
    verdict.passed ? 'PASS' : 'FAIL',
  ].join(' · ');
}

/// The cadence the recorder should sample its heartbeat at.
///
/// Independent of the location cadence on purpose: a battery reading every
/// thirty seconds is what makes a drain curve rather than two endpoints, and it
/// must keep happening when the location cadence has backed off to ninety
/// seconds — which is exactly the interval a battery measurement most wants to
/// see.
const fieldHeartbeat = Duration(seconds: 30);

/// Sanity check that the recorder is not itself the thing draining the phone.
bool heartbeatIsCheaperThanSampling(Duration locationCadence) =>
    fieldHeartbeat >= locationCadence || locationCadence >= staleAfter;
