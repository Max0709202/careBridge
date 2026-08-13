// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Transport requests and their timeline
class RidesApi {
  const RidesApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> request({required RequestTransportDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> cancel({
    required String id,
    required CancelRideDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides/${Uri.encodeComponent(id)}/cancel',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> delay({
    required String id,
    required SetDelayDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides/${Uri.encodeComponent(id)}/delay',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> location({
    required String id,
    required ReportLocationDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides/${Uri.encodeComponent(id)}/location',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> startPreview({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides/${Uri.encodeComponent(id)}/preview/start',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> stopPreview({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/rides/${Uri.encodeComponent(id)}/preview/stop',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }
}
