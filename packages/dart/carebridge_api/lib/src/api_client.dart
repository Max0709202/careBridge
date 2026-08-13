// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thrown when the server sends an enum value this client does not know.
///
/// Loud on purpose. A value the app has never heard of means the server is
/// ahead of it, and quietly mapping it to a default would render a ride in the
/// wrong state — which, in this product, is a false statement about where
/// somebody's parent is.
class CareBridgeUnknownEnumValue implements Exception {
  const CareBridgeUnknownEnumValue(this.enumName, this.value);

  final String enumName;
  final String value;

  @override
  String toString() =>
      'CareBridgeUnknownEnumValue: $enumName has no value "$value". '
      'The app is older than the API it is talking to.';
}

/// The API's one error envelope: `{ error: { code, message, correlationId } }`.
///
/// `notFoundOrForbidden` is deliberately ambiguous on the server — "no such
/// record" and "not yours" are indistinguishable so the API cannot be used to
/// probe for the existence of a patient or a ride. Clients must not try to
/// tell them apart either.
class CareBridgeApiException implements Exception {
  const CareBridgeApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.correlationId,
    this.field,
  });

  final int statusCode;
  final String code;

  /// Safe to show a user. The server never puts detail in here.
  final String message;

  /// Quote this to support: it is what connects the sentence "it said
  /// something went wrong" to a specific line in the server log.
  final String? correlationId;

  final String? field;

  bool get isAuthentication => statusCode == 401;
  bool get isNotFoundOrForbidden => code == 'not_found_or_forbidden';
  bool get isValidation => code == 'validation';

  @override
  String toString() => 'CareBridgeApiException($statusCode $code): $message';
}

/// Supplies the access token, and refreshes it when the API says it is stale.
typedef TokenProvider = Future<String?> Function();

/// Called on a 401 so the app can rotate its refresh token. Returns true if a
/// new access token is now available and the request is worth retrying once.
typedef TokenRefresher = Future<bool> Function();

/// The transport every generated API class shares.
class CareBridgeApiClient {
  CareBridgeApiClient({
    required this.baseUrl,
    this.accessToken,
    this.onUnauthorized,
    this.correlationIdFactory,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Root of the API, including the version prefix — e.g.
  /// `https://api.carebridge.example/api/v1`.
  final String baseUrl;

  final TokenProvider? accessToken;
  final TokenRefresher? onUnauthorized;

  /// Lets the app tie a user-visible error to a server log line. The server
  /// generates one when the client does not.
  final String Function()? correlationIdFactory;

  final http.Client _http;

  Future<dynamic> send({
    required String method,
    required String path,
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool allowRetry = true,
  }) async {
    final uri = Uri.parse(
      '$baseUrl$path',
    ).replace(queryParameters: (query == null || query.isEmpty) ? null : query);

    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
    };

    final token = await accessToken?.call();
    if (token != null && token.isNotEmpty) {
      headers['authorization'] = 'Bearer $token';
    }

    final correlationId = correlationIdFactory?.call();
    if (correlationId != null) headers['x-correlation-id'] = correlationId;

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);

    // One retry, and only after a successful refresh. Retrying on any 401
    // would turn an expired session into an infinite loop against the server.
    if (response.statusCode == 401 && allowRetry && onUnauthorized != null) {
      final refreshed = await onUnauthorized!.call();
      if (refreshed) {
        return send(
          method: method,
          path: path,
          body: body,
          query: query,
          allowRetry: false,
        );
      }
    }

    if (response.statusCode == 204 || response.body.isEmpty) {
      if (response.statusCode >= 400) throw _decodeError(response);
      return null;
    }

    final decoded = jsonDecode(response.body);
    if (response.statusCode >= 400) throw _decodeError(response, decoded);
    return decoded;
  }

  CareBridgeApiException _decodeError(
    http.Response response, [
    dynamic decoded,
  ]) {
    dynamic payload = decoded;
    if (payload == null && response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = null;
      }
    }

    final error = payload is Map<String, dynamic> ? payload['error'] : null;
    if (error is Map<String, dynamic>) {
      return CareBridgeApiException(
        statusCode: response.statusCode,
        code: error['code'] as String? ?? 'internal',
        message: error['message'] as String? ?? 'Something went wrong.',
        correlationId: error['correlationId'] as String?,
        field: error['field'] as String?,
      );
    }

    // A response that is not our envelope did not come from this API — a
    // proxy error page, a captive portal. Say so generically rather than
    // showing the user somebody else's HTML.
    return CareBridgeApiException(
      statusCode: response.statusCode,
      code: 'internal',
      message: 'Something went wrong on our side. Please try again.',
    );
  }

  void close() => _http.close();
}
