import 'dart:convert';

// Prefixed, as in the family app: the generated package carries the **wire**
// types and several share a name with this console's own domain enums —
// `DriverStatus`, `DispatchUrgency`. The prefix keeps the domain model
// primary, which is the right way round. The UI is written against the domain;
// the wire shape is an implementation detail of this file.
import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:http/http.dart' as http;

import '../domain/dispatch.dart';
import '../domain/models.dart';
import 'ops_codec.dart';

/// The console's HTTP client.
///
/// One client, because it owns refresh. Two of them each retrying a 401 will
/// eventually both present the same rotated refresh token, and the server's
/// reuse detection will — correctly — revoke the whole session family. On the
/// family app that signs somebody out of their phone; here it signs a
/// dispatcher out mid-shift with a queue on screen, which is worse.
///
/// Everything below is scoped by an organisation id in the path. That scoping
/// **is** the authorisation: no endpoint takes a driver or ride id as a
/// capability, `requireMembership` runs first on the server, and an id
/// belonging to another company answers 404 — indistinguishable from one that
/// does not exist. This client must not invent a distinction it was not given.
class OpsApi {
  OpsApi({required this.tokens, String? baseUrl, http.Client? client})
    : _baseUrl = _resolveBaseUrl(baseUrl ?? _configuredBaseUrl),
      _client = client ?? http.Client();

  final TokenStore tokens;
  final Uri _baseUrl;
  final http.Client _client;

  /// Relative by default: nginx serves the console and proxies `/api` to the
  /// API from the same origin, so there is no CORS and no API hostname
  /// compiled into the JavaScript bundle.
  ///
  /// Override for `flutter run` against a separate host:
  /// `--dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:3000/api/v1`
  static const _configuredBaseUrl = String.fromEnvironment(
    'CAREBRIDGE_API_BASE_URL',
    defaultValue: '/api/v1',
  );

  static Uri _resolveBaseUrl(String raw) {
    final trimmed = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    return Uri.base.resolve(trimmed.isEmpty ? '/' : trimmed);
  }

  void dispose() => _client.close();

  // ─── session ──────────────────────────────────────────────────────────────

  Future<void> signIn({required String email, required String password}) async {
    final json = await _send(
      'POST',
      '/auth/login',
      body: {'email': email.trim(), 'password': password},
      authenticated: false,
    );
    await _storeSession(json);
  }

  Future<void> signOut() async {
    // Cleared first, and unconditionally. A logout that fails on the network
    // must still end the session on this machine — a dispatcher walking away
    // from a shared terminal cannot be left signed in because a request
    // timed out.
    await tokens.clear();
    try {
      await _send('POST', '/auth/logout-all');
    } catch (_) {
      // Already signed out locally, which is the part that matters here.
    }
  }

