/**
 * Conversations and relay calls, as the web apps see them. ADR-0014.
 *
 * Shared by apps/ops_web, apps/family_web and apps/driver_web: the whole
 * `src/messaging/` folder is one set of files copied into each, like
 * `api/transport.ts`. Change it in one and copy it to the other two.
 *
 * Wire in, domain out, with the rule the codecs in this repo share: an
 * unrecognised value must never make something look *more* than it is. A
 * conversation of a kind this build does not know is dropped (it would be
 * labelled wrongly); a message from an unknown sender role is shown as a
 * system line (dropping it would make the thread lie by omission).
 */
import type { components } from '../api/schema';

type S = components['schemas'];

export type ConversationKind = 'dispatchFamily' | 'dispatchDriver' | 'driverDriver' | 'operatorDrivers';
export type ConversationRole = 'dispatcher' | 'family' | 'driver';
export type SenderRole = ConversationRole | 'system';
export type CallPartyKind = 'patient' | 'familyMember' | 'driver' | 'dispatch';
export type CallStatus =
  | 'initiating'
  | 'ringingCaller'
  | 'ringingCallee'
  | 'inProgress'
  | 'completed'
  | 'noAnswer'
  | 'busy'
  | 'failed'
  | 'canceled';

const KINDS: readonly ConversationKind[] = ['dispatchFamily', 'dispatchDriver', 'driverDriver', 'operatorDrivers'];
const ROLES: readonly ConversationRole[] = ['dispatcher', 'family', 'driver'];
const PARTIES: readonly CallPartyKind[] = ['patient', 'familyMember', 'driver', 'dispatch'];
const STATUSES: readonly CallStatus[] = [
  'initiating',
  'ringingCaller',
  'ringingCallee',
  'inProgress',
  'completed',
  'noAnswer',
  'busy',
  'failed',
  'canceled',
];

export interface Message {
  id: string;
  conversationId: string;
  senderRole: SenderRole;
  senderLabel: string;
  body: string;
  createdAt: Date;
  clientMessageId: string;
  mine: boolean;
}

/** A message as a screen holds it: stored, or still on its way. */
export interface ChatMessage extends Message {
  delivery: 'sent' | 'pending' | 'failed';
}

