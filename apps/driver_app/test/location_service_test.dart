import 'dart:async';
import 'dart:convert';

import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_driver/data/driver_api.dart';
import 'package:carebridge_driver/domain/location_cadence.dart';
import 'package:carebridge_driver/domain/models.dart';
import 'package:carebridge_driver/domain/ride_status.dart';
import 'package:carebridge_driver/services/location_service.dart';
import 'package:carebridge_driver/services/position_source.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// The wiring between the satellite, the queue and the server.
///
/// What is worth testing here is not that a fix reaches the API — it is the
/// three things that happen when it cannot. A dead zone must not lose the
/// journey, a ride ending must stop the sampling, and moving to a different
/// ride must not send the last one's positions to the new one.

class FakePositionSource implements PositionSource {
  LocationAccess access = LocationAccess.granted;

  final List<Duration> requestedCadences = [];
  final List<StreamController<Fix>> _controllers = [];
  int stopped = 0;

  @override
  Future<LocationAccess> ensureAccess() async => access;

  @override
  Stream<Fix> watch({required Duration cadence}) {
    requestedCadences.add(cadence);
    final controller = StreamController<Fix>();
    _controllers.add(controller);
    return controller.stream;
  }

  @override
  Future<void> stop() async => stopped++;

  void emit(Fix fix) => _controllers.last.add(fix);

  Future<void> dispose() async {
    for (final controller in _controllers) {
      await controller.close();
    }
  }
}

class FakeBattery implements BatterySource {
  FakeBattery([this.value = const BatteryReading(percent: 80)]);

  BatteryReading value;

  @override
  Future<BatteryReading> read() async => value;
}

/// A server that records what it was sent and can be told to fail.
class RecordingServer {
  final List<List<dynamic>> batches = [];
  bool offline = false;

  http.Client get client => MockClient((request) async {
    if (offline) throw http.ClientException('no route to host');

    final body = jsonDecode(request.body) as Map<String, dynamic>;
    batches.add(body['points'] as List<dynamic>);
    return http.Response(
      jsonEncode({
        'stored': (body['points'] as List<dynamic>).length,
        'ignored': 0,
        'positionUpdated': true,
      }),
      201,
      headers: {'content-type': 'application/json'},
    );
  });
}

Job job({String id = 'ride-1', RideStatus status = RideStatus.driverEnRoute}) =>
    Job(
      id: id,
      status: status,
      scheduledPickupAt: DateTime.utc(2026, 6, 15, 14),
      passengerName: 'Margaret',
      pickup: const Place(
        label: 'Home',
        line1: '400 Parkside Avenue',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11226',
      ),
      destination: const Place(
        label: 'Clinic',
        line1: '451 Clarkson Avenue',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11203',
      ),
      wheelchairRequired: false,
      assistanceRequired: false,
      availableTransitions: const [],
    );

Fix fix({double speed = 12, double latitude = 40.65}) => Fix(
  latitude: latitude,
  longitude: -73.95,
  capturedAt: DateTime.now().toUtc(),
  speedMetersPerSecond: speed,
);

void main() {
  late FakePositionSource positions;
  late FakeBattery battery;
  late RecordingServer server;
  late DriverApi api;
  late LocationService service;

  setUp(() async {
    positions = FakePositionSource();
    battery = FakeBattery();
    server = RecordingServer();

    final tokens = InMemoryTokenStore();
    await tokens.write(
      const AuthTokens(accessToken: 'access', refreshToken: 'refresh'),
    );

    api = DriverApi(
      tokens: tokens,
      baseUrl: 'https://api.test/api/v1',
      client: server.client,
    );
    service = LocationService(api: api, positions: positions, battery: battery);
  });

  tearDown(() async {
    await service.dispose();
    await positions.dispose();
  });

  /// Lets the enqueue-and-flush chain finish.
  Future<void> settle() =>
      Future<void>.delayed(const Duration(milliseconds: 20));

  group('following a ride', () {
    test('asks the platform for the cadence the rules chose', () async {
      await service.follow(job());
      expect(
        positions.requestedCadences.single,
        cadenceFor(const CadenceInputs(status: RideStatus.driverEnRoute)),
      );
    });

    test('sends what it samples', () async {
      await service.follow(job());
      positions.emit(fix(latitude: 40.1));
      await settle();

      expect(server.batches.single, hasLength(1));
      expect(service.state.queued, 0);
    });

    test('will not sample without permission', () async {
      positions.access = LocationAccess.blocked;

      await service.follow(job());
      expect(positions.requestedCadences, isEmpty);
      expect(service.state.access, LocationAccess.blocked);
    });

    test(
      'does not restart the platform stream for an unchanged phase',
      () async {
        // Re-subscribing restarts the Android foreground service, which flickers
        // a notification in the driver's tray. `follow` runs on every poll, so
        // this has to be idempotent or it happens three times a minute.
        await service.follow(job());
        await service.follow(job());
        await service.follow(job());

        expect(positions.requestedCadences, hasLength(1));
      },
    );

    test('re-subscribes when the rate genuinely changes', () async {
      // Asking the platform for a slower interval is what actually reduces the
      // radio duty cycle — the whole battery argument. It cannot be done
      // without a new subscription.
      await service.follow(job());
      positions.emit(fix(speed: 0));
      await settle();

      expect(positions.requestedCadences, hasLength(2));
      expect(
        positions.requestedCadences.last,
        greaterThan(positions.requestedCadences.first),
      );
    });
  });

  group('a dead zone', () {
    test('keeps the fixes rather than losing the journey', () async {
      await service.follow(job());
      server.offline = true;

      positions.emit(fix(latitude: 1));
      await settle();
      positions.emit(fix(latitude: 2));
      await settle();

      expect(server.batches, isEmpty);
      expect(service.state.queued, 2);
    });

    test('sends the whole backlog in one request when signal returns', () async {
      await service.follow(job());
      server.offline = true;

      positions.emit(fix(latitude: 1));
      await settle();
      positions.emit(fix(latitude: 2));
      await settle();

      server.offline = false;
      positions.emit(fix(latitude: 3));
      await settle();

      // One request carrying three readings, not three requests at exactly the
      // moment the connection is worst.
      expect(server.batches.single, hasLength(3));
      expect(service.state.queued, 0);
    });
  });

  group('when the ride ends', () {
    test('stops sampling', () async {
      await service.follow(job());
      await service.follow(job(status: RideStatus.completed));

      expect(positions.stopped, greaterThan(0));
      expect(service.state.sharing, isFalse);
    });

    test('throws the queue away rather than flushing it', () async {
      // Location stops being collectable the moment the ride is over. A
      // farewell flush would be sending readings the server would refuse and
      // that should never have been stored.
      await service.follow(job());
      server.offline = true;
      positions.emit(fix());
      await settle();
      expect(service.state.queued, 1);

      server.offline = false;
      await service.follow(null);
      await settle();

      expect(server.batches, isEmpty);
      expect(service.state.queued, 0);
    });
  });

  group('moving to a different ride', () {
    test('does not send the last ride’s positions to the new one', () async {
      await service.follow(job(id: 'ride-1'));
      server.offline = true;
      positions.emit(fix(latitude: 1));
      await settle();

      server.offline = false;
      await service.follow(job(id: 'ride-2'));
      positions.emit(fix(latitude: 2));
      await settle();

      final sent = server.batches.expand((batch) => batch).toList();
      expect(sent, hasLength(1));
      expect((sent.single as Map<String, dynamic>)['latitude'], 2);
    });
  });
}
