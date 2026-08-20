import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_family/data/tracking_socket.dart';
import 'package:carebridge_family/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// The client side of live tracking.
///
/// Positions now arrive by two routes — pushed over the socket, and carried on
/// the polled snapshot — and either can arrive second. What is tested here is
/// the rule that decides which of the two the screen believes, because getting
/// it wrong shows an old reading as the current one, which is the single thing
/// this screen exists not to do.

TrackingPoint point(DateTime capturedAt, {double latitude = 40.0}) =>
    TrackingPoint(
      coordinates: Coordinates(latitude, -73.9),
      capturedAt: capturedAt,
    );

void main() {
  group('choosing between two readings', () {
    final earlier = DateTime.utc(2026, 6, 15, 12, 0, 0);
    final later = DateTime.utc(2026, 6, 15, 12, 0, 10);

    test('takes whichever one exists when only one does', () {
      expect(TrackingPoint.newerOf(null, null), isNull);
      expect(TrackingPoint.newerOf(point(earlier), null)?.capturedAt, earlier);
      expect(TrackingPoint.newerOf(null, point(later))?.capturedAt, later);
    });

    test('prefers the reading the device took most recently', () {
      expect(
        TrackingPoint.newerOf(point(earlier), point(later))?.capturedAt,
        later,
      );
    });

    // The case that matters: a pushed position can overtake a polled one on
    // the network and arrive second while being the older reading. Ordering by
    // arrival would render it as current.
    test('ignores which one arrived first', () {
      expect(
        TrackingPoint.newerOf(point(later), point(earlier))?.capturedAt,
        later,
      );
    });

    test('keeps the first when both were captured at the same instant', () {
      final a = point(earlier, latitude: 1);
      final b = point(earlier, latitude: 2);
      // Neither is newer, so there is nothing to gain by swapping — and a
      // marker that jitters between two identical-age readings looks like
      // movement that is not happening.
      expect(TrackingPoint.newerOf(a, b)?.coordinates.latitude, 1);
    });
  });

  group('a tracking update', () {
    test('carries a position and its ETA', () {
      final update = TrackingUpdate.position(
        point(DateTime.utc(2026)),
        etaMinutes: 7,
      );
      expect(update.point, isNotNull);
      expect(update.etaMinutes, 7);
      expect(update.closure, isNull);
    });

    test('distinguishes a ride ending from access being withdrawn', () {
      // Both close the stream and only one is worth showing as an ending. A
      // withdrawn subscription falls back to the polled snapshot, which will
      // itself stop returning the ride if access really is gone.
      expect(
        const TrackingUpdate.closed(TrackingClosure.ended).closure,
        TrackingClosure.ended,
      );
      expect(
        const TrackingUpdate.closed(TrackingClosure.unauthorized).closure,
        TrackingClosure.unauthorized,
      );
    });

    test('reports silence, including the case of never having reported', () {
      expect(const TrackingUpdate.stale(90_000).silentForMs, 90_000);
      // Null is the more worrying one: a driver marked en route whose app has
      // not sent a single position.
      expect(const TrackingUpdate.stale(null).silentForMs, isNull);
    });
  });

  group('the socket', () {
    test(
      'gives a broadcast stream, so rebuilds do not fight over it',
      () async {
        // The screen watches through a StreamProvider and rebuilds freely. A
        // single-subscription stream would throw the second time anything
        // listened, which on this screen means the first time the ride status
        // changes underneath it.
        final socket = TrackingSocket(tokens: InMemoryTokenStore());
        addTearDown(socket.dispose);

        final stream = socket.watch('ride-1');
        expect(stream.isBroadcast, isTrue);

        final first = stream.listen((_) {});
        final second = stream.listen((_) {});
        addTearDown(() async {
          await first.cancel();
          await second.cancel();
        });
      },
    );

    test('opens no connection when there is no session', () async {
      // Signed out, there is nothing to authenticate a handshake with. The
      // stream still exists and simply stays quiet, so the screen falls back
      // to the polled snapshot rather than showing an error for a state that
      // is not one.
      final socket = TrackingSocket(tokens: InMemoryTokenStore());
      addTearDown(socket.dispose);

      final events = <TrackingUpdate>[];
      socket.watch('ride-1').listen(events.add);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(events, isEmpty);
    });
  });
}
