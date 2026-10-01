import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import { AccessTokenVerifier } from '../auth/access-token.module';
import {
  REALTIME_BUS,
  type RealtimeBusPort,
  type RealtimeEvent,
} from '../../infrastructure/realtime/realtime-bus.port';

interface SocketState {
  userId: string;
  token: string;
}

/**
 * Messages and call state, out to the people they concern. ADR-0014.
 *
 * One-directional, like tracking: nothing is written through this socket.
 * A client joins exactly one room — its own user's — and never names a
 * conversation, so there is no subscription to authorise and nothing to
 * re-check when a grant is revoked. **Authorisation happens at publish time**:
 * the service resolves who is in a thread when something happens in it, and
 * only those users' rooms are emitted to. Someone removed from a patient's
 * circle simply stops being in the list.
 *
 * What still has to be re-checked on a timer is the token, for the same
 * reason as tracking: a socket lives for hours, a token for minutes, and "sign
 * out everywhere" has to reach an open connection.
 */
@WebSocketGateway({
  path: '/api/v1/socket.io',
  namespace: '/messaging',
  cors: false,
  serveClient: false,
})
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = new Logger(MessagingGateway.name);
  private readonly state = new WeakMap<Socket, SocketState>();
  private revalidator?: NodeJS.Timeout;

  /** Same bound as tracking: how long a signed-out session can keep receiving. */
  private static readonly REVALIDATE_MS = 15_000;

  @WebSocketServer()
  private server?: Namespace;

  constructor(
    private readonly accessTokens: AccessTokenVerifier,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBusPort,
  ) {}

  afterInit(): void {
    this.bus.subscribe((event) => this.deliver(event));

    this.revalidator = setInterval(() => {
      void this.revalidateAll();
    }, MessagingGateway.REVALIDATE_MS);
    this.revalidator.unref?.();
  }

  onModuleDestroy(): void {
    if (this.revalidator) clearInterval(this.revalidator);
  }

  /** Token from the handshake `auth` payload only — never the query string, which nginx logs. */
  async handleConnection(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const token =
      typeof auth?.token === 'string' && auth.token.length > 0 ? auth.token : null;
    if (!token) {
      this.refuse(socket);
      return;
    }

    try {
      const caller = await this.accessTokens.verify(token);
      this.state.set(socket, { userId: caller.userId, token });
      await socket.join(userRoom(caller.userId));
      socket.emit('ready', {});
    } catch {
      this.refuse(socket);
    }
  }

  /**
   * Emits to each addressed user's room. A message event carries its sender
   * so each socket can be told whether the message is its own; the sender id
   * itself is not passed on.
   */
  private deliver(event: RealtimeEvent): void {
    const server = this.server;
    if (!server) return;

    if (event.name !== 'message.created') {
      for (const userId of event.userIds)
        server.to(userRoom(userId)).emit(event.name, event.payload);
      return;
    }

    const { senderUserId, message, ...rest } = event.payload as {
      senderUserId: string | null;
      message: Record<string, unknown>;
    };
    for (const userId of event.userIds) {
      server.to(userRoom(userId)).emit(event.name, {
        ...rest,
        message: { ...message, mine: senderUserId !== null && senderUserId === userId },
      });
    }
  }

  private async revalidateAll(): Promise<void> {
    const sockets = this.server?.sockets;
    if (!sockets) return;

    for (const socket of [...sockets.values()]) {
      const state = this.state.get(socket);
      if (!state) continue;
      try {
        await this.accessTokens.verify(state.token);
      } catch {
        this.refuse(socket);
      }
    }
  }

  /** Refused without a reason; the client's response is the same in every case — refresh and reconnect. */
  private refuse(socket: Socket): void {
    this.logger.debug('Messaging socket refused');
    socket.emit('closed', { reason: 'unauthorized' });
    socket.disconnect(true);
  }
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}
