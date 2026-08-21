import 'package:carebridge_driver/domain/field_test.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:flutter_test/flutter_test.dart';

/// The arithmetic that decides whether a real-device drive passed.
///
/// Tested without driving, which is the point of separating it from the
/// recorder. The thresholds are not invented here — they come from ADR-0005's
/// revisit trigger (25% over four hours) and from the tracking design's own
/// lost bound (two minutes) — so a run either satisfies what is already
/// written down or it does not.

final start = DateTime.utc(2026, 6, 15, 9);

FieldSample sample(
  int minute, {
  FieldEvent event = FieldEvent.fix,
  int? battery,
  bool charging = false,
  int queueDepth = 0,
}) => FieldSample(
  at: start.add(Duration(minutes: minute)),
  event: event,
  status: RideStatus.driverEnRoute,
  batteryPercent: battery,
  charging: charging,
  queueDepth: queueDepth,
);

void main() {
  group('an empty log', () {
    test('produces a verdict rather than throwing', () {
      // A drive that recorded nothing is a result too — usually "the recorder
      // was not switched on", which somebody needs to be told rather than
      // shown a crash.
      final verdict = verdictFor([]);
      expect(verdict.fixes, 0);
      expect(verdict.duration, Duration.zero);
    });
  });

  group('coverage', () {
    test('measures the longest the map went without a position', () {
      // The number the whole tracking design exists to keep small.
      final verdict = verdictFor([sample(0), sample(1), sample(6), sample(7)]);

      expect(verdict.longestGap, const Duration(minutes: 5));
    });

    test('fails a gap longer than a position is allowed to live', () {
      final verdict = verdictFor([sample(0), sample(5)]);
      expect(verdict.coverageAcceptable, isFalse);
      expect(verdict.passed, isFalse);
    });

    test('passes a drive with no gap worth naming', () {
      final verdict = verdictFor([
        for (var i = 0; i < 30; i++) sample(i, battery: 100 - i ~/ 4),
      ]);
      expect(verdict.coverageAcceptable, isTrue);
    });

    test('ignores events that are not fixes when measuring gaps', () {
      // A heartbeat every thirty seconds must not disguise a five-minute hole
      // in the actual position stream.
      final verdict = verdictFor([
        sample(0),
        sample(2, event: FieldEvent.heartbeat),
        sample(4, event: FieldEvent.heartbeat),
        sample(6),
      ]);

      expect(verdict.longestGap, const Duration(minutes: 6));
    });
  });

  group('battery', () {
    test('projects the drain onto the four hours the threshold uses', () {
      // Two per cent over thirty minutes is sixteen per cent over four hours.
      final verdict = verdictFor([
        sample(0, battery: 80),
        sample(30, battery: 78),
      ]);

      expect(verdict.batteryDrainPercent, 2);
      expect(verdict.projectedFourHourDrainPercent, closeTo(16, 0.1));
      expect(verdict.batteryAcceptable, isTrue);
    });

    test('fails a drain past the trigger ADR-0005 named', () {
      final verdict = verdictFor([
        sample(0, battery: 80),
        sample(30, battery: 74),
      ]);

      expect(verdict.projectedFourHourDrainPercent, closeTo(48, 0.1));
      expect(verdict.batteryAcceptable, isFalse);
      expect(verdict.passed, isFalse);
    });

    test('refuses to measure a phone that was charging', () {
      // A phone in a cradle on a charger produces a drain figure that looks
      // excellent and means nothing. Reporting it would be worse than
      // reporting nothing.
      final verdict = verdictFor([
        sample(0, battery: 80),
        sample(15, battery: 82, charging: true),
        sample(30, battery: 90),
      ]);

      expect(verdict.batteryDrainPercent, isNull);
      expect(verdict.projectedFourHourDrainPercent, isNull);
      // And it does not fail the run for it — the coverage half is still valid.
      expect(verdict.batteryAcceptable, isTrue);
    });

    test('does not extrapolate from a drive too short to mean anything', () {
      // One percentage point of a coarse gauge over five minutes becomes a
      // wild four-hour figure.
      final verdict = verdictFor([
        sample(0, battery: 80),
        sample(5, battery: 79),
      ]);

      expect(verdict.batteryDrainPercent, 1);
      expect(verdict.projectedFourHourDrainPercent, isNull);
    });
  });

  group('the queue', () {
    test('fails a run where the buffer overflowed', () {
      // Should never happen on a real trip. If it does, the dead zone outlasted
      // what the queue was designed for, which is a finding rather than a bug.
      final verdict = verdictFor([
        sample(0),
        sample(1, event: FieldEvent.queueOverflowed),
        sample(2),
      ]);

      expect(verdict.queueOverflowed, isTrue);
      expect(verdict.passed, isFalse);
    });

    test('counts failed flushes without failing the run for them', () {
      // A dead zone is expected. What matters is whether the queue survived
      // it, which the overflow flag answers.
      final verdict = verdictFor([
        for (var i = 0; i < 30; i++) sample(i, battery: 80 - i ~/ 15),
        sample(10, event: FieldEvent.flushFailed),
        sample(11, event: FieldEvent.flushFailed),
      ]);

      expect(verdict.failedFlushes, 2);
      // The fixes kept arriving throughout — the queue held them, which is
      // exactly what a dead zone is supposed to look like from the outside.
      expect(verdict.longestGap, const Duration(minutes: 1));
      expect(verdict.passed, isTrue);
    });
  });

  group('the export', () {
    test('carries no coordinates', () {
      // This file leaves the device. It is a record of how the app behaved,
      // not of where a driver went — an export carrying a passenger's route
      // would have to be handled like a medical record.
      final csv = toCsv([sample(0, battery: 80)]);

      expect(csv, isNot(contains('latitude')));
      expect(csv, isNot(contains('longitude')));
      expect(FieldSample.csvHeader, isNot(contains('latitude')));
    });

    test('is a header and one row per sample', () {
      final csv = toCsv([sample(0), sample(1)]);
      expect(csv.split('\n'), hasLength(3));
      expect(csv.split('\n').first, startsWith('at,event,rideStatus'));
    });

    test('does not let a note break the columns', () {
      final csv = toCsv([
        FieldSample(
          at: start,
          event: FieldEvent.heartbeat,
          status: RideStatus.inProgress,
          note: 'went quiet, then came back',
        ),
      ]);

      expect(
        csv.split('\n')[1].split(',').length,
        FieldSample.csvHeader.length,
      );
    });
  });

  group('the summary', () {
    test('says pass or fail in words', () {
      final good = verdictFor([
        for (var i = 0; i < 40; i++) sample(i, battery: 90 - i ~/ 10),
      ]);
      expect(summarise(good), contains('PASS'));

      expect(summarise(verdictFor([sample(0), sample(9)])), contains('FAIL'));
    });

    test('says so plainly when the battery could not be measured', () {
      final verdict = verdictFor([
        sample(0, battery: 80, charging: true),
        sample(30, battery: 95, charging: true),
      ]);
      expect(summarise(verdict), contains('charging'));
    });
  });

  group('the recorder’s own cost', () {
    test('never samples more often than the location service does', () {
      // The instrument must not be the thing it is measuring. The one
      // exception is the critical-battery cadence, which is deliberately
      // slower than the staleness bound — the heartbeat has to keep running
      // there, because that is exactly when a drain curve is most wanted.
      expect(
        heartbeatIsCheaperThanSampling(const Duration(seconds: 4)),
        isTrue,
      );
      expect(
        heartbeatIsCheaperThanSampling(const Duration(seconds: 25)),
        isTrue,
      );
      expect(
        heartbeatIsCheaperThanSampling(const Duration(seconds: 90)),
        isTrue,
      );
    });
  });
}
