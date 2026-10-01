/**
 * Conversations and calls, held for the screens. Shared (see model.ts).
 *
 * HTTP is the record and the socket is a nudge. Everything here can be
 * rebuilt from HTTP at any moment — on start, when the tab comes back, on a
 * slow poll — so a socket that dropped while the laptop was asleep costs a
 * few seconds of staleness, never a message.
 *
 * Sending is optimistic: a message appears at once as "sending", keeps its
 * client id through every retry (which is also the Idempotency-Key), and is
 * replaced by the stored copy when either the POST or the socket answers —
 * whichever is first.
 */
import { newId } from '../api/ids';
import type { TokenStore } from '../api/tokens';
import type { Attention } from './attention';
import type { MessagingClient } from './client';
import {
  isLiveCall,
  mergeMessage,
  sortInbox,
  totalUnread,
  type CallContext,
  type CallPartyKind,
  type CallSession,
  type ChatMessage,
  type Conversation,
  type IncomingCall,
  type Message,
  type OpenSubject,
} from './model';
import type { MessagingEvent } from './socket';

/** What the store needs from the socket — narrowed so a test can drive it by hand. */
export interface MessagingEvents {
  start(listener: (event: MessagingEvent) => void): void;
  stop(): void;
}

export interface ThreadState {
  messages: ChatMessage[];
  hasMore: boolean;
  loading: boolean;
  error: unknown;
}

export interface MessagingState {
  inbox: Conversation[] | null;
  inboxError: unknown;
  threads: Readonly<Record<string, ThreadState>>;
  /** Calls this person placed or is receiving, by id. */
  calls: Readonly<Record<string, CallSession>>;
  incoming: IncomingCall | null;
  connected: boolean;
}

/** A slow safety net under the socket. */
const INBOX_POLL_MS = 60_000;

const EMPTY_THREAD: ThreadState = Object.freeze({ messages: [], hasMore: false, loading: false, error: null });

