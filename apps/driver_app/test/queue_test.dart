import 'package:carebridge_driver/data/location_queue.dart';
import 'package:carebridge_driver/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fixes waiting for signal.
///
/// The case the whole class exists for is a tunnel, and the two failure modes
/// worth testing are the ones that look identical from the outside: a queue
/// that grows without limit, and a queue that loses a batch to the dropped
/// connection it was built to survive.

final now = DateTime.utc(2026, 6, 15, 14, 30);

Fix fix({int secondsAgo = 0, double latitude = 40.65}) => Fix(
  latitude: latitude,
  longitude: -73.95,
  capturedAt: now.subtract(Duration(seconds: secondsAgo)),
);

void main() {
  group('holding on to fixes', () {
    test('keeps them in the order they were taken', () {
      final queue = LocationQueue();
      queue
        ..add(fix(secondsAgo: 30, latitude: 1))
        ..add(fix(secondsAgo: 20, latitude: 2))
        ..add(fix(secondsAgo: 10, latitude: 3));

      final batch = queue.peek(max: 10, now: now);
      expect(batch.map((f) => f.latitude), [1, 2, 3]);
    });

    test('hands out at most one batch’s worth', () {
      // Matching the server's own cap means a long backlog drains in several
      // requests rather than being refused whole.
      final queue = LocationQueue();
      for (var i = 0; i < 500; i++) {
        queue.add(fix(secondsAgo: 500 - i));
      }

      expect(queue.peek(max: 240, now: now), hasLength(240));
    });
  });

  group('when the queue fills', () {
    test('drops the oldest rather than refusing the newest', () {
      // Right way round twice over: the newest fix is the one that will move
      // the family's map, and the oldest is the one the server is most likely
      // to refuse as backlog anyway.
      final queue = LocationQueue(capacity: 3);
      queue
        ..add(fix(latitude: 1))
        ..add(fix(latitude: 2))
        ..add(fix(latitude: 3))
        ..add(fix(latitude: 4));

      expect(queue.length, 3);
      expect(queue.peek(max: 10, now: now).map((f) => f.latitude), [2, 3, 4]);
    });

    test('says how many it dropped', () {
      // Surfaced rather than swallowed: silent truncation reads as "everything
      // was sent" to whoever looks at the journey record later.
      final queue = LocationQueue(capacity: 2);
      queue
        ..add(fix(latitude: 1))
        ..add(fix(latitude: 2))
        ..add(fix(latitude: 3));

      expect(queue.dropped, 1);
    });
  });

  group('flushing', () {
    test('does not lose a batch the server never received', () {
      // The exact condition the queue exists to survive. Handing fixes out
      // before they are safely stored would lose a stretch of the journey to
      // one dropped connection.
      final queue = LocationQueue();
      queue
        ..add(fix(latitude: 1))
        ..add(fix(latitude: 2));

      final batch = queue.peek(max: 10, now: now);
      // The send fails; nothing is committed.
      expect(queue.length, 2);
      expect(batch, hasLength(2));
    });

    test('drops only what was actually sent', () {
      // A fix taken while the request was in flight must survive the commit.
      // Matching by identity rather than by count is what makes that true.
      final queue = LocationQueue();
      queue
        ..add(fix(latitude: 1))
        ..add(fix(latitude: 2));

      final batch = queue.peek(max: 10, now: now);
      queue.add(fix(latitude: 3));
      queue.commit(batch);

      expect(queue.peek(max: 10, now: now).map((f) => f.latitude), [3]);
    });

    test('is safe to commit twice', () {
      final queue = LocationQueue();
      queue.add(fix(latitude: 1));

      final batch = queue.peek(max: 10, now: now);
      queue
        ..commit(batch)
        ..commit(batch);

      expect(queue.isEmpty, isTrue);
    });
  });

  group('fixes that are past saving', () {
    test('forgets anything the server would refuse as backlog', () {
      // Carrying a fix the server will reject on arrival is pure cost — on a
      // connection that has just come back after hours of nothing.
      final queue = LocationQueue(maxAge: const Duration(hours: 6));
      queue
        ..add(fix(secondsAgo: 7 * 60 * 60))
        ..add(fix(secondsAgo: 30, latitude: 9));

      final batch = queue.peek(max: 10, now: now);
      expect(batch.map((f) => f.latitude), [9]);
    });
  });

  group('when the ride ends', () {
    test('throws the queue away rather than flushing it', () {
      // Once a ride is over its positions are no longer collectable, and a
      // farewell flush would be sending exactly the readings that rule exists
      // to stop.
      final queue = LocationQueue();
      queue
        ..add(fix(latitude: 1))
        ..add(fix(latitude: 2))
        ..clear();

      expect(queue.isEmpty, isTrue);
    });
  });
}
