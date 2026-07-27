/// Injectable clock.
///
/// Time-dependent behaviour — reminder windows, "arriving soon", location
/// staleness — is untestable against `DateTime.now()`. Every caller takes a
/// [Clock]; tests supply a fixed or advancing one.
abstract class Clock {
  DateTime now();
}

class SystemClock implements Clock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now();
}

class FixedClock implements Clock {
  FixedClock(this._now);

  DateTime _now;

  void advance(Duration by) => _now = _now.add(by);

  void set(DateTime to) => _now = to;

  @override
  DateTime now() => _now;
}
