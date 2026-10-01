/**
 * Server-to-client events addressed to people, across instances.
 *
 * The messaging gateway holds sockets on whichever instance a browser happened
 * to connect to; the request that caused an event — a message sent, a call
 * answered — landed on whichever instance the load balancer chose. This port
 * is the bridge: publish on one, every instance's gateway receives it and
 * emits to the sockets it holds for those users.
 *
 * The same two-adapter arrangement as the position store, for the same
 * reason: Redis pub/sub in production, a list of listeners on a laptop — which
 * is correct for one process and wrong for two, and config validation already
 * refuses to run production without Redis.
 *
 * Events carry ids and the minimum a screen needs to update. They are a nudge
 * to refetch or append, never the only copy: the database is the record, and a
 * client that missed an event while reconnecting reloads from it.
 */

export type RealtimeEventName =
  | 'message.created'
  | 'conversation.read'
  | 'call.updated'
  | 'call.incoming';

export interface RealtimeEvent {
  /** Who should receive it. Resolved by the publisher, authorised there. */
  userIds: string[];
  name: RealtimeEventName;
  payload: Record<string, unknown>;
}

export type RealtimeListener = (event: RealtimeEvent) => void;

export interface RealtimeBusPort {
  readonly kind: 'redis' | 'in-process';
  publish(event: RealtimeEvent): Promise<void>;
  subscribe(listener: RealtimeListener): void;
  close(): Promise<void>;
}

export const REALTIME_BUS = Symbol('REALTIME_BUS');
