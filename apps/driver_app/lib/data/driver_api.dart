// Prefixed, as in the other two apps: the generated package carries the
// **wire** types and several share a name with this app's domain enums —
// `RideStatus` above all. The prefix keeps the domain model primary, which is
// the right way round.
import 'dart:typed_data';

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

  // ─── paperwork ────────────────────────────────────────────────────────────

  Future<wire.DriverDocumentsDto> documents() async =>
      wire.DriverDocumentsDto.fromJson(await send('GET', '/driver/documents'));

  /// Authorises one upload and returns where to PUT the bytes.
  ///
  /// The file never passes through the API. This app uploads it straight to
  /// object storage with the URL and headers the server signed — which is why
  /// the headers below are sent exactly as given rather than merged with
  /// anything this client thinks is a good idea.
  Future<wire.PresignedUploadDto> authoriseUpload({
    required String kind,
    required String contentType,
    DateTime? expiresAt,
  }) async => wire.PresignedUploadDto.fromJson(
    await send(
      'POST',
      '/driver/documents',
      body: {
        'kind': kind,
        'contentType': contentType,
        if (expiresAt != null) 'expiresAt': expiresAt.toUtc().toIso8601String(),
      },
    ),
  );

  /// PUTs the bytes to the signed URL.
  ///
  /// Outside [ApiTransport] on purpose: this request carries no bearer token,
  /// goes to a different host in production, and must send exactly the headers
  /// the signature covers. Routing it through the shared transport would
  /// attach an Authorization header S3 would reject.
  Future<void> uploadBytes({
    required wire.PresignedUploadDto slot,
    required Uint8List bytes,
  }) async {
    // The shared client, so the connection pool is shared and a test can
    // replace it — but **not** `send`, which would attach the session. An
    // Authorization header here is a bearer token handed to a third party, and
    // S3 would reject the request for it anyway.
    final response = await httpClient.put(
      Uri.parse(slot.url),
      headers: slot.headers.map(
        (key, value) => MapEntry(key, value.toString()),
      ),
      body: bytes,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const NetworkFailure();
    }
  }

  Future<wire.DriverDocumentsDto> confirmUpload(String documentId) async =>
      wire.DriverDocumentsDto.fromJson(
        await send(
          'POST',
          '/driver/documents/confirm',
          body: {'documentId': documentId},
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
