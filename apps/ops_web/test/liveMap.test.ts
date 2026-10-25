/**
 * The live map's rules, its wire mapping and the tracking socket.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { liveBoardFromWire, queueItemFromWire, serviceAreaFromWire } from '../src/api/codec';
import { InMemoryTokenStore } from '../src/api/tokens';
import { TrackingSocket, type TrackingUpdate } from '../src/api/trackingSocket';
import { freshnessOf, withPosition, type LivePosition, type LiveRide } from '../src/domain/liveMap';
import { queueItem } from './support/fixtures';

const now = new Date('2026-10-24T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const position = (capturedAt: Date, latitude = 37.77): LivePosition => ({
  latitude,
  longitude: -122.41,
  accuracyMeters: 8,
  capturedAt,
});

const ride = (overrides: Partial<LiveRide> = {}): LiveRide => ({
  rideId: 'ride-1',
  status: 'driverEnRoute',
  driverId: 'driver-1',
  driverName: 'Marcus T.',
  patientName: 'Margaret H.',
  scheduledPickupAt: now,
  pickup: null,
  destination: null,
  position: null,
  etaMinutes: null,
  isDelayed: false,
  route: null,
  ...overrides,
});

describe('freshnessOf', () => {
  it('uses the same thresholds as the server: 45 seconds stale, 2 minutes lost', () => {
    expect(freshnessOf(position(ago(10_000)), now)).toBe('fresh');
    expect(freshnessOf(position(ago(46_000)), now)).toBe('stale');
    expect(freshnessOf(position(ago(121_000)), now)).toBe('lost');
    expect(freshnessOf(null, now)).toBe('lost');
  });
});

describe('withPosition', () => {
  it('takes a newer reading and ignores an older one arriving late', () => {
    const current = ride({ position: position(ago(5_000), 1), etaMinutes: 9 });
    expect(withPosition(current, position(ago(1_000), 2), 8).position?.latitude).toBe(2);
    expect(withPosition(current, position(ago(20_000), 3), 12)).toBe(current);
  });
});

describe('the wire', () => {
  it('reads both kinds of area, and drops one missing what its kind needs', () => {
    const center = { latitude: 1, longitude: 2 };
    expect(serviceAreaFromWire({ kind: 'radius', center, radiusMiles: 5, points: null })).toEqual({
      kind: 'radius',
      center,
      radiusMiles: 5,
    });
    expect(serviceAreaFromWire({ kind: 'radius', center: null, radiusMiles: 5, points: null })).toBeNull();
    expect(
      serviceAreaFromWire({ kind: 'polygon', center: null, radiusMiles: null, points: [center, center, center] })
        ?.kind,
    ).toBe('polygon');
    expect(serviceAreaFromWire({ kind: 'zip' as never, center: null, radiusMiles: null, points: null })).toBeNull();
  });

  it('reads a board, dating positions by when the device took them', () => {
    const board = liveBoardFromWire({
      organizationId: 'org-1',
      serviceArea: null,
      rides: [
        {
          rideId: 'ride-1',
          status: 'driverEnRoute',
          driverId: 'driver-1',
          driverName: 'Marcus T.',
          patientName: 'Margaret H.',
          scheduledPickupAt: now.toISOString(),
          pickup: { latitude: 1, longitude: 2 },
          destination: null,
          position: { latitude: 3, longitude: 4, accuracyMeters: 5, capturedAt: ago(1_000).toISOString() },
          etaMinutes: 6,
          isDelayed: false,
          route: { target: 'pickup', path: [{ latitude: 3, longitude: 4 }, { latitude: 1, longitude: 2 }] },
        },
      ],
    });
    expect(board.rides[0]?.position?.capturedAt).toEqual(ago(1_000));
    expect(board.rides[0]?.destination).toBeNull();
    expect(board.rides[0]?.route?.path).toHaveLength(2);
  });

  it('drops a route that is not a road', () => {
    const wire = (route: unknown) =>
      liveBoardFromWire({
        organizationId: 'org-1',
        serviceArea: null,
        rides: [
          {
            rideId: 'ride-1',
            status: 'driverEnRoute',
            driverId: 'd',
            driverName: 'M',
            patientName: 'P',
            scheduledPickupAt: now.toISOString(),
            pickup: null,
            destination: null,
            position: null,
            etaMinutes: null,
            isDelayed: false,
            route: route as never,
          },
        ],
      }).rides[0]?.route;
    expect(wire(null)).toBeNull();
    expect(wire({ target: 'pickup', path: [{ latitude: 1, longitude: 2 }] })).toBeNull();
    expect(wire({ target: 'home', path: [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }] })).toBeNull();
  });

  it('treats a queue item with no area answer as unknown, not inside', () => {
    const { pickupInServiceArea: _omitted, ...older } = queueItem();
    expect(queueItemFromWire(older as never)?.pickupInServiceArea).toBeNull();
    expect(queueItemFromWire(queueItem({ pickupInServiceArea: false }))?.pickupInServiceArea).toBe(false);
  });
});

// ─── the socket ─────────────────────────────────────────────────────────────

type Handler = (data?: unknown) => void;

function fakeIo() {
  const sockets: Array<{
    handlers: Map<string, Handler>;
    emitted: Array<[string, unknown]>;
    connected: boolean;
    auth: (supply: (data: object) => void) => void;
  }> = [];

  const connect = ((_url: string, options: { auth: (supply: (data: object) => void) => void }) => {
    const handlers = new Map<string, Handler>();
    const socket = {
      handlers,
      emitted: [] as Array<[string, unknown]>,
      connected: false,
      auth: options.auth,
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
        return socket;
      },
      emit(event: string, data: unknown) {
        socket.emitted.push([event, data]);
        return socket;
      },
      disconnect() {
        socket.connected = false;
        return socket;
      },
    };
    sockets.push(socket);
    return socket;
  }) as unknown as ConstructorParameters<typeof TrackingSocket>[2];

  const fire = (index: number, event: string, data?: unknown) => {
    const socket = sockets[index]!;
    if (event === 'connect') socket.connected = true;
    socket.handlers.get(event)?.(data);
  };

  return { connect, sockets, fire };
}

describe('TrackingSocket', () => {
  afterEach(() => vi.useRealTimers());

  function setUp() {
    const tokens = new InMemoryTokenStore();
    tokens.write({ accessToken: 'first', refreshToken: 'r' });
    const io = fakeIo();
    const socket = new TrackingSocket(tokens, 'http://localhost/api/v1', io.connect);
    return { tokens, io, socket };
  }

  it('watches each ride once connected and hands positions to that ride only', () => {
    const { io, socket } = setUp();
    const one: TrackingUpdate[] = [];
    const two: TrackingUpdate[] = [];
    socket.watch('ride-1', (u) => one.push(u));
    socket.watch('ride-2', (u) => two.push(u));
    io.fire(0, 'connect');

    expect(io.sockets[0]?.emitted).toEqual([
      ['watch', { rideId: 'ride-1' }],
      ['watch', { rideId: 'ride-2' }],
    ]);

    io.fire(0, 'position', {
      rideId: 'ride-2',
      latitude: 1,
      longitude: 2,
      accuracyMeters: 3,
      capturedAt: now.toISOString(),
      etaMinutes: 4,
    });
    expect(one).toEqual([]);
    expect(two).toEqual([
      {
        type: 'position',
        position: { latitude: 1, longitude: 2, accuracyMeters: 3, capturedAt: now },
        etaMinutes: 4,
      },
    ]);
  });

  it('starts again with the current token after the server ends the connection', () => {
    vi.useFakeTimers();
    const { tokens, io, socket } = setUp();
    socket.watch('ride-1', () => undefined);
    io.fire(0, 'connect');

    tokens.write({ accessToken: 'second', refreshToken: 'r' });
    io.fire(0, 'disconnect', 'io server disconnect');
    expect(io.sockets).toHaveLength(1);

    vi.advanceTimersByTime(5_000);
    expect(io.sockets).toHaveLength(2);
    let presented: object | null = null;
    io.sockets[1]?.auth((data) => (presented = data));
    expect(presented).toEqual({ token: 'second' });
  });

  it('does not reconnect once nothing is being watched', () => {
    vi.useFakeTimers();
    const { io, socket } = setUp();
    const stop = socket.watch('ride-1', () => undefined);
    io.fire(0, 'connect');
    io.fire(0, 'disconnect', 'io server disconnect');
    stop();

    vi.advanceTimersByTime(10_000);
    expect(io.sockets).toHaveLength(1);
  });
});
