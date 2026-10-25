/**
 * The tracking socket outliving its token. A family keeps the trip screen open
 * for the whole ride; the access token lasts minutes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryTokenStore } from '../src/api/tokens';
import { TrackingSocket } from '../src/api/trackingSocket';

type Handler = (data?: unknown) => void;
type Auth = (supply: (data: object) => void) => void;

function fakeIo() {
  const sockets: Array<{ handlers: Map<string, Handler>; auth: Auth }> = [];
  const connect = ((_url: string, options: { auth: Auth }) => {
    const handlers = new Map<string, Handler>();
    const socket = {
      connected: false,
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
        return socket;
      },
      emit: () => socket,
      disconnect: () => socket,
    };
    sockets.push({ handlers, auth: options.auth });
    return socket;
  }) as unknown as ConstructorParameters<typeof TrackingSocket>[2];
  const fire = (index: number, event: string, data?: unknown) => sockets[index]?.handlers.get(event)?.(data);
  return { connect, sockets, fire };
}

describe('TrackingSocket', () => {
  afterEach(() => vi.useRealTimers());

  function setUp() {
    vi.useFakeTimers();
    const tokens = new InMemoryTokenStore();
    tokens.write({ accessToken: 'first', refreshToken: 'r' });
    const io = fakeIo();
    return { tokens, io, socket: new TrackingSocket(tokens, 'http://localhost/api/v1', io.connect) };
  }

  it('starts again with the current token after the server ends the connection', () => {
    const { tokens, io, socket } = setUp();
    socket.watch('ride-1', () => undefined);

    tokens.write({ accessToken: 'second', refreshToken: 'r' });
    io.fire(0, 'disconnect', 'io server disconnect');
    vi.advanceTimersByTime(5_000);

    expect(io.sockets).toHaveLength(2);
    let presented: object | null = null;
    io.sockets[1]?.auth((data) => (presented = data));
    expect(presented).toEqual({ token: 'second' });
  });

  it('leaves a client-side disconnect alone, and stops once nothing is watched', () => {
    const { io, socket } = setUp();
    const stop = socket.watch('ride-1', () => undefined);

    // Socket.IO retries a dropped network on its own; this is not ours to redo.
    io.fire(0, 'disconnect', 'transport close');
    vi.advanceTimersByTime(10_000);
    expect(io.sockets).toHaveLength(1);

    io.fire(0, 'disconnect', 'io server disconnect');
    stop();
    vi.advanceTimersByTime(10_000);
    expect(io.sockets).toHaveLength(1);
  });
});
