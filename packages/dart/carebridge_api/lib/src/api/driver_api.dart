// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "driver".
class DriverApi {
  const DriverApi(this._client);

  final CareBridgeApiClient _client;

  /// The signed-in driver, claiming their roster place on first use
  ///
  /// A driver is added to a roster before they have an account. This is where
  /// the two are joined — by matching the address the operator recorded against
  /// a **verified** address on the account, because an unverified match would
  /// let anyone who knows a driver’s email inherit their assignments.
  Future<DriverProfileDto> me() async {
    final response = await _client.send(method: 'GET', path: '/driver/me');
    return DriverProfileDto.fromJson(response as Map<String, dynamic>);
  }

  /// Start or end a shift
  ///
  /// Refuses to end one mid-trip: dispatch reads “on shift” to decide who can
  /// be offered the next job, and a driver who leaves that list while carrying
  /// somebody is a passenger nobody is accountable for.
  Future<DriverProfileDto> setShift({required DriverShiftDto body}) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/driver/shift',
      body: body.toJson(),
    );
    return DriverProfileDto.fromJson(response as Map<String, dynamic>);
  }

  /// The work still to do, soonest first
  ///
  /// Not a history. A finished ride leaves this list and takes the passenger’s
  /// address and telephone number with it — the record of who was carried where
  /// belongs to the operator, not to a phone in a glovebox.
  Future<List<DriverRideDto>> rides() async {
    final response = await _client.send(method: 'GET', path: '/driver/rides');
    return (response as List<dynamic>)
        .map((e) => DriverRideDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Move a ride to its next state
  ///
  /// Only the driver’s own moves. Accepting requires an approved driver on
  /// shift; finishing a trip already begun requires neither, because a driver
  /// suspended mid-journey still has somebody in the car.
  Future<DriverRideDto> advance({
    required String rideId,
    required AdvanceRideDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/driver/rides/${Uri.encodeComponent(rideId)}/advance',
      body: body.toJson(),
    );
    return DriverRideDto.fromJson(response as Map<String, dynamic>);
  }

  /// Flush the offline queue
  ///
  /// Safe to send twice: one device takes one reading per instant, so a retry
  /// after a lost response inserts nothing. Readings too old to present as
  /// current are still kept as journey history — they simply do not move the
  /// position the family is watching.
  Future<LocationBatchResultDto> reportLocations({
    required String rideId,
    required ReportLocationBatchDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/driver/rides/${Uri.encodeComponent(rideId)}/locations',
      body: body.toJson(),
    );
    return LocationBatchResultDto.fromJson(response as Map<String, dynamic>);
  }
}
