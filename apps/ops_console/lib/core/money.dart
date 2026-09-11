/// Money, for display only.
///
/// The console never does arithmetic on money — every figure on every screen
/// was computed by the server, in integer cents, from a `pricing_rules` or a
/// `subscription_plans` row. So this is a formatter rather than a `Money`
/// type: giving the console its own arithmetic would invite a screen to add
/// two figures up and show a total the invoice disagrees with.
///
/// Cents in, never a `double`. A figure that reaches here as 12.34 has already
/// been through binary floating point and may already be wrong.
String formatCents(int cents) {
  final negative = cents < 0;
  final abs = cents.abs();
  final remainder = (abs % 100).toString().padLeft(2, '0');
  return '${negative ? '-' : ''}\$${abs ~/ 100}.$remainder';
}
