// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// The one-shot state snapshot the app opens with
class CareApi {
  const CareApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> state() async {
    final response = await _client.send(method: 'GET', path: '/care/state');
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }
}
