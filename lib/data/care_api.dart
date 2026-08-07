import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/failures.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import 'care_codec.dart';
import 'care_state.dart';
import 'token_store.dart';

/// A snapshot plus the ids of any preview trips the server is running.
class CareSnapshot {
  const CareSnapshot({required this.state, required this.runningPreviews});

  final CareState state;
  final Set<String> runningPreviews;
}

/// The HTTP client for the CareBridge API.
///
/// Every mutating call returns a **whole** snapshot rather than a delta. One
/// status change can touch a ride, its appointment and the notification list at
/// once, and reassembling three partial responses on the client is how a UI
/// drifts out of step with the server that is supposed to be authoritative.
class CareApi {
  CareApi({required this.tokens, String? baseUrl, http.Client? client})
      : _baseUrl = _resolveBaseUrl(baseUrl ?? _configuredBaseUrl),
        _client = client ?? http.Client();

  final TokenStore tokens;
  final Uri _baseUrl;
  final http.Client _client;

  /// Relative by default, because the Docker stack serves the app and proxies
  /// `/api` to the API from the same origin — which means no CORS, and no API
  /// hostname compiled into the JavaScript bundle.
  ///
  /// Override for `flutter run` against a separate host:
  /// `--dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:3000/api/v1`
  static const _configuredBaseUrl = String.fromEnvironment(
    'CAREBRIDGE_API_BASE_URL',
    defaultValue: '/api/v1',
  );

  static Uri _resolveBaseUrl(String raw) {
    final trimmed = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    // A relative value is resolved against the page the app was served from,
    // which is exactly what makes the same-origin proxy work.
    return Uri.base.resolve(trimmed.isEmpty ? '/' : trimmed);
  }

  void dispose() => _client.close();

  // ─── session ──────────────────────────────────────────────────────────────

  Future<CareSnapshot> register({
    required String fullName,
    required String email,
    required String password,
    required bool acceptedTerms,
  }) =>
      _session('/auth/register', {
        'fullName': fullName.trim(),
        'email': email.trim(),
        'password': password,
        'acceptedTerms': acceptedTerms,
      });

  Future<CareSnapshot> signIn({
    required String email,
    required String password,
  }) =>
      _session('/auth/login', {'email': email.trim(), 'password': password});

