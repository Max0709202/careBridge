// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Appointments, rescheduling and reminders
class AppointmentsApi {
  const AppointmentsApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> create({required CreateAppointmentDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/appointments',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> reschedule({
    required String id,
    required RescheduleAppointmentDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/appointments/${Uri.encodeComponent(id)}/reschedule',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> cancel({
    required String id,
    required CancelAppointmentDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/appointments/${Uri.encodeComponent(id)}/cancel',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }
}
