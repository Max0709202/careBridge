// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Clinics and their geocoded locations
class ClinicsApi {
  const ClinicsApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> create({required SaveClinicDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/clinics',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }
}
