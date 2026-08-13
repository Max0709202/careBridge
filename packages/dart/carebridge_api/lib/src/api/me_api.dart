// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// The signed-in account: profile, preferences, devices, consents
class MeApi {
  const MeApi(this._client);

  final CareBridgeApiClient _client;

  /// UI preferences: selected patient, simplified mode
  Future<CareStateDto> update({required UpdatePreferencesDto body}) async {
    final response = await _client.send(
      method: 'PATCH',
      path: '/me/preferences',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  /// Devices registered for push
  ///
  /// The registration token itself is never returned — it is a capability to
  /// push to that device, and the list only needs to be recognisable.
  Future<List<DeviceTokenDto>> listDevices() async {
    final response = await _client.send(method: 'GET', path: '/me/devices');
    return (response as List<dynamic>)
        .map((e) => DeviceTokenDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Register or refresh an FCM token for this device
  Future<DeviceTokenDto> registerDevice({
    required RegisterDeviceDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/me/devices',
      body: body.toJson(),
    );
    return DeviceTokenDto.fromJson(response as Map<String, dynamic>);
  }

  /// Stop pushing to a device
  Future<void> revokeDevice({required String id}) async {
    await _client.send(
      method: 'DELETE',
      path: '/me/devices/${Uri.encodeComponent(id)}',
    );
    return;
  }
}
