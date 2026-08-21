import '../domain/models.dart';

/// Fixes waiting to be sent.
///
/// The case this exists for is a road with no signal: a tunnel, a lift shaft
/// under a hospital, a stretch of county road. The device keeps sampling, the
/// queue holds what it cannot send, and the whole backlog goes up in one
/// request when signal returns. Without it a dead zone is a hole in the
/// journey record, which is the record a dispute would be settled from.
///
/// Three decisions are worth stating.
///
/// **It is bounded, and it drops the oldest.** A queue that grows without
/// limit is a memory leak with a plausible excuse. Dropping the oldest rather
/// than refusing the newest is the right way round twice over: the newest fix
/// is the one that will move the family's map, and the oldest is the one the
/// server is most likely to refuse as backlog anyway.
///
/// **A failed flush puts the batch back at the front.** Anything else loses a
/// stretch of the journey to a single dropped connection — which is the exact
/// condition the queue exists to survive.
///
/// **It does not survive the app being killed.** Deliberate, and the reason it
/// is acceptable: the ride row on the server still carries the last position
/// it received, so a restart re-reads rather than reconstructs. Persisting the
/// queue would mean writing a stream of somebody's locations to disk on a
/// device that is more likely than any other in this system to be lost or left
/// in a vehicle.
class LocationQueue {
  LocationQueue({this.capacity = 720, this.maxAge = const Duration(hours: 6)});

  /// Two hours at the fastest cadence, or six at the slowest — comfortably
  /// past any dead zone a trip survives, and small enough that a queue full of
  /// fixes is a few hundred kilobytes rather than a problem.
  final int capacity;

  /// Matches the server's backlog bound. A fix older than this will be refused
  /// on arrival, so carrying it is pure cost.
  final Duration maxAge;

  final List<Fix> _fixes = [];

  int get length => _fixes.length;
  bool get isEmpty => _fixes.isEmpty;
  bool get isNotEmpty => _fixes.isNotEmpty;

  /// How many fixes have been dropped because the queue was full.
  ///
  /// Surfaced rather than swallowed: silent truncation reads as "everything
  /// was sent" to whoever looks at the journey record later.
  int get dropped => _dropped;
  int _dropped = 0;

  void add(Fix fix) {
    _fixes.add(fix);
    while (_fixes.length > capacity) {
      _fixes.removeAt(0);
      _dropped++;
    }
  }

  /// The next batch to send, oldest first, without removing it.
  ///
  /// Peeked rather than popped because the send can fail, and a queue that
  /// hands out fixes before they are safely stored is a queue that loses them
  /// to a dropped connection. [commit] removes them once the server has them.
  List<Fix> peek({required int max, required DateTime now}) {
    _pruneStale(now);
    return _fixes.take(max).toList(growable: false);
  }

  /// Drops the batch that was successfully sent.
  ///
  /// Matched by identity against the head of the queue rather than by count:
  /// a fix added while the request was in flight must not be discarded because
  /// it happened to arrive during the round trip.
  void commit(List<Fix> sent) {
    for (final fix in sent) {
      final index = _fixes.indexOf(fix);
      if (index != -1) _fixes.removeAt(index);
    }
  }

  /// Forgets everything.
  ///
  /// Called when a ride ends, and the reason is the same rule the server
  /// enforces on arrival: once a ride is over, its positions are no longer
  /// collectable. Flushing them afterwards would be sending readings that
  /// should never be stored.
  void clear() => _fixes.clear();

  void _pruneStale(DateTime now) {
    _fixes.removeWhere((fix) => now.difference(fix.capturedAt) > maxAge);
  }
}