export interface ConversationRide {
  id: string;
  status: string;
  direction: string;
  scheduledPickupAt: Date;
  patientName: string;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  organizationId: string;
  organizationName: string;
  patientId: string | null;
  driverId: string | null;
  peerDriverId: string | null;
  rideId: string | null;
  title: string;
  myRole: ConversationRole;
  canPost: boolean;
  ride: ConversationRide | null;
  lastMessage: Message | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

export interface Colleague {
  driverId: string;
  displayName: string;
  onShift: boolean;
}

export interface CallTarget {
  kind: CallPartyKind;
  id: string;
  label: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface CallSession {
  id: string;
  status: CallStatus;
  calleeKind: CallPartyKind;
  calleeLabel: string;
  conversationId: string | null;
  rideId: string | null;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
}

export interface IncomingCall {
  callId: string;
  fromLabel: string;
  conversationId: string | null;
  rideId: string | null;
}

/** Where a call is placed from — a thread, or a ride. */
export type CallContext = { conversationId: string } | { rideId: string };

/** Find-or-open. Fields the server can work out may be left out. */
export interface OpenSubject {
  kind: ConversationKind;
  organizationId?: string;
  patientId?: string;
  driverId?: string;
  peerDriverId?: string;
  rideId?: string;
}

// ─── rules the screens use ──────────────────────────────────────────────────

export const MESSAGE_MAX_LENGTH = 2000;

export function isLiveCall(call: CallSession): boolean {
  return !['completed', 'noAnswer', 'busy', 'failed', 'canceled'].includes(call.status);
}

/** What a caller is told while their own phone and then the other one ring. */
export function callStatusLabel(call: CallSession): string {
  switch (call.status) {
    case 'initiating':
    case 'ringingCaller':
      return 'Your phone is ringing — answer it to be connected';
    case 'ringingCallee':
      return `Calling ${call.calleeLabel}…`;
    case 'inProgress':
      return `Connected to ${call.calleeLabel}`;
    case 'completed':
      return `Call ended${call.durationSeconds ? ` · ${Math.max(1, Math.round(call.durationSeconds / 60))} min` : ''}`;
    case 'noAnswer':
      return `${call.calleeLabel} did not answer`;
    case 'busy':
      return `${call.calleeLabel} was busy`;
    case 'failed':
      return 'The call could not be connected';
    case 'canceled':
      return 'Call cancelled';
  }
}

export function kindLabel(kind: ConversationKind): string {
  switch (kind) {
    case 'dispatchFamily':
      return 'Family';
    case 'dispatchDriver':
      return 'Driver';
    case 'driverDriver':
      return 'Driver to driver';
    case 'operatorDrivers':
      return 'Team';
  }
}

export function totalUnread(inbox: readonly Conversation[] | null): number {
  return (inbox ?? []).reduce((sum, c) => sum + c.unreadCount, 0);
}

/** Newest activity first; a thread nobody has written in yet sorts last. */
export function sortInbox(inbox: readonly Conversation[]): Conversation[] {
  return [...inbox].sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}

/**
 * Adds or replaces a message in a thread, keeping it in time order and
 * de-duplicated — by id for stored messages, and by `clientMessageId` so the
 * stored copy of an optimistic send replaces it rather than appearing twice
 * (the socket can deliver it before the POST answers).
 */
export function mergeMessage(thread: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const rest = thread.filter(
    (m) => m.id !== incoming.id && !(m.mine && incoming.mine && m.clientMessageId === incoming.clientMessageId),
  );
  // A stored copy never goes back to pending because a late optimistic update arrived.
  const existing = thread.find((m) => m.clientMessageId === incoming.clientMessageId && m.mine === incoming.mine);
  const next = existing?.delivery === 'sent' && incoming.delivery !== 'sent' ? existing : incoming;
  return [...rest, next].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Days, for separators in a thread. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── codec ──────────────────────────────────────────────────────────────────

const date = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function messageFromWire(json: S['MessageDto']): Message | null {
  const createdAt = date(json.createdAt);
  if (!createdAt) return null;
  const role = json.senderRole as SenderRole;
  return {
    id: json.id,
    conversationId: json.conversationId,
    senderRole: ROLES.includes(role as ConversationRole) ? role : 'system',
    senderLabel: json.senderLabel,
    body: json.body,
    createdAt,
    clientMessageId: json.clientMessageId,
    mine: json.mine === true,
  };
}

export function conversationFromWire(json: S['ConversationDto']): Conversation | null {
  const kind = json.kind as ConversationKind;
  const role = json.myRole as ConversationRole;
  if (!KINDS.includes(kind) || !ROLES.includes(role)) return null;

  const ride = json.ride ? rideFromWire(json.ride) : null;
  return {
    id: json.id,
    kind,
    organizationId: json.organizationId,
    organizationName: json.organizationName,
    patientId: json.patientId ?? null,
    driverId: json.driverId ?? null,
    peerDriverId: json.peerDriverId ?? null,
    rideId: json.rideId ?? null,
    title: json.title,
    myRole: role,
    canPost: json.canPost === true,
    ride,
    lastMessage: json.lastMessage ? messageFromWire(json.lastMessage) : null,
    lastMessageAt: date(json.lastMessageAt),
    unreadCount: Math.max(0, json.unreadCount | 0),
  };
}

function rideFromWire(json: S['ConversationRideDto']): ConversationRide | null {
  const scheduledPickupAt = date(json.scheduledPickupAt);
  if (!scheduledPickupAt) return null;
  return {
    id: json.id,
    status: json.status,
    direction: json.direction,
    scheduledPickupAt,
    patientName: json.patientName,
  };
}

export function callTargetFromWire(json: S['CallTargetDto']): CallTarget | null {
  const kind = json.kind as CallPartyKind;
  if (!PARTIES.includes(kind)) return null;
  return {
    kind,
    id: json.id,
    label: json.label,
    available: json.available === true,
    unavailableReason: json.unavailableReason ?? null,
  };
}

export function callFromWire(json: S['CallSessionDto']): CallSession | null {
  const status = json.status as CallStatus;
  const calleeKind = json.calleeKind as CallPartyKind;
  const startedAt = date(json.startedAt);
  if (!STATUSES.includes(status) || !PARTIES.includes(calleeKind) || !startedAt) return null;
  return {
    id: json.id,
    status,
    calleeKind,
    calleeLabel: json.calleeLabel,
    conversationId: json.conversationId ?? null,
    rideId: json.rideId ?? null,
    startedAt,
    answeredAt: date(json.answeredAt),
    endedAt: date(json.endedAt),
    durationSeconds: json.durationSeconds ?? null,
  };
}

export function incomingFromWire(json: unknown): IncomingCall | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  if (typeof j['callId'] !== 'string' || typeof j['fromLabel'] !== 'string') return null;
  return {
    callId: j['callId'],
    fromLabel: j['fromLabel'],
    conversationId: typeof j['conversationId'] === 'string' ? j['conversationId'] : null,
    rideId: typeof j['rideId'] === 'string' ? j['rideId'] : null,
  };
}

export const notNull = <T,>(value: T | null): value is T => value !== null;
