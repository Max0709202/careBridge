// Prefixed, as in the family app: the generated package carries the **wire**
// types and several share a name with this console's own domain enums —
// `DriverStatus`, `DispatchUrgency`. The prefix keeps the domain model
// primary, which is the right way round. The UI is written against the domain;
// the wire shape is an implementation detail of this file.
import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';

import '../domain/dispatch.dart';
import '../domain/models.dart';
import 'ops_codec.dart';

/// The console's HTTP client.
///
/// One client, because it owns refresh. Two of them each retrying a 401 will
/// eventually both present the same rotated refresh token, and the server's
/// reuse detection will — correctly — revoke the whole session family. On the
/// family app that signs somebody out of their phone; here it signs a
/// dispatcher out mid-shift with a queue on screen, which is worse.
///
/// Everything below is scoped by an organisation id in the path. That scoping
/// **is** the authorisation: no endpoint takes a driver or ride id as a
/// capability, `requireMembership` runs first on the server, and an id
/// belonging to another company answers 404 — indistinguishable from one that
/// does not exist. This client must not invent a distinction it was not given.
class OpsApi extends ApiTransport {
  OpsApi({required super.tokens, super.baseUrl, super.client});

  // ─── session ──────────────────────────────────────────────────────────────

  Future<void> signIn({required String email, required String password}) async {
    final json = await send(
      'POST',
      '/auth/login',
      body: {'email': email.trim(), 'password': password},
      authenticated: false,
    );
    await storeSession(json);
  }

  Future<void> signOut() async {
    // Cleared first, and unconditionally. A logout that fails on the network
    // must still end the session on this machine — a dispatcher walking away
    // from a shared terminal cannot be left signed in because a request
    // timed out.
    await tokens.clear();
    try {
      await send('POST', '/auth/logout-all');
    } catch (_) {
      // Already signed out locally, which is the part that matters here.
    }
  }

  // ─── organisations ────────────────────────────────────────────────────────

  /// Organisations the signed-in user holds a role in.
  ///
  /// The console has no notion of "the" organisation: somebody can dispatch
  /// for two operators, and picking one is a decision rather than a default.
  Future<List<Organization>> organizations() async =>
      (await sendList('GET', '/organizations'))
          .map((e) => wire.OrganizationDto.fromJson(e as Map<String, dynamic>))
          .map(organizationFromWire)
          .nonNulls
          .toList();

  // ─── the queue ────────────────────────────────────────────────────────────

  Future<DispatchQueue> queue(String organizationId) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await send('GET', '/organizations/$organizationId/dispatch/queue'),
    ),
  );

  /// Gives a ride to a driver, or moves it to another one.
  ///
  /// [reason] is required by the server when taking a ride off a driver who
  /// already had it, and the reassignment passes through
  /// `reassignmentRequired` so the family's timeline records that the first
  /// driver dropped it rather than showing a silent swap.
  Future<DispatchQueue> assign({
    required String organizationId,
    required String rideId,
    required String driverId,
    String? reason,
  }) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/dispatch/rides/$rideId/assign',
        // A dispatcher double-tapping on a slow connection must not produce
        // two assignments, and at the HTTP level a retry is indistinguishable
        // from a second decision.
        idempotencyKey: newId(),
        body: {
          'driverId': driverId,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  // ─── roster and fleet ─────────────────────────────────────────────────────

  Future<List<Driver>> drivers(String organizationId) async =>
      (await sendList('GET', '/organizations/$organizationId/drivers'))
          .map((e) => wire.DriverDto.fromJson(e as Map<String, dynamic>))
          .map(driverFromWire)
          .nonNulls
          .toList();

  Future<Driver?> setDriverStatus({
    required String organizationId,
    required String driverId,
    required DriverStatus to,
    String? reason,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/drivers/$driverId/status',
        body: {
          'to': to.wire,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  Future<Driver?> setShift({
    required String organizationId,
    required String driverId,
    required bool onShift,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'PUT',
        '/organizations/$organizationId/drivers/$driverId/shift',
        body: {'onShift': onShift},
      ),
    ),
  );

  Future<Driver?> addDriver({
    required String organizationId,
    required String displayName,
    required String vehicleId,
    int? yearsDriving,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/drivers',
        idempotencyKey: newId(),
        body: {
          'displayName': displayName.trim(),
          'vehicleId': vehicleId,
          'yearsDriving': ?yearsDriving,
        },
      ),
    ),
  );

  Future<List<Vehicle>> vehicles(String organizationId) async =>
      (await sendList('GET', '/organizations/$organizationId/vehicles'))
          .map((e) => wire.VehicleDto.fromJson(e as Map<String, dynamic>))
          .map(vehicleFromWire)
          .toList();

  Future<Vehicle> addVehicle({
    required String organizationId,
    required String make,
    required String model,
    required String color,
    required String licensePlate,
    required bool isWheelchairAccessible,
  }) async => vehicleFromWire(
    wire.VehicleDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/vehicles',
        idempotencyKey: newId(),
        body: {
          'make': make.trim(),
          'model': model.trim(),
          'color': color.trim(),
          'licensePlate': licensePlate.trim(),
          'isWheelchairAccessible': isWheelchairAccessible,
        },
      ),
    ),
  );

  // ─── seats ────────────────────────────────────────────────────────────────

  Future<SeatSummary> seats(String organizationId) async => seatsFromWire(
    wire.OrganizationSeatsDto.fromJson(
      await send('GET', '/organizations/$organizationId/seats'),
    ),
  );
}
