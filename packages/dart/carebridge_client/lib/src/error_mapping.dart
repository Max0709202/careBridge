import 'failures.dart';

/// The server's error envelope, mapped onto the [Failure] types both apps
/// render.
///
/// Shared rather than written once per app, and the reason is the `404` branch
/// rather than convenience. The API answers "no such record" and "not yours"
/// with the *same* status and the *same* message, deliberately, so that an
/// error cannot be used to probe for the existence of a patient, a ride or an
/// organisation. A client that re-derived a distinction — "not found" here,
/// "forbidden" there — would hand back exactly the signal the server spent
/// effort withholding, and it would do it in whichever of the two apps
/// happened to be written second.
///
/// So there is one implementation, and it is this one.
Failure failureFromResponse({
  required int status,
  required Map<String, dynamic> body,
  required Map<String, String> headers,
}) {
  final error = body['error'] as Map<String, dynamic>?;
  final message = error?['message'] as String?;
  final code = error?['code'] as String?;
  final field = error?['field'] as String?;

  return switch (code) {
    'validation' => ValidationFailure(
      message ?? 'That request could not be processed.',
      field: field,
    ),
    'authentication' => AuthenticationFailure(
      message ?? 'Please sign in again.',
    ),
    'not_found_or_forbidden' => const NotFoundFailure(),
    'invalid_transition' => const InvalidTransitionFailure(
      'unknown',
      'unknown',
    ),
    'conflict' => ValidationFailure(
      message ?? 'That conflicts with something else.',
    ),
    'rate_limited' => RateLimitedFailure(
      retryAfter: retryAfterFrom(headers),
      message: message ?? 'Too many attempts. Please wait and try again.',
    ),
    // No recognised code. Fall back to the status, which is what an older
    // client meeting a newer server sees.
    _ => switch (status) {
      400 => ValidationFailure(
        message ?? 'That request could not be processed.',
      ),
      401 => const AuthenticationFailure(),
      403 || 404 => const NotFoundFailure(),
      429 => RateLimitedFailure(retryAfter: retryAfterFrom(headers)),
      _ => NetworkFailure(
        message ?? 'Something went wrong on our side. Please try again.',
      ),
    },
  };
}

/// `Retry-After`, in seconds.
///
/// Absent or unparseable means "we were not told", which a screen renders as a
/// generic wait rather than inventing a number and counting down to a retry
/// that is refused again.
Duration? retryAfterFrom(Map<String, String> headers) {
  final seconds = int.tryParse(headers['retry-after'] ?? '');
  return seconds == null || seconds <= 0 ? null : Duration(seconds: seconds);
}