  Future<CareSnapshot> _session(String path, Map<String, dynamic> body) async {
    final json = await _send('POST', path, body: body, authenticated: false);
    await tokens.write(
      AuthTokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      ),
    );
    return _snapshot(json['state'] as Map<String, dynamic>);
  }

  Future<void> signOut() async {
    final stored = await tokens.read();
    try {
      if (stored != null) {
        await _send(
          'POST',
          '/auth/logout',
          body: {'refreshToken': stored.refreshToken},
        );
      }
    } catch (_) {
      // Signing out locally must succeed even when the server cannot be
      // reached. The refresh token is discarded either way, and the access
      // token expires on its own within minutes.
    } finally {
      await tokens.clear();
    }
  }

  /// Restores a session from stored tokens, or returns null if there is none.
  Future<CareSnapshot?> restore() async {
    if (await tokens.read() == null) return null;
    try {
      return await state();
    } on AuthenticationFailure {
      await tokens.clear();
      return null;
    }
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  Future<CareSnapshot> state() async =>
      _snapshot(await _send('GET', '/care/state'));

  // ─── preferences ──────────────────────────────────────────────────────────

  Future<CareSnapshot> setSimplifiedMode(bool enabled) async => _snapshot(
        await _send('PATCH', '/me/preferences', body: {
          'simplifiedMode': enabled,
        }),
      );

  Future<CareSnapshot> selectPatient(String patientId) async =>
      _snapshot(await _send('POST', '/patients/$patientId/select'));

  // ─── patients ─────────────────────────────────────────────────────────────

  Future<CareSnapshot> createPatient(Patient patient) async =>
      _snapshot(await _send('POST', '/patients', body: patientToJson(patient)));

  Future<CareSnapshot> updatePatient(Patient patient) async => _snapshot(
        await _send('PUT', '/patients/${patient.id}',
            body: patientToJson(patient)),
      );

  Future<CareSnapshot> archivePatient(String patientId) async =>
      _snapshot(await _send('POST', '/patients/$patientId/archive'));

  Future<CareSnapshot> setPermissions(
    String patientId,
    Set<FamilyPermission> permissions,
  ) async =>
      _snapshot(
        await _send('PUT', '/patients/$patientId/permissions', body: {
          'permissions': permissions.map((p) => p.name).toList(),
        }),
      );

  // ─── clinics ──────────────────────────────────────────────────────────────

  Future<CareSnapshot> addClinic(Clinic clinic) async =>
      _snapshot(await _send('POST', '/clinics', body: clinicToJson(clinic)));

  // ─── appointments ─────────────────────────────────────────────────────────

  Future<CareSnapshot> createAppointment({
    required String patientId,
    required String clinicId,
    required DateTime startsAt,
    required Duration expectedDuration,
    required AppointmentType type,
    String? coordinationNotes,
    bool transportRequired = false,
  }) async =>
      _snapshot(
        await _send('POST', '/appointments', body: {
          'patientId': patientId,
          'clinicId': clinicId,
          'startsAt': startsAt.toUtc().toIso8601String(),
          'expectedDurationMinutes': expectedDuration.inMinutes,
          'type': type.name,
          if (coordinationNotes != null && coordinationNotes.isNotEmpty)
            'coordinationNotes': coordinationNotes,
          'transportRequired': transportRequired,
        }),
      );

  Future<CareSnapshot> rescheduleAppointment(
    String appointmentId,
    DateTime startsAt,
  ) async =>
      _snapshot(
        await _send('POST', '/appointments/$appointmentId/reschedule', body: {
          'startsAt': startsAt.toUtc().toIso8601String(),
        }),
      );

  Future<CareSnapshot> cancelAppointment(
    String appointmentId, {
    String? reason,
  }) async =>
      _snapshot(
        await _send('POST', '/appointments/$appointmentId/cancel', body: {
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        }),
      );

  // ─── transportation ───────────────────────────────────────────────────────

  Future<CareSnapshot> requestTransport({
    required String appointmentId,
    required DateTime pickupAt,
    required bool roundTrip,
    String? notesForDriver,
  }) async =>
      _snapshot(
        await _send('POST', '/rides', body: {
          'appointmentId': appointmentId,
          'pickupAt': pickupAt.toUtc().toIso8601String(),
          'roundTrip': roundTrip,
          if (notesForDriver != null && notesForDriver.isNotEmpty)
            'notesForDriver': notesForDriver,
        }),
      );

  Future<CareSnapshot> cancelRide(String rideId, String reason) async =>
      _snapshot(
        await _send('POST', '/rides/$rideId/cancel', body: {'reason': reason}),
      );

  Future<CareSnapshot> setDelay(
    String rideId, {
    required bool delayed,
    String? reason,
  }) async =>
      _snapshot(
        await _send('POST', '/rides/$rideId/delay', body: {
          'delayed': delayed,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        }),
      );

  /// Starts the server-side preview trip — the stand-in for the driver app.
  Future<CareSnapshot> startPreviewTrip(String rideId) async =>
      _snapshot(await _send('POST', '/rides/$rideId/preview/start'));

  Future<CareSnapshot> stopPreviewTrip(String rideId) async =>
      _snapshot(await _send('POST', '/rides/$rideId/preview/stop'));

  // ─── notifications ────────────────────────────────────────────────────────

  Future<CareSnapshot> markNotificationRead(String id) async =>
      _snapshot(await _send('POST', '/notifications/$id/read'));

  Future<CareSnapshot> markAllNotificationsRead() async =>
      _snapshot(await _send('POST', '/notifications/read-all'));

  // ─── transport plumbing ───────────────────────────────────────────────────

  CareSnapshot _snapshot(Map<String, dynamic> json) => CareSnapshot(
        state: careStateFromJson(json),
        runningPreviews: runningPreviewRideIds(json),
      );

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
    bool allowRetry = true,
  }) async {
    final response = await _request(method, path, body, authenticated);

    // One refresh attempt, then give up. Looping on 401 would turn an expired
    // session into an infinite request storm against the auth endpoint.
    if (response.statusCode == 401 && authenticated && allowRetry) {
      if (await _refresh()) {
        return _send(method, path,
            body: body, authenticated: authenticated, allowRetry: false);
      }
      await tokens.clear();
      throw const AuthenticationFailure();
    }

    return _decode(response);
  }

  Future<http.Response> _request(
    String method,
    String path,
    Map<String, dynamic>? body,
    bool authenticated,
  ) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
    };

    if (authenticated) {
      final stored = await tokens.read();
      if (stored == null) throw const AuthenticationFailure();
      headers['Authorization'] = 'Bearer ${stored.accessToken}';
    }

    final encoded = body == null ? null : jsonEncode(body);

    try {
      return switch (method) {
        'GET' => await _client.get(uri, headers: headers),
        'POST' => await _client.post(uri, headers: headers, body: encoded),
        'PUT' => await _client.put(uri, headers: headers, body: encoded),
        'PATCH' => await _client.patch(uri, headers: headers, body: encoded),
        _ => throw ArgumentError('Unsupported method $method'),
      };
    } on http.ClientException {
      // The message a family member sees never carries a URL, a host or a
      // stack frame — see [Failure].
      throw const NetworkFailure();
    } on FormatException {
      throw const NetworkFailure();
    }
  }

  Future<bool> _refresh() async {
    final stored = await tokens.read();
    if (stored == null) return false;

    try {
      final json = await _send(
        'POST',
        '/auth/refresh',
        body: {'refreshToken': stored.refreshToken},
        authenticated: false,
        allowRetry: false,
      );
      await tokens.write(
        AuthTokens(
          accessToken: json['accessToken'] as String,
          refreshToken: json['refreshToken'] as String,
        ),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    final body = response.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) return body;

    throw _failureFrom(response.statusCode, body);
  }

  /// Maps the server's error envelope onto the same [Failure] types the app
  /// already renders, so a screen's `catch` does not care where the rule was
  /// enforced. Note that 404 stays deliberately ambiguous: the server refuses
  /// to say whether a record is missing or merely not ours, and the client must
  /// not invent a distinction it was not given.
  Failure _failureFrom(int status, Map<String, dynamic> body) {
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
      'invalid_transition' => const InvalidTransitionFailure('unknown', 'unknown'),
      'conflict' => ValidationFailure(message ?? 'That conflicts with something else.'),
      _ => switch (status) {
          400 => ValidationFailure(message ?? 'That request could not be processed.'),
          401 => const AuthenticationFailure(),
          403 || 404 => const NotFoundFailure(),
          _ => NetworkFailure(
              message ?? 'Something went wrong on our side. Please try again.',
            ),
        },
    };
  }
}