  Future<void> _storeSession(Map<String, dynamic> json) async {
    await tokens.write(
      AuthTokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      ),
    );
  }

  // ─── organisations ────────────────────────────────────────────────────────

  /// Organisations the signed-in user holds a role in.
  ///
  /// The console has no notion of "the" organisation: somebody can dispatch
  /// for two operators, and picking one is a decision rather than a default.
  Future<List<Organization>> organizations() async =>
      (await _sendList('GET', '/organizations'))
          .map((e) => wire.OrganizationDto.fromJson(e as Map<String, dynamic>))
          .map(organizationFromWire)
          .nonNulls
          .toList();

  // ─── the queue ────────────────────────────────────────────────────────────

  Future<DispatchQueue> queue(String organizationId) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await _send('GET', '/organizations/$organizationId/dispatch/queue'),
    ),
  );

  /// Gives a ride to a driver, or moves it to another one.
  ///
  /// [reason] is required by the server when taking a ride off a driver who
  /// already had it, and the reassignment passes through
  /// `reassignmentRequired` so the family's timeline records that the first
  /// driver dropped it rather than showing a silent swap.
  Future<DispatchQueue> assign({
    required String organizationId,
    required String rideId,
    required String driverId,
    String? reason,
  }) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await _send(
        'POST',
        '/organizations/$organizationId/dispatch/rides/$rideId/assign',
        // A dispatcher double-tapping on a slow connection must not produce
        // two assignments, and at the HTTP level a retry is indistinguishable
        // from a second decision.
        idempotencyKey: newId(),
        body: {
          'driverId': driverId,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  // ─── roster and fleet ─────────────────────────────────────────────────────

  Future<List<Driver>> drivers(String organizationId) async =>
      (await _sendList('GET', '/organizations/$organizationId/drivers'))
          .map((e) => wire.DriverDto.fromJson(e as Map<String, dynamic>))
          .map(driverFromWire)
          .nonNulls
          .toList();

  Future<Driver?> setDriverStatus({
    required String organizationId,
    required String driverId,
    required DriverStatus to,
    String? reason,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await _send(
        'POST',
        '/organizations/$organizationId/drivers/$driverId/status',
        body: {
          'to': to.wire,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  Future<Driver?> setShift({
    required String organizationId,
    required String driverId,
    required bool onShift,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await _send(
        'PUT',
        '/organizations/$organizationId/drivers/$driverId/shift',
        body: {'onShift': onShift},
      ),
    ),
  );

  Future<Driver?> addDriver({
    required String organizationId,
    required String displayName,
    required String vehicleId,
    int? yearsDriving,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await _send(
        'POST',
        '/organizations/$organizationId/drivers',
        idempotencyKey: newId(),
        body: {
          'displayName': displayName.trim(),
          'vehicleId': vehicleId,
          'yearsDriving': ?yearsDriving,
        },
      ),
    ),
  );

  Future<List<Vehicle>> vehicles(String organizationId) async =>
      (await _sendList('GET', '/organizations/$organizationId/vehicles'))
          .map((e) => wire.VehicleDto.fromJson(e as Map<String, dynamic>))
          .map(vehicleFromWire)
          .toList();

  Future<Vehicle> addVehicle({
    required String organizationId,
    required String make,
    required String model,
    required String color,
    required String licensePlate,
    required bool isWheelchairAccessible,
  }) async => vehicleFromWire(
    wire.VehicleDto.fromJson(
      await _send(
        'POST',
        '/organizations/$organizationId/vehicles',
        idempotencyKey: newId(),
        body: {
          'make': make.trim(),
          'model': model.trim(),
          'color': color.trim(),
          'licensePlate': licensePlate.trim(),
          'isWheelchairAccessible': isWheelchairAccessible,
        },
      ),
    ),
  );

  // ─── seats ────────────────────────────────────────────────────────────────

  Future<SeatSummary> seats(String organizationId) async => seatsFromWire(
    wire.OrganizationSeatsDto.fromJson(
      await _send('GET', '/organizations/$organizationId/seats'),
    ),
  );

  // ─── transport plumbing ───────────────────────────────────────────────────

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
    bool allowRetry = true,
    String? idempotencyKey,
  }) async {
    final response = await _request(
      method,
      path,
      body,
      authenticated,
      idempotencyKey,
    );

    // One refresh attempt, then give up. Looping on 401 would turn an expired
    // session into a request storm against the auth endpoint.
    if (response.statusCode == 401 && authenticated && allowRetry) {
      if (await _refresh()) {
        return _send(
          method,
          path,
          body: body,
          authenticated: authenticated,
          allowRetry: false,
          // The same key on the retry, deliberately: a 401 fixed by a refresh
          // is one request, not two, and the server must be able to tell
          // whether the first attempt landed before the token expired.
          idempotencyKey: idempotencyKey,
        );
      }
      await tokens.clear();
      throw const AuthenticationFailure();
    }

    return _decode(response);
  }

  Future<List<dynamic>> _sendList(
    String method,
    String path, {
    bool allowRetry = true,
  }) async {
    final response = await _request(method, path, null, true, null);

    if (response.statusCode == 401 && allowRetry) {
      if (await _refresh()) {
        return _sendList(method, path, allowRetry: false);
      }
      await tokens.clear();
      throw const AuthenticationFailure();
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body.isEmpty
          ? const []
          : jsonDecode(response.body) as List<dynamic>;
    }

    throw failureFromResponse(
      status: response.statusCode,
      body: _bodyOf(response),
      headers: response.headers,
    );
  }

  Future<http.Response> _request(
    String method,
    String path,
    Map<String, dynamic>? body,
    bool authenticated,
    String? idempotencyKey,
  ) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = <String, String>{
      'content-type': 'application/json',
      'Idempotency-Key': ?idempotencyKey,
    };

    if (authenticated) {
      final stored = await tokens.read();
      if (stored == null) throw const AuthenticationFailure();
      headers['authorization'] = 'Bearer ${stored.accessToken}';
    }

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    try {
      return await http.Response.fromStream(await _client.send(request));
    } on http.ClientException {
      // The message never carries a URL, a host or a stack frame.
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
      await _storeSession(json);
      return true;
    } catch (_) {
      return false;
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    final body = _bodyOf(response);
    if (response.statusCode >= 200 && response.statusCode < 300) return body;

    throw failureFromResponse(
      status: response.statusCode,
      body: body,
      headers: response.headers,
    );
  }

  Map<String, dynamic> _bodyOf(http.Response response) {
    if (response.body.isEmpty) return const <String, dynamic>{};
    try {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } on FormatException {
      // A non-JSON body from a proxy or a gateway. Reported as a network
      // failure rather than crashing the screen that asked.
      return const <String, dynamic>{};
    }
  }
}
