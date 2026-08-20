import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter_test/flutter_test.dart';

/// The mapping both apps share.
///
/// The test that matters is the last group. The API answers "no such record"
/// and "you may not see it" identically, on purpose, so that an error cannot
/// be used to probe for the existence of a patient, a ride or an organisation.
/// A client that re-derived the distinction would hand back exactly the signal
/// the server spent effort withholding — and before this mapping was shared,
/// there were two places that could do it.

Failure map(
  int status, {
  Map<String, dynamic> body = const {},
  Map<String, String> headers = const {},
}) => failureFromResponse(status: status, body: body, headers: headers);

Map<String, dynamic> envelope(String code, {String? message, String? field}) =>
    {
      'error': {'code': code, 'message': ?message, 'field': ?field},
    };

void main() {
  group('the error envelope', () {
    test('maps a validation error, keeping the field it names', () {
      final failure = map(
        400,
        body: envelope(
          'validation',
          message: 'Seat count is wrong.',
          field: 'seats',
        ),
      );

      expect(failure, isA<ValidationFailure>());
      expect((failure as ValidationFailure).field, 'seats');
      expect(failure.message, 'Seat count is wrong.');
    });

    test('maps authentication, conflict and rate limiting', () {
      expect(
        map(401, body: envelope('authentication')),
        isA<AuthenticationFailure>(),
      );
      expect(map(409, body: envelope('conflict')), isA<ValidationFailure>());
      expect(
        map(429, body: envelope('rate_limited')),
        isA<RateLimitedFailure>(),
      );
    });

    test('maps an invalid transition to something a screen can render', () {
      final failure = map(409, body: envelope('invalid_transition'));
      expect(failure, isA<InvalidTransitionFailure>());
      expect(failure.message, 'That change is not available right now.');
    });
  });

  group('Retry-After', () {
    test('is carried when the server sends one', () {
      final failure = map(
        429,
        body: envelope('rate_limited'),
        headers: {'retry-after': '90'},
      );
      expect(
        (failure as RateLimitedFailure).retryAfter,
        const Duration(seconds: 90),
      );
    });

    test('is null when absent, zero or unparseable', () {
      // "We were not told" renders as a generic wait rather than a countdown
      // to a retry that is refused again.
      for (final headers in [
        <String, String>{},
        {'retry-after': '0'},
        {'retry-after': 'soon'},
        {'retry-after': '-5'},
      ]) {
        final failure = map(
          429,
          body: envelope('rate_limited'),
          headers: headers,
        );
        expect((failure as RateLimitedFailure).retryAfter, isNull);
      }
    });
  });

  group('an unrecognised code falls back to the status', () {
    test(
      'so an older client meeting a newer server still renders something',
      () {
        expect(
          map(400, body: envelope('some_new_code')),
          isA<ValidationFailure>(),
        );
        expect(map(401), isA<AuthenticationFailure>());
        expect(map(500), isA<NetworkFailure>());
        expect(map(503), isA<NetworkFailure>());
      },
    );
  });

  group('"not found" and "not permitted" stay indistinguishable', () {
    test('both codes and both statuses produce one identical failure', () {
      final byCode = map(404, body: envelope('not_found_or_forbidden'));
      final byNotFound = map(404);
      final byForbidden = map(403);

      expect(byCode, isA<NotFoundFailure>());
      expect(byNotFound, isA<NotFoundFailure>());
      expect(byForbidden, isA<NotFoundFailure>());

      // Same type *and* same message. A different sentence would be enough to
      // tell the two apart, which is the whole thing being prevented.
      expect(byNotFound.message, byForbidden.message);
      expect(byCode.message, byForbidden.message);
    });

    test('the server\'s own message cannot widen the distinction either', () {
      // Even if a future handler returned a chattier message under this code,
      // the client renders the shared one — the ambiguity is not the server's
      // to give away by accident.
      final chatty = map(
        404,
        body: envelope(
          'not_found_or_forbidden',
          message: 'Patient 41c9 belongs to another family.',
        ),
      );

      expect(chatty.message, isNot(contains('41c9')));
      expect(chatty.message, map(403).message);
    });
  });

  group('tokens', () {
    test('an in-memory store round-trips and clears', () async {
      final store = InMemoryTokenStore();
      expect(await store.read(), isNull);

      await store.write(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      expect((await store.read())?.accessToken, 'a');

      await store.clear();
      expect(await store.read(), isNull);
    });

    test('copyWith replaces only what it is given', () {
      const tokens = AuthTokens(accessToken: 'a', refreshToken: 'r');
      expect(tokens.copyWith(accessToken: 'b').refreshToken, 'r');
      expect(tokens.copyWith(refreshToken: 's').accessToken, 'a');
    });
  });

  group('identifiers', () {
    test('are unguessable rather than sequential', () {
      // An id that appears in a URL or a deep link must not let anyone guess
      // the neighbouring record.
      final ids = {for (var i = 0; i < 500; i++) newId()};
      expect(ids, hasLength(500));
      expect(newId(), matches(RegExp(r'^[0-9a-f-]{36}$')));
    });
  });
}
