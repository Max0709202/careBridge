/// Money held as integer minor units (cents).
///
/// Never use `double` for money: 0.1 + 0.2 != 0.3 in binary floating point, and
/// a fare assembled from a base, a per-mile rate and a surcharge accumulates
/// exactly that kind of error. Every arithmetic operation here stays in cents
/// and rounds explicitly at the one point where rounding is unavoidable.
class Money implements Comparable<Money> {
  const Money(this.cents);

  const Money.zero() : cents = 0;

  factory Money.fromDollars(double dollars) => Money((dollars * 100).round());

  final int cents;

  Money operator +(Money other) => Money(cents + other.cents);

  Money operator -(Money other) => Money(cents - other.cents);

  /// Multiply by a rate (e.g. miles, minutes). Rounds half away from zero at
  /// the moment of conversion, which is the only place precision is lost.
  Money operator *(num factor) => Money((cents * factor).round());

  bool operator <(Money other) => cents < other.cents;

  bool operator >(Money other) => cents > other.cents;

  static Money max(Money a, Money b) => a.cents >= b.cents ? a : b;

  String format() {
    final negative = cents < 0;
    final abs = cents.abs();
    final dollars = abs ~/ 100;
    final remainder = (abs % 100).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}\$$dollars.$remainder';
  }

  @override
  int compareTo(Money other) => cents.compareTo(other.cents);

  @override
  bool operator ==(Object other) => other is Money && other.cents == cents;

  @override
  int get hashCode => cents.hashCode;

  @override
  String toString() => format();
}
