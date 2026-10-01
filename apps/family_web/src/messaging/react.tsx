/**
 * React access to the messaging store. Shared (see model.ts).
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { ApiTransport } from '../api/transport';
import { Attention } from './attention';
import { BackgroundPush, type AppTarget, type BackgroundPushStatus } from './backgroundPush';
import { MessagingClient } from './client';
import { totalUnread, type CallContext, type CallSession, type Conversation } from './model';
import { MessagingSocket } from './socket';
import { MessagingStore, type MessagingState, type ThreadState } from './store';

/** One store per app, built from the app's one transport. */
export function createMessagingStore(transport: ApiTransport): MessagingStore {
  const client = new MessagingClient(transport);
  const socket = new MessagingSocket(transport.tokens, () => client.touch());
  return new MessagingStore(client, socket, new Attention(), transport.tokens);
}

const MessagingContext = createContext<MessagingStore | null>(null);

/**
 * Starts the store while `active` (signed in) and stops it — clearing
 * everything — when that ends.
 */
export function MessagingProvider(props: {
  store: MessagingStore;
  active: boolean;
  /** Where clicking a notification for a thread goes. */
  openThread: (conversationId: string) => void;
  children: ReactNode;
}) {
  const { store, active, openThread } = props;
  useEffect(() => {
    store.openThread = openThread;
  }, [store, openThread]);
  useEffect(() => {
    if (!active) return;
    store.start();
    return () => {
      store.stop();
      // Signed out: this browser stops being notified for that person.
      void BackgroundPush.forget();
    };
  }, [store, active]);
  return <MessagingContext.Provider value={store}>{props.children}</MessagingContext.Provider>;
}

export function useMessagingStore(): MessagingStore {
  const store = useContext(MessagingContext);
  if (!store) throw new Error('MessagingProvider is missing');
  return store;
}

export function useMessagingState(): MessagingState {
  const store = useMessagingStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useInbox(): { inbox: Conversation[] | null; error: unknown; unread: number } {
  const state = useMessagingState();
  return { inbox: state.inbox, error: state.inboxError, unread: totalUnread(state.inbox) };
}

/** A thread on screen: loads it, keeps it read while visible, and lets go when left. */
export function useThread(conversationId: string | null): ThreadState | null {
  const store = useMessagingStore();
  const state = useMessagingState();
  useEffect(() => {
    if (!conversationId) return;
    store.setActive(conversationId);
    return () => store.setActive(null);
  }, [store, conversationId]);
  return conversationId ? (state.threads[conversationId] ?? store.thread(conversationId)) : null;
}

export function useCallFor(context: CallContext | null): CallSession | null {
  const store = useMessagingStore();
  useMessagingState();
  return context ? store.callFor(context) : null;
}

/**
 * The background-notification switch: its state, and turning it on or off.
 * `status` is null until checked.
 */
export function useBackgroundPush(appTarget: AppTarget) {
  const store = useMessagingStore();
  const [push] = useState(() => new BackgroundPush(store.client.transport, appTarget));
  const [status, setStatus] = useState<BackgroundPushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void push
      .status()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus('unsupported'));
    return () => {
      live = false;
    };
  }, [push]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setStatus(on ? await push.enable() : await push.disable());
    } finally {
      setBusy(false);
    }
  };

  return { status, busy, toggle };
}

/** What to say under the switch, for each state. */
export function backgroundPushNote(status: BackgroundPushStatus | null): string {
  switch (status) {
    case 'unsupported':
      return 'This browser cannot show notifications while CareBridge is closed.';
    case 'unavailable':
      return 'Not set up for CareBridge yet.';
    case 'blocked':
      return 'Notifications are blocked for this site. Allow them in the browser’s site settings.';
    default:
      return 'Says that something arrived — never who sent it or what it says.';
  }
}
