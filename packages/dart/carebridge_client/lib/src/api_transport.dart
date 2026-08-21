import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'failures.dart';
import 'error_mapping.dart';
import 'token_store.dart';

/// The request/refresh loop, once.
///
/// This deliberately did **not** live here while there were two apps: the
/// duplication was twenty lines, and the family app and the console have
/// different session shapes — one carries a whole snapshot back from every
/// mutation, the other does not. A third app is what changed the arithmetic.
/// The shape difference turns out to sit entirely in what a caller does with a
/// decoded map, and what is actually duplicated is the part where a mistake is
/// invisible:
///
///   * **One refresh attempt, then stop.** Looping on 401 turns an expired
///     session into a request storm against the auth endpoint, and each app
///     that reimplements the loop is another chance to write `while`.
///   * **A failed refresh clears the session locally.** Anything else leaves a
///     device holding tokens the server has already revoked, retrying forever.
///   * **The retry carries the same Idempotency-Key.** A 401 fixed by a
///     refresh is one request, not two — the server has to be able to tell
///     whether the first attempt landed before the token expired.
///   * **One client per app, because one app owns refresh.** Two clients each
///     retrying a 401 will eventually both present the same rotated refresh
///     token, and reuse detection will — correctly — revoke the whole family.
///
/// Subclasses add the endpoints. They do not override any of the above.
abstract class ApiTransport {
  ApiTransport({required this.tokens, String? baseUrl, http.Client? client})
    : baseUrl = resolveBaseUrl(baseUrl ?? configuredBaseUrl),
      _client = client ?? http.Client();

  final TokenStore tokens;

  /// Where the API is, already resolved against the page's origin.
  final Uri baseUrl;

  final http.Client _client;

  /// Relative by default, because each app is served by an nginx that proxies
  /// `/api` from the same origin — which means no CORS, no API hostname
  /// compiled into a JavaScript bundle, and a Content-Security-Policy that can
  /// stay at `connect-src 'self'`.
  ///
  /// Override for `flutter run` against a separate host:
  /// `--dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:3000/api/v1`
  static const configuredBaseUrl = String.fromEnvironment(
    'CAREBRIDGE_API_BASE_URL',
    defaultValue: '/api/v1',
  );

  static Uri resolveBaseUrl(String raw) {
    final trimmed = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    // A relative value resolves against the page the app was served from,
    // which is exactly what makes the same-origin proxy work.
    return Uri.base.resolve(trimmed.isEmpty ? '/' : trimmed);
  }

  @mustCallSuper
  void dispose() => _client.close();

  /// One request, with a single refresh-and-retry on 401.
  @protected
  Future<Map<String, dynamic>> send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
    String? idempotencyKey,
  }) async {
    final response = await _request(
      method,
      path,
      body,
      authenticated,
      idempotencyKey,
    );

    if (response.statusCode == 401 && authenticated) {
      if (!await _refresh()) {
        await tokens.clear();
        throw const AuthenticationFailure();
      }
      final retried = await _request(
        method,
        path,
        body,
        authenticated,
        // The same key, deliberately — see the class docblock.
        idempotencyKey,
      );
      return _decodeObject(retried);
    }

    return _decodeObject(response);
  }

  /// The list-shaped sibling of [send].
  ///
  /// Separate rather than widening [send] to `dynamic`: almost every caller
  /// decodes an object, and widening the return type would push a cast into
  /// forty call sites to serve four.
  @protected
  Future<List<dynamic>> sendList(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _request(method, path, body, true, null);

    if (response.statusCode == 401) {
      if (!await _refresh()) {
        await tokens.clear();
        throw const AuthenticationFailure();
      }
      return _decodeList(await _request(method, path, body, true, null));
    }

    return _decodeList(response);
  }

  /// Persists the tokens from an authentication response.
  @protected
  Future<void> storeSession(Map<String, dynamic> json) => tokens.write(
    AuthTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    ),
  );

  Future<http.Response> _request(
    String method,
    String path,
    Map<String, dynamic>? body,
    bool authenticated,
    String? idempotencyKey,
  ) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      // Null-aware element: the header is simply absent when there is no key.
      'Idempotency-Key': ?idempotencyKey,
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
        'DELETE' => await _client.delete(uri, headers: headers, body: encoded),
        _ => throw ArgumentError('Unsupported method $method'),
      };
    } on http.ClientException {
      // The message a user sees never carries a URL, a host or a stack frame.
      throw const NetworkFailure();
    } on FormatException {
      throw const NetworkFailure();
    }
  }

  Future<bool> _refresh() async {
    final stored = await tokens.read();
    if (stored == null) return false;

    try {
      final response = await _request(
        'POST',
        '/auth/refresh',
        {'refreshToken': stored.refreshToken},
        false,
        null,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) return false;

      await storeSession(_decodeObject(response));
      return true;
    } catch (_) {
      return false;
    }
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    final body = _parse(response);
    if (_succeeded(response)) {
      if (body is Map<String, dynamic>) return body;
      if (body == null) return const <String, dynamic>{};
      throw const NetworkFailure();
    }
    throw _failure(response, body);
  }

  List<dynamic> _decodeList(http.Response response) {
    final body = _parse(response);
    if (_succeeded(response)) {
      if (body is List<dynamic>) return body;
      if (body == null) return const [];
      throw const NetworkFailure();
    }
    throw _failure(response, body);
  }

  bool _succeeded(http.Response response) =>
      response.statusCode >= 200 && response.statusCode < 300;

  /// A body that will not parse, on a response that failed anyway.
  ///
  /// A proxy or a gateway answering in HTML is a real thing, and it must map
  /// to the status the server actually returned rather than crashing the
  /// screen that asked. On a *successful* response the same body is a
  /// [NetworkFailure] instead — silently returning an empty object there would
  /// render as a family with no patients rather than as something going wrong.
  Failure _failure(http.Response response, Object? body) => failureFromResponse(
    status: response.statusCode,
    body: body is Map<String, dynamic> ? body : const <String, dynamic>{},
    headers: response.headers,
  );

  Object? _parse(http.Response response) {
    if (response.body.isEmpty) return null;
    try {
      return jsonDecode(response.body);
    } on FormatException {
      return const _Unparseable();
    }
  }
}

/// Distinguishes "no body" from "a body that is not JSON". Returning null for
/// both would let an HTML error page read as an empty successful response.
class _Unparseable {
  const _Unparseable();
}