export class MessagingStore {
  private state: MessagingState = {
    inbox: null,
    inboxError: null,
    threads: {},
    calls: {},
    incoming: null,
    connected: false,
  };
  private readonly listeners = new Set<() => void>();
  private active: string | null = null;
  private started = false;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly client: MessagingClient,
    private readonly socket: MessagingEvents,
    readonly attention: Attention,
    private readonly tokens: TokenStore,
  ) {}

  /**
   * How to take the person to a thread when they click a notification. Set by
   * the app once its router exists, which is after this store is built.
   */
  openThread: (conversationId: string) => void = () => undefined;

  getState = (): MessagingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  thread(conversationId: string): ThreadState {
    return this.state.threads[conversationId] ?? EMPTY_THREAD;
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  /** Idempotent. Called once a session exists. */
  start(): void {
    if (this.started || !this.tokens.read()) return;
    this.started = true;
    this.socket.start((event) => this.onEvent(event));
    void this.loadInbox();
    this.poll = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.loadInbox();
    }, INBOX_POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** On sign-out: the next person at this screen sees nothing of this one's. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.socket.stop();
    if (this.poll) clearInterval(this.poll);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.active = null;
    this.set({ inbox: null, inboxError: null, threads: {}, calls: {}, incoming: null, connected: false });
  }

  private onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    void this.loadInbox();
    if (this.active) void this.markRead(this.active);
  };

  // ─── inbox ────────────────────────────────────────────────────────────────

  async loadInbox(): Promise<void> {
    try {
      const inbox = await this.client.inbox();
      // A thread opened but not yet written in is not in the server's inbox;
      // keep it so the screen showing it does not lose its header.
      const kept = (this.state.inbox ?? []).filter((c) => c.lastMessageAt === null && !inbox.some((i) => i.id === c.id));
      this.set({ inbox: sortInbox([...inbox, ...kept]), inboxError: null });
    } catch (error) {
      this.set({ inboxError: error });
    }
  }

  /** Find or open a thread, and make sure it is in the list. */
  async open(subject: OpenSubject): Promise<Conversation> {
    const conversation = await this.client.open(subject);
    this.upsert(conversation);
    return conversation;
  }

  conversation(id: string): Conversation | null {
    return this.state.inbox?.find((c) => c.id === id) ?? null;
  }

  /** Loads a thread the inbox does not have — opened from a link or a notification. */
  async ensureConversation(id: string): Promise<Conversation | null> {
    const known = this.conversation(id);
    if (known) return known;
    const loaded = await this.client.conversation(id);
    if (loaded) this.upsert(loaded);
    return loaded;
  }

  // ─── a thread ─────────────────────────────────────────────────────────────

  /** The thread on screen. New messages in it are marked read while the tab is visible. */
  setActive(conversationId: string | null): void {
    this.active = conversationId;
    if (conversationId) {
      void this.loadThread(conversationId);
      void this.markRead(conversationId);
    }
  }

  async loadThread(conversationId: string): Promise<void> {
    this.patchThread(conversationId, { loading: true });
    try {
      const page = await this.client.messages(conversationId);
      const pending = this.thread(conversationId).messages.filter((m) => m.delivery !== 'sent');
      let messages: ChatMessage[] = page.messages.map((m) => ({ ...m, delivery: 'sent' }));
      for (const p of pending) messages = mergeMessage(messages, p);
      this.patchThread(conversationId, { messages, hasMore: page.hasMore, loading: false, error: null });
    } catch (error) {
      this.patchThread(conversationId, { loading: false, error });
    }
  }

  async loadOlder(conversationId: string): Promise<void> {
    const current = this.thread(conversationId);
    const oldest = current.messages.find((m) => m.delivery === 'sent');
    if (!oldest || !current.hasMore || current.loading) return;
    this.patchThread(conversationId, { loading: true });
    try {
      const page = await this.client.messages(conversationId, oldest.createdAt);
      let messages = this.thread(conversationId).messages;
      for (const m of page.messages) messages = mergeMessage(messages, { ...m, delivery: 'sent' });
      this.patchThread(conversationId, { messages, hasMore: page.hasMore, loading: false });
    } catch (error) {
      this.patchThread(conversationId, { loading: false, error });
    }
  }

  async send(conversationId: string, text: string): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;
    const clientMessageId = newId();
    const optimistic: ChatMessage = {
      id: `pending:${clientMessageId}`,
      conversationId,
      senderRole: this.conversation(conversationId)?.myRole ?? 'family',
      senderLabel: 'You',
      body,
      createdAt: new Date(),
      clientMessageId,
      mine: true,
      delivery: 'pending',
    };
    this.addMessage(conversationId, optimistic);
    await this.deliver(conversationId, optimistic);
  }

  /** Same client id, so the server returns the stored message if the first attempt did land. */
  async retry(conversationId: string, clientMessageId: string): Promise<void> {
    const failed = this.thread(conversationId).messages.find(
      (m) => m.clientMessageId === clientMessageId && m.delivery === 'failed',
    );
    if (!failed) return;
    const pending = { ...failed, delivery: 'pending' as const };
    this.addMessage(conversationId, pending);
    await this.deliver(conversationId, pending);
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.conversation(conversationId);
    if (conversation && conversation.unreadCount === 0) return;
    this.setUnread(conversationId, 0);
    try {
      await this.client.markRead(conversationId);
    } catch {
      // The next inbox load puts the true count back.
    }
  }

  // ─── calls ────────────────────────────────────────────────────────────────

  async call(context: CallContext, callee: { kind: CallPartyKind; id: string }): Promise<CallSession> {
    const call = await this.client.startCall(context, callee);
    this.set({ calls: { ...this.state.calls, [call.id]: call } });
    return call;
  }

  /** The most recent call placed from a thread or ride, for its call bar. */
  callFor(context: CallContext): CallSession | null {
    const matches = Object.values(this.state.calls).filter((c) =>
      'conversationId' in context ? c.conversationId === context.conversationId : c.rideId === context.rideId,
    );
    return matches.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
  }

  liveCalls(): CallSession[] {
    return Object.values(this.state.calls).filter(isLiveCall);
  }

  dismissIncoming(): void {
    this.set({ incoming: null });
  }

  // ─── the socket ───────────────────────────────────────────────────────────

  private onEvent(event: MessagingEvent): void {
    switch (event.type) {
      case 'connection':
        this.set({ connected: event.connected });
        // Coming back from a drop: whatever was missed is on the server.
        if (event.connected) {
          void this.loadInbox();
          if (this.active) void this.loadThread(this.active);
        }
        return;

      case 'message':
        this.receive(event.conversationId, event.message);
        return;

      case 'read':
        this.setUnread(event.conversationId, 0);
        return;

      case 'call':
        this.set({ calls: { ...this.state.calls, [event.call.id]: event.call } });
        if (this.state.incoming?.callId === event.call.id && !isLiveCall(event.call)) this.dismissIncoming();
        return;

      case 'incoming':
        this.set({ incoming: event.incoming });
        this.attention.alert({
          title: 'CareBridge',
          body: 'Your phone is ringing — a CareBridge call.',
          tag: `call:${event.incoming.callId}`,
          urgent: true,
        });
        return;
    }
  }

  private receive(conversationId: string, message: Message): void {
    this.addMessage(conversationId, { ...message, delivery: 'sent' });

    const conversation = this.conversation(conversationId);
    if (!conversation) {
      // A thread this screen has not seen yet: somebody started it just now.
      void this.loadInbox();
    } else {
      const watching = this.active === conversationId && document.visibilityState === 'visible';
      this.upsert({
        ...conversation,
        lastMessage: message,
        lastMessageAt: message.createdAt,
        unreadCount: message.mine || watching ? conversation.unreadCount : conversation.unreadCount + 1,
      });
    }

    if (message.mine) return;
    if (this.active === conversationId && document.visibilityState === 'visible') {
      void this.markRead(conversationId);
      return;
    }
    this.attention.alert({
      title: 'New message',
      body: 'Open CareBridge to read it.',
      tag: `conversation:${conversationId}`,
      onOpen: () => this.openThread(conversationId),
    });
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async deliver(conversationId: string, pending: ChatMessage): Promise<void> {
    try {
      const stored = await this.client.send(conversationId, pending.body, pending.clientMessageId);
      this.receive(conversationId, stored);
    } catch {
      this.addMessage(conversationId, { ...pending, delivery: 'failed' });
    }
  }

  private addMessage(conversationId: string, message: ChatMessage): void {
    const thread = this.thread(conversationId);
    this.patchThread(conversationId, { messages: mergeMessage(thread.messages, message) });
  }

  private patchThread(conversationId: string, patch: Partial<ThreadState>): void {
    this.set({
      threads: { ...this.state.threads, [conversationId]: { ...this.thread(conversationId), ...patch } },
    });
  }

  private setUnread(conversationId: string, unreadCount: number): void {
    const conversation = this.conversation(conversationId);
    if (conversation) this.upsert({ ...conversation, unreadCount });
  }

  private upsert(conversation: Conversation): void {
    const others = (this.state.inbox ?? []).filter((c) => c.id !== conversation.id);
    this.set({ inbox: sortInbox([conversation, ...others]) });
  }

  private set(patch: Partial<MessagingState>): void {
    this.state = { ...this.state, ...patch };
    if ('inbox' in patch) this.attention.setUnread(totalUnread(this.state.inbox));
    for (const listener of this.listeners) listener();
  }
}
