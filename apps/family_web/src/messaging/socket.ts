/**
 * The messaging socket: new messages, read markers and call progress, pushed.
 * Shared (see model.ts). The same rules as the tracking socket:
 *
 *  - **The token goes in the handshake `auth`, never the query string**,
 *    which nginx writes to its access log. It is supplied by a function, so
 *    every reconnect presents the current token rather than the one the page
 *    started with.
 *  - **Nothing is sent up.** The server decides who receives what when
 *    something happens; there is no subscription to ask for.
 *  - **A refusal is not an error screen.** The server re-checks the token
 *    every few seconds and drops a socket whose session ended; the client
 *    lets the HTTP transport refresh, then reconnects. The screens keep
 *    working from HTTP throughout.
 */
import { io, type Socket } from 'socket.io-client';

import type { TokenStore } from '../api/tokens';
import { configuredBaseUrl, resolveBaseUrl } from '../api/transport';
import type { components } from '../api/schema';
import {
  callFromWire,
  incomingFromWire,
  messageFromWire,
  type CallSession,
  type IncomingCall,
  type Message,
} from './model';

type S = components['schemas'];

export type MessagingEvent =
  | { type: 'message'; conversationId: string; rideId: string | null; message: Message }
  | { type: 'read'; conversationId: string }
  | { type: 'call'; call: CallSession }
  | { type: 'incoming'; incoming: IncomingCall }
  | { type: 'connection'; connected: boolean };

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;

export class MessagingSocket {
  private socket: Socket | null = null;
  private listener: ((event: MessagingEvent) => void) | null = null;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly origin: string;

  constructor(
    private readonly tokens: TokenStore,
    /** Refreshes the session over HTTP, so a reconnect has a token worth presenting. */
    private readonly revive: () => Promise<void>,
    baseUrl: string = configuredBaseUrl,
    private readonly connect: typeof io = io,
  ) {
    this.origin = resolveBaseUrl(baseUrl).origin;
  }

  start(listener: (event: MessagingEvent) => void): void {
    this.listener = listener;
    this.open();
  }

  stop(): void {
    this.listener = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.disconnect();
    this.socket = null;
  }

  private open(): void {
    if (this.socket || !this.listener || !this.tokens.read()) return;

    const socket = this.connect(`${this.origin}/messaging`, {
      path: '/api/v1/socket.io',
      transports: ['websocket'],
      auth: (supply: (data: object) => void) =>
        supply({ token: this.tokens.read()?.accessToken ?? '' }),
      forceNew: true,
    });

    socket.on('ready', () => {
      this.retryMs = RETRY_MIN_MS;
      this.emit({ type: 'connection', connected: true });
    });
    socket.on('disconnect', () => this.emit({ type: 'connection', connected: false }));
    socket.on('closed', () => this.refused());
    socket.on('message.created', (data: unknown) => this.onMessage(data));
    socket.on('conversation.read', (data: unknown) => {
      const id = (data as { conversationId?: unknown } | null)?.conversationId;
      if (typeof id === 'string') this.emit({ type: 'read', conversationId: id });
    });
    socket.on('call.updated', (data: unknown) => {
      const json = (data as { call?: S['CallSessionDto'] } | null)?.call;
      const call = json ? callFromWire(json) : null;
      if (call) this.emit({ type: 'call', call });
    });
    socket.on('call.incoming', (data: unknown) => {
      const incoming = incomingFromWire(data);
      if (incoming) this.emit({ type: 'incoming', incoming });
    });

    this.socket = socket;
  }

  /** The server ended the connection — usually an expired token. Refresh, then try again, backing off. */
  private refused(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.emit({ type: 'connection', connected: false });
    if (!this.listener || this.retryTimer) return;

    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.revive()
        .catch(() => undefined)
        .finally(() => this.open());
    }, wait);
  }

  private onMessage(data: unknown): void {
    const payload = data as {
      conversationId?: unknown;
      rideId?: unknown;
      message?: S['MessageDto'];
    } | null;
    const message = payload?.message ? messageFromWire(payload.message) : null;
    if (!message || typeof payload?.conversationId !== 'string') return;
    this.emit({
      type: 'message',
      conversationId: payload.conversationId,
      rideId: typeof payload.rideId === 'string' ? payload.rideId : null,
      message,
    });
  }

  private emit(event: MessagingEvent): void {
    this.listener?.(event);
  }
}
