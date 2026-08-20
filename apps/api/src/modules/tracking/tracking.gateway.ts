import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import { AccessTokenVerifier } from '../auth/access-token.module';
import { TrackingAuthorizer } from './tracking.authorizer';
import {
  POSITION_STORE,
  type LivePosition,
  type PositionStorePort,
} from '../../infrastructure/tracking/position-store.port';

/** What the gateway keeps per connection. Never a patient id, never a name. */
interface SocketState {
  userId: string;
  token: string;
  /** Rides this socket is currently receiving positions for. */
  rides: Set<string>;
}

/**
 * Live positions, over Socket.IO.
 *
 * Mounted under `/api/v1/socket.io` so nginx's existing `/api/` proxy carries
 * it — which keeps the browser same-origin, keeps the API hostname out of the
 * bundle, and keeps the Content-Security-Policy at `connect-src 'self'`. A
 * WebSocket on its own host would have needed a second origin in that policy,
 * and the whole point of the current one is that there is nowhere for an
 * injected script to send what it reads.
 *
 * The design decision worth stating is **re-authorisation on a timer**.
 *
 * Everywhere else in this API, permission is checked on every request, because
 * every request carries a token. A subscription is checked once and then pays
 * out for as long as the socket is open — which on a dispatcher's desk is all
 * day. So three things that must stop a stream would otherwise not: the ride
 * finishing, the watcher's access being revoked, and the watcher's session
 * being ended. `revalidate` closes all three, by re-verifying the token (which
 * checks `tokenVersion`, so a global sign-out lands) and re-running
 * `canWatch` for every joined room.
 *
 * The alternative — checking on every emitted position — was rejected for
 * cost: a report every two seconds per ride would turn a read of a Redis key
 * into two database queries, at exactly the moment the system is busiest.
 * Fifteen seconds of over-permission on a revoked grant is a real cost, and it
 * is a far smaller one than a tracking path that falls over under load.
 */
