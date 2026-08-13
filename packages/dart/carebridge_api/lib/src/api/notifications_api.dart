// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// The in-app centre and per-channel preferences
class NotificationsApi {
  const NotificationsApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> markAllRead() async {
    final response = await _client.send(
      method: 'POST',
      path: '/notifications/read-all',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> markRead({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/notifications/${Uri.encodeComponent(id)}/read',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  /// The full notification matrix
  ///
  /// Returned complete — defaults merged with the user’s changes — so the
  /// client never has to hold a second copy of the policy, which would be free
  /// to drift from the server’s.
  Future<List<NotificationPreferenceDto>> listPreferences() async {
    final response = await _client.send(
      method: 'GET',
      path: '/notifications/preferences',
    );
    return (response as List<dynamic>)
        .map(
          (e) => NotificationPreferenceDto.fromJson(e as Map<String, dynamic>),
        )
        .toList();
  }

  /// Turn one channel on or off for one event kind
  ///
  /// Only email and push are configurable. In-app is the record of what
  /// happened and is always on.
  Future<List<NotificationPreferenceDto>> setPreference({
    required SetNotificationPreferenceDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/notifications/preferences',
      body: body.toJson(),
    );
    return (response as List<dynamic>)
        .map(
          (e) => NotificationPreferenceDto.fromJson(e as Map<String, dynamic>),
        )
        .toList();
  }
}
