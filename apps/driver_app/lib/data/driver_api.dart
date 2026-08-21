// Prefixed, as in the other two apps: the generated package carries the
// **wire** types and several share a name with this app's domain enums —
// `RideStatus` above all. The prefix keeps the domain model primary, which is
// the right way round.
import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';

import '../domain/models.dart';
import '../domain/ride_status.dart';
import 'driver_codec.dart';

/// How a flush of the queue went.
class FlushResult {
  const FlushResult({
    required this.stored,
    required this.ignored,
    required this.positionUpdated,
  });

  final int stored;
  final int ignored;
  final bool positionUpdated;
}

/// The driver app's API.
///
/// Note what none of these paths carry: a driver id. A driver acts as
/// themselves, resolved from the token, and only on rides that already name
/// them — so there is no identifier here that could be swapped for a
/// colleague's. The refresh loop, and the single-client rule that goes with
/// it, come from [ApiTransport].
class DriverApi extends ApiTransport {
  DriverApi({required super.tokens, super.baseUrl, super.client});

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
    // Cleared first, and unconditionally. A driver handing a phone back at the
    // end of a shift must not stay signed in because a request timed out.
    await tokens.clear();
    try {
      await send('POST', '/auth/logout-all');
    } catch (_) {
      // Already signed out on this device, which is the part that matters.
    }
  }

  // ─── the driver ───────────────────────────────────────────────────────────

  /// The signed-in driver, claiming their roster place on first use.
  ///
  /// A 404 here is not an error to shout about: it means this account is not
  /// on anybody's roster, which is exactly what a family member signing into
  /// the wrong app would see. The screen says so in words rather than showing
  /// a failure.
  Future<DriverProfile> profile() async => profileFromWire(
    wire.DriverProfileDto.fromJson(await send('GET', '/driver/me')),
  );

  Future<DriverProfile> setShift(bool onShift) async => profileFromWire(
    wire.DriverProfileDto.fromJson(
      await send('PUT', '/driver/shift', body: {'onShift': onShift}),
    ),
  );

  // ─── the work ─────────────────────────────────────────────────────────────

  Future<List<Job>> jobs() async => (await sendList('GET', '/driver/rides'))
      .map((e) => wire.DriverRideDto.fromJson(e as Map<String, dynamic>))
      .map(jobFromWire)
      .nonNulls
      .toList(growable: false);

  /// Moves a ride to its next state.
  ///
  /// Idempotency-keyed because the tap happens in a moving vehicle on a
  /// patchy connection, and at the HTTP level a retry is indistinguishable
  /// from a driver pressing the button twice.
  Future<Job?> advance(String rideId, RideStatus to) async => jobFromWire(
    wire.DriverRideDto.fromJson(
      await send(
        'POST',
        '/driver/rides/$rideId/advance',
        body: {'to': to.name},
        idempotencyKey: newId(),
      ),
    ),
  );

  // ─── position ─────────────────────────────────────────────────────────────

  /// Empties part of the offline queue.
  ///
  /// Deliberately not idempotency-keyed: the server makes a repeated batch a
  /// no-op through a unique constraint on `(rideId, capturedAt)`, which is
  /// stronger than a key. A device takes one reading per instant, so a retry
  /// after a lost response inserts nothing whether or not this app remembers
  /// the key it used.
  Future<FlushResult> flush(String rideId, List<Fix> fixes) async {
    final dto = wire.LocationBatchResultDto.fromJson(
      await send(
        'POST',
        '/driver/rides/$rideId/locations',
        body: {'points': fixes.map((f) => f.toJson()).toList()},
      ),
    );
    return FlushResult(
      stored: dto.stored,
      ignored: dto.ignored,
      positionUpdated: dto.positionUpdated,
    );
  }
}
