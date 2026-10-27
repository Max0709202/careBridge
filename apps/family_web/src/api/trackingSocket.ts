/**
 * The live position stream over the API's Socket.IO gateway. Mirrors
 * lib/data/tracking_socket.dart, including the three decisions this client
 * must not undo:
 *
 *  - **The token goes in the handshake `auth`, never the query string.** A
 *    query string is written to nginx's access log verbatim.
 *  - **A refused subscription is silent.** "No such ride" and "not your ride"
 *    are answered identically, so a refusal simply produces no updates.
 *  - **`closed` is information, not an error.** A ride ending is the normal end.
 *
 * One socket for the app: a second connection would be a second handshake
 * presenting the same token.
 */
import { io, type Socket } from 'socket.io-client';

import type { TrackingPoint } from '../domain/models';
import type { TokenStore } from './tokens';
import { configuredBaseUrl, resolveBaseUrl } from './transport';

export type TrackingClosure = 'ended' | 'unauthorized';

export type TrackingUpdate =
  | { type: 'position'; point: TrackingPoint; etaMinutes: number | null }
  | { type: 'closed'; closure: TrackingClosure }
  | { type: 'stale'; silentForMs: number | null };

type Listener = (update: TrackingUpdate) => void;

const RECONNECT_AFTER_MS = 5_000;

export class TrackingSocket {
  private socket: Socket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly origin: string;

  constructor(
    private readonly tokens: TokenStore,
    baseUrl: string = configuredBaseUrl,
    private readonly connect: typeof io = io,
  ) {
    // Resolved the same way as the HTTP client, so the socket is same-origin
    // wherever the app is served.
    this.origin = resolveBaseUrl(baseUrl).origin;
  }

  /**
   * Updates for one ride until the returned function is called. Per ride, so
   * the server only ever sends what a screen is actually showing.
   */
  watch(rideId: string, listener: Listener): () => void {
    let set = this.listeners.get(rideId);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(rideId, set);
    }
    set.add(listener);

    this.ensureConnected();
    if (isNew) this.subscribe(rideId);

    return () => {
      const current = this.listeners.get(rideId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.unwatch(rideId);
    };
  }

  dispose(): void {
    this.listeners.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.disconnect();
    this.socket = null;
  }

  private ensureConnected(): void {
    if (this.socket) return;

    // No session: no socket. The screen still renders from the polled snapshot.
    const stored = this.tokens.read();
    if (!stored) return;

    const socket = this.connect(`${this.origin}/tracking`, {
      path: '/api/v1/socket.io',
      transports: ['websocket'],
      // A function, so every (re)connect presents the token as it is now
      // rather than the one the page started with.
      auth: (supply: (data: object) => void) =>
        supply({ token: this.tokens.read()?.accessToken ?? '' }),
      forceNew: true,
    });

    socket.on('position', (data: unknown) => this.onPosition(data));
    socket.on('closed', (data: unknown) => this.onClosed(data));
    socket.on('stale', (data: unknown) => this.onStale(data));

    // A dropped socket re-subscribes rather than silently going quiet. The
    // server re-authorises every `watch`, so a reconnect is not a way to keep a
    // subscription the caller has since lost the right to.
    socket.on('connect', () => {
      for (const rideId of this.listeners.keys()) this.subscribe(rideId);
    });

    // The server ending the connection (an expired token, most often) is not
    // retried by Socket.IO itself. Start again after a pause; by then the
    // polled snapshot has made the HTTP client refresh the token.
    socket.on('disconnect', (reason: string) => {
      if (reason !== 'io server disconnect' || this.socket !== socket) return;
      this.socket = null;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.listeners.size > 0) this.ensureConnected();
      }, RECONNECT_AFTER_MS);
    });

    this.socket = socket;
  }

  private subscribe(rideId: string): void {
    if (this.socket?.connected) this.socket.emit('watch', { rideId });
  }

  private unwatch(rideId: string): void {
    this.socket?.emit('unwatch', { rideId });
    this.listeners.delete(rideId);
    if (this.listeners.size === 0) {
      this.socket?.disconnect();
      this.socket = null;
    }
  }

  private emit(rideId: string, update: TrackingUpdate): void {
    for (const listener of this.listeners.get(rideId) ?? []) listener(update);
  }

  private onPosition(data: unknown): void {
    const map = asMap(data);
    if (!map) return;
    const { rideId, latitude, longitude, capturedAt, accuracyMeters, etaMinutes } = map;
    if (
      typeof rideId !== 'string' ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      typeof capturedAt !== 'string'
    ) {
      return;
    }
    const at = new Date(capturedAt);
    if (Number.isNaN(at.getTime())) return;

    this.emit(rideId, {
      type: 'position',
      point: {
        coordinates: { latitude, longitude },
        // Aged against the device's capture time, exactly as the polled path.
        capturedAt: at,
        accuracyMeters: typeof accuracyMeters === 'number' ? accuracyMeters : 12,
      },
      etaMinutes: typeof etaMinutes === 'number' ? Math.trunc(etaMinutes) : null,
    });
  }

  private onClosed(data: unknown): void {
    const map = asMap(data);
    const closure: TrackingClosure = map?.reason === 'ended' ? 'ended' : 'unauthorized';
    const rideId = map?.rideId;

    if (typeof rideId === 'string') {
      this.emit(rideId, { type: 'closed', closure });
      return;
    }
    // No ride id: the whole connection was refused — most often an expired
    // token. Every watcher hears it and falls back to the snapshot.
    for (const id of this.listeners.keys()) this.emit(id, { type: 'closed', closure });
  }

  private onStale(data: unknown): void {
    const map = asMap(data);
    const rideId = map?.rideId;
    if (typeof rideId !== 'string') return;
    const silent = map?.silentForMs;
    this.emit(rideId, {
      type: 'stale',
      silentForMs: typeof silent === 'number' ? Math.trunc(silent) : null,
    });
  }
}

function asMap(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}
