/// Failure types shared across layers.
///
/// User-facing messages are deliberately generic. `AuthorizationFailure` and
/// `NotFoundFailure` carry the *same* message so a caller cannot distinguish
/// "this record does not exist" from "you may not see it" — otherwise the error
/// itself becomes a way to probe for the existence of a patient record.
library;

sealed class Failure implements Exception {
  const Failure(this.message);

  /// Safe to show to a user. Never contains names, addresses, or identifiers.
  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

class ValidationFailure extends Failure {
  const ValidationFailure(super.message, {this.field});

  final String? field;
}

class AuthenticationFailure extends Failure {
  const AuthenticationFailure([super.message = 'Please sign in again.']);
}

class AuthorizationFailure extends Failure {
  const AuthorizationFailure() : super(_shared);
}

class NotFoundFailure extends Failure {
  const NotFoundFailure() : super(_shared);
}

/// Raised when code attempts a status change the state machine forbids.
/// This is a programming error, not a user error — it means a control was
/// offered that should not have been.
class InvalidTransitionFailure extends Failure {
  const InvalidTransitionFailure(this.from, this.to)
    : super('That change is not available right now.');

  final String from;
  final String to;

  @override
  String toString() => 'InvalidTransitionFailure: $from -> $to';
}

/// Too many attempts. The server says how long to wait; it never says which
/// limit was hit, because "too many attempts for that email address" would
/// confirm the address has an account.
class RateLimitedFailure extends Failure {
  const RateLimitedFailure({
    this.retryAfter,
    String message = 'Too many attempts. Please wait and try again.',
  }) : super(message);

  final Duration? retryAfter;
}

class NetworkFailure extends Failure {
  const NetworkFailure([
    super.message = 'We could not reach CareBridge. Check your connection.',
  ]);
}

const _shared = 'We could not find that, or you do not have access to it.';
