/**
 * A messaging store for tests: the real store and client over the fake
 * server, with a socket the test drives by hand.
 */
import type { ApiTransport } from '../../src/api/transport';
import { Attention } from '../../src/messaging/attention';
import { MessagingClient } from '../../src/messaging/client';
import type { MessagingEvent } from '../../src/messaging/socket';
import { MessagingStore, type MessagingEvents } from '../../src/messaging/store';

export class FakeMessagingSocket implements MessagingEvents {
  private listener: ((event: MessagingEvent) => void) | null = null;
  started = 0;

  start(listener: (event: MessagingEvent) => void): void {
    this.started += 1;
    this.listener = listener;
  }

  stop(): void {
    this.listener = null;
  }

  push(event: MessagingEvent): void {
    this.listener?.(event);
  }
}

export function fakeMessaging(transport: ApiTransport) {
  const socket = new FakeMessagingSocket();
  const store = new MessagingStore(new MessagingClient(transport), socket, new Attention(), transport.tokens);
  return { store, socket };
}
