/**
 * The messaging and calls endpoints, over the app's one `ApiTransport` — one
 * client per app, because one client owns refresh. Shared (see model.ts).
 */
import type { ApiTransport } from '../api/transport';
import type { components } from '../api/schema';
import {
  callFromWire,
  callTargetFromWire,
  conversationFromWire,
  messageFromWire,
  notNull,
  type CallContext,
  type CallPartyKind,
  type CallSession,
  type CallTarget,
  type Colleague,
  type Conversation,
  type Message,
  type OpenSubject,
} from './model';

type S = components['schemas'];
const seg = encodeURIComponent;

function contextQuery(context: CallContext): string {
  return 'conversationId' in context
    ? `conversationId=${seg(context.conversationId)}`
    : `rideId=${seg(context.rideId)}`;
}

export class MessagingClient {
  constructor(readonly transport: ApiTransport) {}

  async inbox(): Promise<Conversation[]> {
    const list = await this.transport.sendList<S['ConversationDto']>('GET', '/conversations');
    return list.map(conversationFromWire).filter(notNull);
  }

  async open(subject: OpenSubject): Promise<Conversation> {
    const json = await this.transport.send<S['ConversationDto']>('POST', '/conversations', { body: subject });
    const conversation = conversationFromWire(json);
    if (!conversation) throw new Error('Unrecognised conversation');
    return conversation;
  }

  async conversation(id: string): Promise<Conversation | null> {
    return conversationFromWire(await this.transport.send<S['ConversationDto']>('GET', `/conversations/${seg(id)}`));
  }

  async messages(id: string, before?: Date): Promise<{ messages: Message[]; hasMore: boolean }> {
    const query = before ? `?before=${seg(before.toISOString())}` : '';
    const json = await this.transport.send<S['MessagePageDto']>('GET', `/conversations/${seg(id)}/messages${query}`);
    return { messages: (json.messages ?? []).map(messageFromWire).filter(notNull), hasMore: json.hasMore === true };
  }

  /** The client id doubles as the Idempotency-Key, so a retry is the same request. */
  async send(id: string, body: string, clientMessageId: string): Promise<Message> {
    const json = await this.transport.send<S['MessageDto']>('POST', `/conversations/${seg(id)}/messages`, {
      body: { body, clientMessageId },
      idempotencyKey: clientMessageId,
    });
    const message = messageFromWire(json);
    if (!message) throw new Error('Unrecognised message');
    return message;
  }

  async markRead(id: string): Promise<void> {
    await this.transport.send('POST', `/conversations/${seg(id)}/read`);
  }

  async colleagues(organizationId: string): Promise<Colleague[]> {
    return this.transport.sendList<Colleague>('GET', `/organizations/${seg(organizationId)}/colleagues`);
  }

  async callTargets(context: CallContext): Promise<CallTarget[]> {
    const list = await this.transport.sendList<S['CallTargetDto']>('GET', `/calls/targets?${contextQuery(context)}`);
    return list.map(callTargetFromWire).filter(notNull);
  }

  async startCall(context: CallContext, callee: { kind: CallPartyKind; id: string }): Promise<CallSession> {
    const json = await this.transport.send<S['CallSessionDto']>('POST', '/calls', { body: { ...context, callee } });
    const call = callFromWire(json);
    if (!call) throw new Error('Unrecognised call');
    return call;
  }

  async myNumber(): Promise<string | null> {
    return (await this.transport.send<S['MyNumberDto']>('GET', '/calls/my-number')).phone ?? null;
  }

  async setMyNumber(phone: string): Promise<string | null> {
    return (await this.transport.send<S['MyNumberDto']>('PUT', '/calls/my-number', { body: { phone } })).phone ?? null;
  }

  /**
   * Any authenticated request, to let the transport refresh an expired access
   * token before the socket reconnects with it.
   */
  async touch(): Promise<void> {
    await this.transport.send('GET', '/conversations/unread');
  }
}
