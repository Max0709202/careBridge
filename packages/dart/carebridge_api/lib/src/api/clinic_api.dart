// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "clinic".
class ClinicApi {
  const ClinicApi(this._client);

  final CareBridgeApiClient _client;

  /// The sites this network has claimed
  Future<List<ClinicSiteDto>> sites({required String organizationId}) async {
    final response = await _client.send(
      method: 'GET',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/clinic/sites',
    );
    return (response as List<dynamic>)
        .map((e) => ClinicSiteDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Attach an existing clinic record to this network
  ///
  /// A claim rather than a creation: the record was almost certainly typed by a
  /// family saying where their relative’s appointment is. Restricted to an
  /// admin and audited, because claiming a site grants sight of every
  /// appointment anybody has ever booked there.
  Future<List<ClinicSiteDto>> claim({
    required String organizationId,
    required String clinicId,
    required ClaimClinicDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/clinic/sites/${Uri.encodeComponent(clinicId)}/claim',
      body: body.toJson(),
    );
    return (response as List<dynamic>)
        .map((e) => ClinicSiteDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Everybody expected today, and where their car is
  ///
  /// The date is resolved in the **clinic’s** own zone rather than the
  /// server’s. A portal that showed yesterday’s list to a west-coast clinic
  /// every morning would be useless by nine o’clock.
  Future<ClinicDayDto> day({
    required String organizationId,
    String? on_,
    String? clinicId,
  }) async {
    final query = <String, String>{
      if (on_ != null) 'on': on_.toString(),
      if (clinicId != null) 'clinicId': clinicId.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/clinic/day',
      query: query,
    );
    return ClinicDayDto.fromJson(response as Map<String, dynamic>);
  }

  /// The patient walked in
  ///
  /// Never inferred from the ride completing. A completed ride says a car
  /// reached an address; this says somebody inside the building saw them, and
  /// the gap between the two is an eighty-year-old at the wrong entrance of a
  /// hospital.
  Future<ExpectedArrivalDto> checkIn({
    required String organizationId,
    required String appointmentId,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/clinic/appointments/${Uri.encodeComponent(appointmentId)}/check-in',
    );
    return ExpectedArrivalDto.fromJson(response as Map<String, dynamic>);
  }

  /// The visit is over — send the car
  ///
  /// What a `flexibleReturn` ride has been waiting for since it was booked.
  /// Nobody knows when a cardiology follow-up will finish, which is why the
  /// return leg is created without a time; this is the thing that tells it the
  /// time has come.
  Future<ExpectedArrivalDto> ready({
    required String organizationId,
    required String appointmentId,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/clinic/appointments/${Uri.encodeComponent(appointmentId)}/ready',
    );
    return ExpectedArrivalDto.fromJson(response as Map<String, dynamic>);
  }
}
