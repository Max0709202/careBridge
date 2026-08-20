import 'dart:async';

import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../domain/models.dart';

/// Why a ride's live stream stopped.
enum TrackingClosure {
  /// The ride reached a terminal state. Expected, and the screen says so.
  ended,

  /// The server withdrew permission, or the session ended. Not an error to
  /// show as a failure — the screen falls back to the polled snapshot, which
  /// will itself stop returning the ride if access really is gone.
  unauthorized,
}

/// One live update about a ride.
@immutable
class TrackingUpdate {
  const TrackingUpdate.position(this.point, {this.etaMinutes})
    : closure = null,
      silentForMs = null;

  const TrackingUpdate.closed(this.closure)
    : point = null,
      etaMinutes = null,
      silentForMs = null;

  const TrackingUpdate.stale(this.silentForMs)
    : point = null,
      etaMinutes = null,
      closure = null;

  final TrackingPoint? point;
  final int? etaMinutes;
  final TrackingClosure? closure;

  /// How long the car has been silent, or null when it has never reported.
  final int? silentForMs;
}

/// The live position stream, over the API's Socket.IO gateway.
///
/// Replaces the 1.5-second poll that stood in for it. The poll is not deleted —
/// it still carries *status* changes, which this stream does not — but it no
/// longer has to run fast, because the thing that was changing every second was
/// the position and that now arrives by push.
///
/// Three properties are worth stating, because each is a decision the server
/// made and this client must not undo:
///
///   * **The token goes in the handshake `auth`, never the query string.** A
///     query string is written to nginx's access log verbatim, and an access
///     token in a log file is a credential in a log file.
///   * **A refused subscription is silent.** The server answers "no such ride"
///     and "not your ride" identically; this client must not turn that into a
///     visible distinction, so a refusal simply produces no stream.
///   * **`closed` is information, not an error.** A ride ending is the normal
///     end of a stream and the screen renders it as such.
class TrackingSocket {
  TrackingSocket({required this.tokens, String? baseUrl})
    : _origin = _originFor(baseUrl ?? _configuredBaseUrl);

  final TokenStore tokens;
  final Uri _origin;

  socket_io.Socket? _socket;
  final Map<String, StreamController<TrackingUpdate>> _streams = {};

  static const _configuredBaseUrl = String.fromEnvironment(
    'CAREBRIDGE_API_BASE_URL',
    defaultValue: '/api/v1',
  );

  /// The origin the gateway is mounted on.
  ///
  /// Resolved from the same base URL the HTTP client uses, so the socket is
  /// same-origin wherever the app is — which is what keeps the
  /// Content-Security-Policy at `connect-src 'self'` and the API hostname out
  /// of the bundle.
  static Uri _originFor(String raw) => Uri.base.resolve(raw);

  /// Positions for one ride, for as long as the returned stream is listened to.
  ///
  /// Per-ride rather than one stream filtered by the caller: the server only
  /// sends what a subscription asked for, and a client-side filter would mean
  /// receiving positions for rides this screen is not showing.
  Stream<TrackingUpdate> watch(String rideId) {
    final existing = _streams[rideId];
    if (existing != null) return existing.stream;

    final controller = StreamController<TrackingUpdate>.broadcast(
      onCancel: () => _unwatch(rideId),
    );
    _streams[rideId] = controller;

    unawaited(_ensureConnected().then((_) => _subscribe(rideId)));
    return controller.stream;
  }

  Future<void> _ensureConnected() async {
    if (_socket != null) return;

    final stored = await tokens.read();
    // No session: no socket. The screen still renders from the polled
    // snapshot, which is what a signed-out user would be refused anyway.
    if (stored == null) return;

    final socket = socket_io.io(
      '${_origin.origin}/tracking',
      socket_io.OptionBuilder()
          .setPath('/api/v1/socket.io')
          .setTransports(['websocket'])
          .setAuth({'token': stored.accessToken})
          .enableForceNew()
          .build(),
    );

    socket.on('position', (dynamic data) => _onPosition(data));
    socket.on('closed', (dynamic data) => _onClosed(data));
    socket.on('stale', (dynamic data) => _onStale(data));

    // A dropped socket re-subscribes rather than silently going quiet. The
    // server re-authorises every `watch`, so a reconnect is not a way to keep
    // a subscription the caller has since lost the right to.
    socket.onConnect((_) {
      for (final rideId in _streams.keys) {
        _subscribe(rideId);
      }
    });

    _socket = socket;
  }

  void _subscribe(String rideId) => _socket?.emit('watch', {'rideId': rideId});

  void _unwatch(String rideId) {
    _socket?.emit('unwatch', {'rideId': rideId});
    _streams.remove(rideId)?.close();

    if (_streams.isEmpty) {
      _socket?.dispose();
      _socket = null;
    }
  }

  void _onPosition(dynamic data) {
    final map = _asMap(data);
    if (map == null) return;

    final rideId = map['rideId'];
    final latitude = map['latitude'];
    final longitude = map['longitude'];
    final capturedAt = map['capturedAt'];

    if (rideId is! String ||
        latitude is! num ||
        longitude is! num ||
        capturedAt is! String) {
      return;
    }

    final at = DateTime.tryParse(capturedAt);
    if (at == null) return;

    final accuracy = map['accuracyMeters'];
    final eta = map['etaMinutes'];

    _streams[rideId]?.add(
      TrackingUpdate.position(
        TrackingPoint(
          coordinates: Coordinates(latitude.toDouble(), longitude.toDouble()),
          // Kept in UTC and aged against the device clock, exactly as the
          // polled path does. A position rendered against arrival time would
          // show a delayed upload as fresh.
          capturedAt: at.toUtc(),
          accuracyMeters: accuracy is num ? accuracy.toDouble() : 12,
        ),
        etaMinutes: eta is num ? eta.toInt() : null,
      ),
    );
  }

  void _onClosed(dynamic data) {
    final map = _asMap(data);
    final rideId = map?['rideId'];
    final reason = map?['reason'];

    final closure = reason == 'ended'
        ? TrackingClosure.ended
        : TrackingClosure.unauthorized;

    if (rideId is String) {
      _streams[rideId]?.add(TrackingUpdate.closed(closure));
      return;
    }

    // No ride id means the whole connection was refused — an expired token,
    // most often. Every stream hears about it and the screen falls back.
    for (final controller in _streams.values) {
      controller.add(TrackingUpdate.closed(closure));
    }
  }

  void _onStale(dynamic data) {
    final map = _asMap(data);
    final rideId = map?['rideId'];
    if (rideId is! String) return;

    final silent = map?['silentForMs'];
    _streams[rideId]?.add(
      TrackingUpdate.stale(silent is num ? silent.toInt() : null),
    );
  }

  Map<String, dynamic>? _asMap(dynamic data) =>
      data is Map<String, dynamic> ? data : null;

  void dispose() {
    for (final controller in _streams.values) {
      unawaited(controller.close());
    }
    _streams.clear();
    _socket?.dispose();
    _socket = null;
  }
}
