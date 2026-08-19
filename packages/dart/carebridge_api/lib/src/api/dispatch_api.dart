// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "dispatch".
class DispatchApi {
  const DispatchApi(this._client);

  final CareBridgeApiClient _client;

  /// The operator's vehicles
  Future<List<VehicleDto>> vehicles({required String organizationId}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/vehicles',
    );
    return (response as List<dynamic>)
        .map((e) => VehicleDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Add a vehicle
  Future<VehicleDto> addVehicle({
    required String organizationId,
    required CreateVehicleDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/vehicles',
      body: body.toJson(),
    );
    return VehicleDto.fromJson(response as Map<String, dynamic>);
  }

  /// The roster, with who is billable and who is free
  Future<List<DriverDto>> drivers({required String organizationId}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/drivers',
    );
    return (response as List<dynamic>)
        .map((e) => DriverDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Add a driver
  ///
  /// Created as `invited`. The billable seat moves at approval, so a roster can
  /// be built without being charged for people who have not handed in a
  /// licence.
  Future<DriverDto> addDriver({
    required String organizationId,
    required CreateDriverDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/drivers',
      body: body.toJson(),
    );
    return DriverDto.fromJson(response as Map<String, dynamic>);
  }

  /// Move a driver through the lifecycle
  ///
  /// Crossing into or out of `approved` grants or releases a billable seat, in
  /// the same transaction as the status change.
  Future<DriverDto> setDriverStatus({
    required String organizationId,
    required String driverId,
    required SetDriverStatusDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/drivers/${Uri.encodeComponent(driverId)}/status',
      body: body.toJson(),
    );
    return DriverDto.fromJson(response as Map<String, dynamic>);
  }

  /// Put a driver on or off shift
  ///
  /// A dispatcher may do this: they are the person who knows somebody called in
  /// sick, and waiting for an admin would leave the queue offering a driver who
  /// is not there.
  Future<DriverDto> setShift({
    required String organizationId,
    required String driverId,
    required SetShiftDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/drivers/${Uri.encodeComponent(driverId)}/shift',
      body: body.toJson(),
    );
    return DriverDto.fromJson(response as Map<String, dynamic>);
  }

  /// Rides waiting for a car, ordered by when the car is needed
  ///
  /// Not by when the request arrived: a ride booked this morning for 4pm is not
  /// more urgent than one booked five minutes ago for 2pm.
  Future<DispatchQueueDto> queue({required String organizationId}) async {
    final response = await _client.send(
      method: 'GET',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/dispatch/queue',
    );
    return DispatchQueueDto.fromJson(response as Map<String, dynamic>);
  }

  /// Give a ride to a driver, or move it to another one
  ///
  /// Eligibility is asserted, not advised — a wheelchair trip cannot be given
  /// to a saloon car, and a driver cannot be given a second passenger. A
  /// reassignment requires a reason and passes through `reassignmentRequired`,
  /// so the family timeline records that the first driver dropped it.
  Future<DispatchQueueDto> assign({
    required String organizationId,
    required String rideId,
    required AssignRideDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/organizations/${Uri.encodeComponent(organizationId)}/dispatch/rides/${Uri.encodeComponent(rideId)}/assign',
      body: body.toJson(),
    );
    return DispatchQueueDto.fromJson(response as Map<String, dynamic>);
  }
}
