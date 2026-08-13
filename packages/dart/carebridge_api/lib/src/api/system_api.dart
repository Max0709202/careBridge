// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';

/// Health and readiness
class SystemApi {
  const SystemApi(this._client);

  final CareBridgeApiClient _client;

  /// Liveness
  ///
  /// Checks nothing external on purpose. A database blip must not get the
  /// container killed and restarted, which would turn a recoverable outage into
  /// a crash loop.
  Future<void> live() async {
    await _client.send(method: 'GET', path: '/health/live');
    return;
  }

  /// Readiness — may this instance take traffic
  Future<Map<String, dynamic>> ready() async {
    final response = await _client.send(method: 'GET', path: '/health/ready');
    return response as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> check() async {
    final response = await _client.send(method: 'GET', path: '/health');
    return response as Map<String, dynamic>;
  }
}
