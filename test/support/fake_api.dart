import 'dart:convert';
import 'dart:io';

import 'package:carebridge_family/data/care_api.dart';
import 'package:carebridge_client/carebridge_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A [CareApi] backed by a canned server.
///
/// The snapshot it serves is a **real response**, captured from the seeded API
/// (see `test/fixtures/care_state_snapshot.json`). That matters more than a
/// hand-written fixture would: the client's decoder is now the most likely
/// place for a contract break to hide, and a fixture written from the client's
/// own assumptions could never catch one. Re-capture it with:
///
/// ```
/// curl -sS -X POST localhost:3000/api/v1/auth/login \
///   -H 'Content-Type: application/json' \
///   -d '{"email":"sarah@example.com","password":"demo-password"}' \
///   | jq .state > test/fixtures/care_state_snapshot.json
/// ```
class FakeApi {
  FakeApi({Map<String, dynamic>? snapshot})
    : _snapshot = snapshot ?? loadSnapshotFixture();

  final Map<String, dynamic> _snapshot;

  /// Every request the fake received, in order — so a test can assert that a
  /// button actually reached the server rather than only changing local state.
  final List<String> requests = [];

  /// The state a freshly registered account gets: genuinely empty.
  static Map<String, dynamic> emptySnapshot(Map<String, dynamic> template) => {
    'user': {
      'id': '00000000-0000-4000-8000-0000000000ff',
      'email': 'jordan@example.com',
      'fullName': 'Jordan Reyes',
      'phone': null,
      // A brand-new account has not confirmed its address yet, which is
      // exactly the state the verification banner exists for.
      'emailVerifiedAt': null,
      'timeZone': 'America/New_York',
    },
    'patients': <dynamic>[],
    'access': <String, dynamic>{},
    'clinics': template['clinics'],
    'appointments': <dynamic>[],
    'rides': <dynamic>[],
    'notifications': <dynamic>[],
    'selectedPatientId': null,
    'simplifiedMode': false,
  };

  CareApi build() {
    final client = MockClient((request) async {
      final path = request.url.path;
      requests.add('${request.method} $path');

      if (path.endsWith('/auth/login')) {
        return _json({
          'accessToken': 'test-access-token',
          'refreshToken': 'test-refresh-token',
          'expiresInSeconds': 900,
          'state': _snapshot,
        });
      }

      if (path.endsWith('/auth/register')) {
        return _json({
          'accessToken': 'test-access-token',
          'refreshToken': 'test-refresh-token',
          'expiresInSeconds': 900,
          'state': emptySnapshot(_snapshot),
        });
      }

      if (path.endsWith('/auth/logout')) return http.Response('', 204);

      // Reads and mutations alike answer with the whole snapshot, exactly as
      // the real API does.
      return _json(_snapshot);
    });

    return CareApi(
      tokens: InMemoryTokenStore(),
      // Absolute, because `Uri.base` under the test binding is a file:// path.
      baseUrl: 'http://localhost/api/v1',
      client: client,
    );
  }

  http.Response _json(Object body) => http.Response(
    jsonEncode(body),
    200,
    headers: {'content-type': 'application/json'},
  );
}

Map<String, dynamic> loadSnapshotFixture() {
  final file = File('test/fixtures/care_state_snapshot.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

/// Ids from the seeded fixture, so tests name records rather than positions.
abstract final class Seeded {
  static const eleanor = '00000000-0000-4000-8000-000000000010';
  static const frank = '00000000-0000-4000-8000-000000000011';
  static const followUpAppointment = '00000000-0000-4000-8000-000000000050';
  static const pastAppointment = '00000000-0000-4000-8000-000000000052';
  static const outboundRide = '00000000-0000-4000-8000-000000000060';
  static const returnRide = '00000000-0000-4000-8000-000000000061';
  static const pastRide = '00000000-0000-4000-8000-000000000062';
}