@WebSocketGateway({
  path: '/api/v1/socket.io',
  namespace: '/tracking',
  // The API and the app are same-origin behind nginx, so no cross-origin
  // credentials are needed. `cors: false` is the honest setting: a browser on
  // another origin should not be able to open this at all.
  cors: false,
  serveClient: false,
})
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = new Logger(TrackingGateway.name);
  private readonly state = new WeakMap<Socket, SocketState>();
  private revalidator?: NodeJS.Timeout;

  // A `Namespace`, not the root `Server`: declaring `namespace` on the
  // decorator is what Nest injects here, and the two have different room APIs.
  @WebSocketServer()
  private server?: Namespace;

  /**
   * How often every open subscription is re-checked.
   *
   * Fifteen seconds is chosen against the thing it bounds: the window in
   * which somebody whose access was just revoked can still see where a patient
   * is. Shorter multiplies the query load by the number of open rooms;
   * longer makes "I removed their access" a statement with a visible lag.
   */
  private static readonly REVALIDATE_MS = 15_000;

  constructor(
    private readonly accessTokens: AccessTokenVerifier,
    private readonly authorizer: TrackingAuthorizer,
    @Inject(POSITION_STORE) private readonly positions: PositionStorePort,
  ) {}

  afterInit(): void {
    // Every position published anywhere in the deployment arrives here — from
    // this instance directly, or from another over Redis pub/sub — and is
    // emitted to the room for its ride. Membership of that room is the
    // authorisation; nothing is filtered at emit time.
    this.positions.subscribe((position) => this.broadcast(position));

    this.revalidator = setInterval(() => {
      void this.revalidateAll();
    }, TrackingGateway.REVALIDATE_MS);
    this.revalidator.unref?.();
  }

  onModuleDestroy(): void {
    if (this.revalidator) clearInterval(this.revalidator);
  }

  /**
   * Authenticates the handshake.
   *
   * A socket with no valid token never reaches a room — it is disconnected
   * here. The token is read from the handshake `auth` payload rather than a
   * query string on purpose: a query string lands in nginx's access log, and
   * an access token in a log file is a credential in a log file.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const token = tokenFrom(socket);

    if (!token) {
      this.refuse(socket, 'no credentials');
      return;
    }

    try {
      const caller = await this.accessTokens.verify(token);
      this.state.set(socket, {
        userId: caller.userId,
        token,
        rides: new Set(),
      });
    } catch {
      this.refuse(socket, 'invalid credentials');
    }
  }

  @SubscribeMessage('watch')
  async watch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ watching: boolean }> {
    const state = this.state.get(socket);
    const rideId = rideIdFrom(body);

    if (!state || !rideId) return { watching: false };

    if (!(await this.authorizer.canWatch(state.userId, rideId))) {
      // Refused with no reason, matching the HTTP surface: "no such ride" and
      // "not your ride" are one answer, or a ride id becomes a way to find out
      // whose ride it is.
      return { watching: false };
    }

    state.rides.add(rideId);
    await socket.join(room(rideId));

    // Sent immediately so a family opening the app mid-journey sees the car at
    // once rather than waiting up to ten seconds for the next report. Null is
    // a real answer — the driver may not have started moving.
    const latest = await this.positions.latest(rideId);
    if (latest) socket.emit('position', latest);

    return { watching: true };
  }

  @SubscribeMessage('unwatch')
  async unwatch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ watching: boolean }> {
    const state = this.state.get(socket);
    const rideId = rideIdFrom(body);
    if (!state || !rideId) return { watching: false };

    state.rides.delete(rideId);
    await socket.leave(room(rideId));
    return { watching: false };
  }

  // ─── fan-out ──────────────────────────────────────────────────────────────

  private broadcast(position: LivePosition): void {
    this.server?.to(room(position.rideId)).emit('position', position);
  }

  /**
   * Tells everyone watching a ride that it has stopped being watchable, and
   * empties the room.
   *
   * Called when a ride reaches a terminal state. Without it, a client would
   * keep a map open on a finished trip until the next revalidation pass — and
   * "the ride ended" is information the screen needs anyway, so pushing it is
   * better than letting it be inferred from silence.
   */
  async closeRoom(rideId: string, reason: 'ended'): Promise<void> {
    if (!this.server) return;

    this.server.to(room(rideId)).emit('closed', { rideId, reason });
    // Socket.IO's own room bookkeeping; the per-socket `rides` set is trimmed
    // by the next revalidation, which will also find `canWatch` false.
    this.server.in(room(rideId)).socketsLeave(room(rideId));
  }

  /**
   * Tells everyone watching that a car has gone quiet.
   *
   * Emitted to the room rather than persisted. A staleness warning is only
   * true for as long as the silence lasts, and a stored one would have to be
   * cleared by the next position — which is a second piece of state to keep in
   * step with the first, for a message whose whole value is being current.
   *
   * `silentForMs` is null when the ride has never reported at all, which is
   * the more worrying case and reads differently on screen.
   */
  async announceStale(rideId: string, silentForMs: number | null): Promise<void> {
    this.server?.to(room(rideId)).emit('stale', { rideId, silentForMs });
  }

  // ─── re-authorisation ─────────────────────────────────────────────────────

  /**
   * Re-checks every socket **this instance** holds.
   *
   * Local only, deliberately. `fetchSockets()` would return handles for
   * sockets connected to other instances, and this instance holds neither
   * their token nor their room set — each process revalidates its own
   * connections, and every process runs this timer.
   */
  private async revalidateAll(): Promise<void> {
    const sockets = this.server?.sockets;
    if (!sockets) return;

    for (const socket of [...sockets.values()]) {
      await this.revalidate(socket).catch((error: Error) => {
        this.logger.warn(`Revalidation failed for a socket: ${error.message}`);
      });
    }
  }

  private async revalidate(socket: Socket): Promise<void> {
    const state = this.state.get(socket);
    if (!state) return;

    // The token first. It expires in minutes while a socket lives for hours,
    // and `verifyAccessToken` also rejects a token whose `tokenVersion` is
    // stale — which is how "sign out everywhere" reaches an open socket.
    try {
      await this.accessTokens.verify(state.token);
    } catch {
      this.refuse(socket, 'credentials expired');
      return;
    }

    for (const rideId of [...state.rides]) {
      if (await this.authorizer.canWatch(state.userId, rideId)) continue;

      state.rides.delete(rideId);
      await socket.leave(room(rideId));
      socket.emit('closed', { rideId, reason: 'unauthorized' });
    }
  }

  /**
   * Ends a connection.
   *
   * The client is told the connection was refused but never why. A socket that
   * distinguishes "expired" from "never valid" from "not for this ride" hands
   * an attacker a probe, and the client's behaviour is the same in all three
   * cases: get a fresh token and reconnect.
   */
  private refuse(socket: Socket, reason: string): void {
    this.logger.debug(`Tracking socket refused: ${reason}`);
    socket.emit('closed', { reason: 'unauthorized' });
    socket.disconnect(true);
  }
}

function room(rideId: string): string {
  return `ride:${rideId}`;
}

/**
 * The access token from the handshake.
 *
 * `auth` only. Deliberately not the query string, and not a cookie: a query
 * string is written to nginx's access log verbatim, and a cookie would make
 * this endpoint reachable cross-origin by a form post.
 */
function tokenFrom(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  return typeof auth?.token === 'string' && auth.token.length > 0 ? auth.token : null;
}

function rideIdFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const rideId = (body as { rideId?: unknown }).rideId;
  return typeof rideId === 'string' && rideId.length > 0 ? rideId : null;
}
