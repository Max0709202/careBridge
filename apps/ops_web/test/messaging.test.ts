/**
 * The shared messaging rules (src/messaging/model.ts). The same file is
 * copied into family_web and driver_web, and so is this test.
 */
import { describe, expect, it } from 'vitest';

import type { components } from '../src/api/schema';
import {
  callFromWire,
  callStatusLabel,
  conversationFromWire,
  isLiveCall,
  mergeMessage,
  messageFromWire,
  sortInbox,
  totalUnread,
  type CallSession,
  type ChatMessage,
  type Conversation,
} from '../src/messaging/model';

type S = components['schemas'];

const at = (iso: string) => new Date(iso);

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm-1',
  conversationId: 'c-1',
  senderRole: 'dispatcher',
  senderLabel: 'Dana · Dispatch',
  body: 'On our way',
  createdAt: at('2026-10-01T09:00:00Z'),
  clientMessageId: 'client-1',
  mine: true,
  delivery: 'sent',
  ...over,
});

describe('mergeMessage', () => {
  it('replaces an optimistic copy with the stored one, whichever arrives first', () => {
    const pending = message({ id: 'pending:client-1', delivery: 'pending' });
    const stored = message({ id: 'm-1', delivery: 'sent' });

    expect(mergeMessage([pending], stored)).toEqual([stored]);
    // The socket delivered the stored copy before the POST answered; the POST's
    // late "pending" bookkeeping must not undo it.
    expect(mergeMessage([stored], pending)).toEqual([stored]);
  });

  it('keeps time order and drops duplicates', () => {
    const early = message({
      id: 'a',
      clientMessageId: 'a',
      createdAt: at('2026-10-01T08:00:00Z'),
    });
    const late = message({
      id: 'b',
      clientMessageId: 'b',
      createdAt: at('2026-10-01T10:00:00Z'),
    });
    expect(mergeMessage([late], early).map((m) => m.id)).toEqual(['a', 'b']);
    expect(mergeMessage([early, late], early)).toHaveLength(2);
  });

  it("does not confuse my message with someone else's that happens to share a client id", () => {
    const mine = message({ id: 'a', clientMessageId: 'x', mine: true });
    const theirs = message({ id: 'b', clientMessageId: 'x', mine: false });
    expect(mergeMessage([mine], theirs)).toHaveLength(2);
  });
});

describe('the codec', () => {
  const wire: S['ConversationDto'] = {
    id: 'c-1',
    kind: 'dispatchFamily',
    organizationId: 'org-1',
    organizationName: 'Meridian Transit',
    patientId: 'p-1',
    driverId: null,
    peerDriverId: null,
    rideId: 'r-1',
    title: 'Eleanor · family',
    myRole: 'dispatcher',
    canPost: true,
    ride: {
      id: 'r-1',
      status: 'driverEnRoute',
      direction: 'outbound',
      scheduledPickupAt: '2026-10-01T09:30:00Z',
      patientName: 'Eleanor',
    },
    lastMessage: null,
    lastMessageAt: '2026-10-01T09:00:00Z',
    unreadCount: 2,
  };

  it('reads a conversation, ride and all', () => {
    const c = conversationFromWire(wire)!;
    expect(c.ride?.scheduledPickupAt).toEqual(at('2026-10-01T09:30:00Z'));
    expect(c.unreadCount).toBe(2);
  });

  it('drops a conversation of a kind this build does not know, rather than mislabel it', () => {
    expect(conversationFromWire({ ...wire, kind: 'somethingNew' as never })).toBeNull();
  });

  it('shows a message from an unknown sender role as a system line, rather than lose it', () => {
    const m = messageFromWire({
      id: 'm',
      conversationId: 'c',
      senderRole: 'robot' as never,
      senderLabel: 'CareBridge',
      body: 'Hello',
      createdAt: '2026-10-01T09:00:00Z',
      clientMessageId: 'x',
      mine: false,
    });
    expect(m?.senderRole).toBe('system');
  });
});

describe('inbox helpers', () => {
  const convo = (id: string, last: string | null, unread = 0) =>
    ({
      id,
      lastMessageAt: last ? at(last) : null,
      unreadCount: unread,
    }) as Conversation;

  it('sorts by latest activity, empty threads last', () => {
    const sorted = sortInbox([
      convo('a', null),
      convo('b', '2026-10-01T08:00:00Z'),
      convo('c', '2026-10-01T09:00:00Z'),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('totals unread', () => {
    expect(totalUnread([convo('a', null, 2), convo('b', null, 3)])).toBe(5);
    expect(totalUnread(null)).toBe(0);
  });
});

describe('calls', () => {
  const call = (status: string, durationSeconds: number | null = null) =>
    callFromWire({
      id: 'call-1',
      status: status as never,
      calleeKind: 'driver',
      calleeLabel: 'Marcus T.',
      conversationId: null,
      rideId: null,
      startedAt: '2026-10-01T09:00:00Z',
      answeredAt: null,
      endedAt: null,
      durationSeconds,
    }) as CallSession;

  it('tells the caller to answer their own phone first', () => {
    expect(callStatusLabel(call('ringingCaller'))).toMatch(/Your phone is ringing/);
    expect(callStatusLabel(call('ringingCallee'))).toBe('Calling Marcus T.…');
    expect(callStatusLabel(call('completed', 185))).toBe('Call ended · 3 min');
    expect(callStatusLabel(call('noAnswer'))).toBe('Marcus T. did not answer');
  });

  it('knows which calls are still going', () => {
    expect(isLiveCall(call('inProgress'))).toBe(true);
    expect(isLiveCall(call('busy'))).toBe(false);
  });

  it('drops a call in a state it does not know', () => {
    expect(call('teleporting')).toBeNull();
  });
});
