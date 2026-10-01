import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AppTarget, type Conversation } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  REALTIME_BUS,
  type RealtimeBusPort,
} from '../../infrastructure/realtime/realtime-bus.port';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';
import {
  canPost,
  canStart,
  conversationSubjectKey,
  isRideThreadClosed,
  orderedPair,
  roleIn,
  type ActorFacts,
  type ConversationRole,
  type ConversationSubject,
  type RideFacts,
} from '../../domain/conversation-access';
import { ConversationAuthorizer, toSubject } from './conversation.authorizer';
import type {
  ColleagueDto,
  ConversationDto,
  MessageDto,
  MessagePageDto,
  UnreadSummaryDto,
} from './messaging.dto';
import type {
  MessagePageQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dto/messaging.request.dto';

const CONVERSATION_INCLUDE = {
  organization: { select: { name: true } },
  patient: { select: { preferredName: true } },
  driver: { select: { displayName: true } },
  peerDriver: { select: { displayName: true } },
  ride: {
    select: {
      id: true,
      status: true,
      direction: true,
      scheduledPickupAt: true,
      patient: { select: { preferredName: true } },
    },
  },
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;
type MessageRow = Prisma.MessageGetPayload<object>;

/** How many threads the inbox returns. Older ones are still reachable from their ride. */
const INBOX_LIMIT = 100;
const PAGE_DEFAULT = 50;

/** A person in a thread, and everything that follows from it. */
export interface ConversationAccess {
  conversation: Conversation;
  actor: ActorFacts;
  role: ConversationRole;
  ride: RideFacts | null;
}

const APP_FOR_ROLE: Record<ConversationRole, AppTarget> = {
  dispatcher: 'ops',
  family: 'family',
  driver: 'driver',
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  son: 'son',
  daughter: 'daughter',
  spouse: 'spouse',
  sibling: 'sibling',
  grandchild: 'grandchild',
  friend: 'friend',
  professionalCaregiver: 'caregiver',
  other: 'family',
};

/**
 * Threads between dispatch, families and drivers. ADR-0014.
 *
 * Writes go over HTTP and the socket only carries them out, as with tracking:
 * a send needs an answer ("stored" or "refused"), the idempotency and audit
 * plumbing is on the request pipeline, and a phone in a dead zone can post the
 * moment one request gets through, long before a WebSocket reconnects.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizer: ConversationAuthorizer,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBusPort,
  ) {}

  // ─── reading ──────────────────────────────────────────────────────────────

  /**
   * Every thread the caller is in that has something in it, newest first.
   *
   * The query is a superset built from the caller's edges; each row is then
   * re-checked with `roleIn`, which is where the ride rule ("only while the
   * ride is yours") is applied. Filtering twice is deliberate — the query is
   * for speed, the rule is for correctness, and only the rule is tested
   * exhaustively.
   */
  async inbox(userId: string): Promise<ConversationDto[]> {
    const actor = await this.authorizer.actor(userId);
    const reachable = reachableWhere(actor);
    if (reachable.length === 0) return [];

    const rows = await this.prisma.conversation.findMany({
      where: { lastMessageAt: { not: null }, OR: reachable },
      include: CONVERSATION_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
      take: INBOX_LIMIT,
    });

    const rides = await this.authorizer.rides(
      rows.map((r) => r.rideId).filter((id): id is string => id !== null),
    );

    const visible = rows.flatMap((row) => {
      const ride = row.rideId ? (rides.get(row.rideId) ?? null) : null;
      const role = roleIn(actor, toSubject(row), ride);
      return role ? [{ row, role, ride }] : [];
    });

    const unread = await this.unreadCounts(
      userId,
      visible.map((v) => v.row.id),
    );
    const now = new Date();

    return visible.map(({ row, role, ride }) =>
      toConversationDto(row, {
        viewerId: userId,
        role,
        canPost: canPost(role, toSubject(row), ride, now),
        unreadCount: unread.get(row.id) ?? 0,
      }),
    );
  }

  async unreadSummary(userId: string): Promise<UnreadSummaryDto> {
    const inbox = await this.inbox(userId);
    return {
      unreadConversations: inbox.filter((c) => c.unreadCount > 0).length,
      unreadMessages: inbox.reduce((sum, c) => sum + c.unreadCount, 0),
    };
  }

  async conversation(userId: string, conversationId: string): Promise<ConversationDto> {
    const access = await this.requireAccess(userId, conversationId);
    return this.describe(access);
  }

  async messages(
    userId: string,
    conversationId: string,
    query: MessagePageQueryDto,
  ): Promise<MessagePageDto> {
    await this.requireAccess(userId, conversationId);

    const limit = query.limit ?? PAGE_DEFAULT;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map((m) => toMessageDto(m, userId)), hasMore };
  }

  /**
   * Drivers the caller may message, on shift first. The caller must be a
   * dispatcher at the operator or one of its working drivers.
   */
  async colleagues(userId: string, organizationId: string): Promise<ColleagueDto[]> {
    const actor = await this.authorizer.actor(userId);
    const isDispatch = actor.dispatchesFor.has(organizationId);
    const isColleague =
      actor.driver?.organizationId === organizationId &&
      actor.driver.status === 'approved';
    if (!isDispatch && !isColleague) throw new NotFoundError();

    const drivers = await this.prisma.driver.findMany({
      where: {
        organizationId,
        status: 'approved',
        userId: { not: null },
        ...(actor.driver ? { id: { not: actor.driver.id } } : {}),
      },
      select: { id: true, displayName: true, onShift: true },
      orderBy: [{ onShift: 'desc' }, { displayName: 'asc' }],
    });

    return drivers.map((d) => ({
      driverId: d.id,
      displayName: d.displayName,
      onShift: d.onShift,
    }));
  }

  // ─── opening ──────────────────────────────────────────────────────────────

  /**
   * Find or create. The subject key is unique, so two people opening the same
   * thread at once get the same row, and opening an existing thread is how a
   * client finds it — there is no separate lookup to keep consistent.
   */
  async open(userId: string, input: OpenConversationDto): Promise<ConversationDto> {
    const actor = await this.authorizer.actor(userId);
    const ride = input.rideId ? await this.authorizer.ride(input.rideId) : null;
    if (input.rideId && !ride) throw new NotFoundError();

    const subject = completeSubject(input, actor, ride);

    const [operatorsServingPatient, subjectDriver, peerDriver] = await Promise.all([
      subject.kind === 'dispatchFamily' && subject.patientId
        ? this.authorizer.operatorsServingPatient(subject.patientId)
        : Promise.resolve(new Set<string>()),
      subject.driverId
        ? this.authorizer.driver(subject.driverId)
        : Promise.resolve(null),
      subject.peerDriverId
        ? this.authorizer.driver(subject.peerDriverId)
        : Promise.resolve(null),
    ]);

    const decision = canStart(
      actor,
      subject,
      ride,
      { operatorsServingPatient, subjectDriver, peerDriver },
      new Date(),
    );

    if (!decision.ok) {
      switch (decision.reason) {
        case 'notFound':
          throw new NotFoundError();
        case 'peerOffShift':
          throw new ConflictError(
            'That driver is off shift. You can start a conversation when they are next working.',
          );
        case 'rideClosed':
          throw new ConflictError(
            'This trip has finished, so its conversation is closed. You can still message dispatch from Messages.',
          );
      }
    }

    const subjectKey = conversationSubjectKey(subject);
    const conversation = await this.prisma.conversation.upsert({
      where: { subjectKey },
      create: { ...subject, subjectKey },
      update: {},
    });

    return this.describe({ conversation, actor, role: decision.role, ride });
  }

  // ─── writing ──────────────────────────────────────────────────────────────

  /**
   * Stores a message, bumps the thread, and tells the other members.
   *
   * The notification rows are written in the same transaction as the message
   * — the outbox sweep delivers push from them afterwards, exactly as for ride
   * notifications, so there is no second delivery path. They are **merged per
   * conversation**: someone who already has an unread "new message" for this
   * thread is not given another, so a busy thread is one notification.
   */
  async send(
    userId: string,
    conversationId: string,
    input: SendMessageDto,
  ): Promise<MessageDto> {
    const body = input.body.trim();
    if (body.length === 0)
      throw new ValidationError('A message cannot be empty.', 'body');

    const existing = await this.prisma.message.findUnique({
      where: {
        senderUserId_clientMessageId: {
          senderUserId: userId,
          clientMessageId: input.clientMessageId,
        },
      },
    });
    if (existing) return this.replay(existing, conversationId, userId);

    const access = await this.requireAccess(userId, conversationId);
    this.requirePostable(access);

    const [senderLabel, members] = await Promise.all([
      this.senderLabel(userId, access),
      this.authorizer.members(access.conversation, access.ride),
    ]);

    const recipients = [...members].filter(([id]) => id !== userId);

    let message: MessageRow;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            conversationId,
            senderUserId: userId,
            senderRole: access.role,
            senderLabel,
            body,
            clientMessageId: input.clientMessageId,
          },
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: created.createdAt },
        });

        // Writing is reading: the sender has seen everything up to their own message.
        await tx.conversationReadState.upsert({
          where: { conversationId_userId: { conversationId, userId } },
          create: { conversationId, userId, lastReadAt: created.createdAt },
          update: { lastReadAt: created.createdAt },
        });

        await this.notifyRecipients(tx, access, recipients, access.role);
        return created;
      });
    } catch (error) {
      // Two retries of the same message racing: the loser finds the winner's row.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.message.findUnique({
          where: {
            senderUserId_clientMessageId: {
              senderUserId: userId,
              clientMessageId: input.clientMessageId,
            },
          },
        });
        if (winner) return this.replay(winner, conversationId, userId);
      }
      throw error;
    }

    await this.publishMessage(access.conversation, message, [...members.keys()]);
    return toMessageDto(message, userId);
  }

  /** Moves the caller's read marker to now, and clears the thread's message notifications. */
  async markRead(userId: string, conversationId: string): Promise<void> {
    await this.requireAccess(userId, conversationId);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.conversationReadState.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId, lastReadAt: now },
        update: { lastReadAt: now },
      }),
      this.prisma.notification.updateMany({
        where: { conversationId, userId, readAt: null },
        data: { readAt: now },
      }),
    ]);

    // To the reader's own other tabs and devices, so a badge clears everywhere.
    await this.bus.publish({
      userIds: [userId],
      name: 'conversation.read',
      payload: { conversationId, lastReadAt: now.toISOString() },
    });
  }

  /**
   * A line written by the server — "Missed call", "Call · 3 min". No sender,
   * no notification of its own (the call module raises `callMissed` itself),
   * and posted even into a closed thread, because it records what happened.
   */
  async postSystemLine(conversationId: string, body: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return;

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderUserId: null,
          senderRole: 'system',
          senderLabel: 'CareBridge',
          body,
          clientMessageId: randomUUID(),
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });

    const ride = conversation.rideId
      ? await this.authorizer.ride(conversation.rideId)
      : null;
    const members = await this.authorizer.members(conversation, ride);
    await this.publishMessage(conversation, message, [...members.keys()]);
  }

  // ─── access ───────────────────────────────────────────────────────────────

  /**
   * The caller's standing in a thread, or 404. Not-found and not-permitted are
   * one answer, as everywhere else: a conversation id must not be a way to
   * learn that a conversation exists.
   */
  async requireAccess(
    userId: string,
    conversationId: string,
  ): Promise<ConversationAccess> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundError();

    const actor = await this.authorizer.actor(userId);
    const { role, ride } = await this.authorizer.roleFor(actor, conversation);
    if (!role) throw new AuthorizationError();

    return { conversation, actor, role, ride };
  }

  private requirePostable(access: ConversationAccess): void {
    if (canPost(access.role, toSubject(access.conversation), access.ride, new Date()))
      return;

    if (access.role !== 'dispatcher' && isRideThreadClosed(access.ride, new Date())) {
      throw new ConflictError(
        'This trip has finished, so its conversation is closed. You can still message dispatch from Messages.',
      );
    }
    // Dispatch in a driver-to-driver thread: readable, not writable.
    throw new AuthorizationError();
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async describe(access: ConversationAccess): Promise<ConversationDto> {
    const row = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: access.conversation.id },
      include: CONVERSATION_INCLUDE,
    });
    const unread = await this.unreadCounts(access.actor.userId, [row.id]);

    return toConversationDto(row, {
      viewerId: access.actor.userId,
      role: access.role,
      canPost: canPost(access.role, toSubject(row), access.ride, new Date()),
      unreadCount: unread.get(row.id) ?? 0,
    });
  }

  private replay(
    existing: MessageRow,
    conversationId: string,
    userId: string,
  ): MessageDto {
    // The same client id on a different thread is two intentions sharing a key.
    if (existing.conversationId !== conversationId) {
      throw new ConflictError('That message id has already been used.');
    }
    return toMessageDto(existing, userId);
  }

  /**
   * Messages after the reader's marker that they did not write, per thread.
   * One query for the whole inbox rather than one per row.
   */
  private async unreadCounts(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; unread: number }>
    >`
      SELECT m."conversationId", COUNT(*)::int AS unread
      FROM "messages" m
      LEFT JOIN "conversation_read_states" r
        ON r."conversationId" = m."conversationId" AND r."userId" = ${userId}
      WHERE m."conversationId" IN (${Prisma.join(conversationIds)})
        AND m."senderUserId" IS DISTINCT FROM ${userId}
        AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
      GROUP BY m."conversationId"
    `;
    return new Map(rows.map((r) => [r.conversationId, r.unread]));
  }

  /**
   * How the sender is shown, frozen at send time. First names for people, the
   * display name a driver already goes by for drivers — never a full name, and
   * never anything a stranger could look up.
   */
  private async senderLabel(
    userId: string,
    access: ConversationAccess,
  ): Promise<string> {
    switch (access.role) {
      case 'dispatcher': {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { fullName: true },
        });
        return `${firstName(user?.fullName)} · Dispatch`;
      }
      case 'driver': {
        const driver = await this.prisma.driver.findUnique({
          where: { userId },
          select: { displayName: true },
        });
        return driver?.displayName ?? 'Driver';
      }
      case 'family': {
        const [user, grant] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { fullName: true },
          }),
          access.conversation.patientId
            ? this.prisma.patientAccess.findUnique({
                where: {
                  userId_patientId: {
                    userId,
                    patientId: access.conversation.patientId,
                  },
                },
                select: { relationship: true },
              })
            : null,
        ]);
        const relation = grant ? RELATIONSHIP_LABEL[grant.relationship] : null;
        return relation
          ? `${firstName(user?.fullName)} (${relation})`
          : firstName(user?.fullName);
      }
    }
  }

  /**
   * One "new message" per recipient per thread until they read it. Content-free
   * by policy (FOUNDATION §9): who kind of sent it, never what they said, never
   * a name. Routed by role, so a dispatcher's alert reaches the console and a
   * family's reaches the family app.
   */
  private async notifyRecipients(
    tx: Prisma.TransactionClient,
    access: ConversationAccess,
    recipients: Array<[string, ConversationRole]>,
    senderRole: ConversationRole,
  ): Promise<void> {
    if (recipients.length === 0) return;
    const conversationId = access.conversation.id;

    const alreadyNotified = await tx.notification.findMany({
      where: {
        conversationId,
        kind: 'messageReceived',
        readAt: null,
        userId: { in: recipients.map(([id]) => id) },
      },
      select: { userId: true },
    });
    const skip = new Set(alreadyNotified.map((n) => n.userId));

    const data = recipients
      .filter(([id]) => !skip.has(id))
      .map(([recipientId, recipientRole]) => ({
        userId: recipientId,
        kind: 'messageReceived' as const,
        title: 'New message',
        body: `${whoSent(senderRole, recipientRole)} sent you a message. Open CareBridge to read it.`,
        rideId: access.conversation.rideId,
        conversationId,
        appTarget: APP_FOR_ROLE[recipientRole],
      }));

    if (data.length > 0) await tx.notification.createMany({ data });
  }

  private async publishMessage(
    conversation: Conversation,
    message: MessageRow,
    userIds: string[],
  ): Promise<void> {
    await this.bus.publish({
      userIds,
      name: 'message.created',
      payload: {
        conversationId: conversation.id,
        rideId: conversation.rideId,
        // The gateway turns this into `mine` per socket and drops it.
        senderUserId: message.senderUserId,
        message: toMessageDto(message, null),
      },
    });
  }
}

// ─── pure helpers ──────────────────────────────────────────────────────────

/** The superset of threads an actor could be in, as a Prisma filter. */
function reachableWhere(actor: ActorFacts): Prisma.ConversationWhereInput[] {
  const or: Prisma.ConversationWhereInput[] = [];

  if (actor.dispatchesFor.size > 0) {
    or.push({ organizationId: { in: [...actor.dispatchesFor] } });
  }
  if (actor.familyOf.size > 0) {
    or.push({ kind: 'dispatchFamily', patientId: { in: [...actor.familyOf] } });
  }
  const driver = actor.driver;
  if (driver && driver.status === 'approved') {
    const organizationId = driver.organizationId;
    or.push({ kind: 'dispatchDriver', organizationId, driverId: driver.id });
    or.push({
      kind: 'driverDriver',
      organizationId,
      OR: [{ driverId: driver.id }, { peerDriverId: driver.id }],
    });
    or.push({ kind: 'operatorDrivers', organizationId });
  }
  return or;
}

/**
 * Fills in what the server can work out, then puts the subject in its one
 * canonical shape. Nothing here grants anything — `canStart` checks the result.
 */
function completeSubject(
  input: OpenConversationDto,
  actor: ActorFacts,
  ride: RideFacts | null,
): ConversationSubject {
  const ownDriver = actor.driver;
  const organizationId =
    input.organizationId ??
    ride?.operatorId ??
    (input.kind !== 'dispatchFamily' ? ownDriver?.organizationId : undefined);

  if (!organizationId) {
    throw new ValidationError(
      'Say which operator this conversation is with.',
      'organizationId',
    );
  }

  const base = {
    kind: input.kind,
    organizationId,
    patientId: null,
    driverId: null,
    peerDriverId: null,
    rideId: input.rideId ?? null,
  } satisfies ConversationSubject;

  switch (input.kind) {
    case 'dispatchFamily':
      return { ...base, patientId: input.patientId ?? ride?.patientId ?? null };

    case 'dispatchDriver': {
      const isDispatch = actor.dispatchesFor.has(organizationId);
      const driverId =
        input.driverId ?? (isDispatch ? ride?.driverId : ownDriver?.id) ?? null;
      return { ...base, driverId };
    }

    case 'driverDriver': {
      const self = input.driverId ?? ownDriver?.id;
      const peer = input.peerDriverId;
      if (!self || !peer)
        return { ...base, driverId: self ?? null, peerDriverId: peer ?? null };
      const [driverId, peerDriverId] = orderedPair(self, peer);
      return { ...base, driverId, peerDriverId };
    }

    case 'operatorDrivers':
      return base;
  }
}

function toConversationDto(
  row: ConversationRow,
  view: {
    viewerId: string;
    role: ConversationRole;
    canPost: boolean;
    unreadCount: number;
  },
): ConversationDto {
  const last = row.messages[0] ?? null;
  return {
    id: row.id,
    kind: row.kind,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    patientId: row.patientId,
    driverId: row.driverId,
    peerDriverId: row.peerDriverId,
    rideId: row.rideId,
    title: titleFor(row, view.role),
    myRole: view.role,
    canPost: view.canPost,
    ride: row.ride
      ? {
          id: row.ride.id,
          status: row.ride.status,
          direction: row.ride.direction,
          scheduledPickupAt: row.ride.scheduledPickupAt.toISOString(),
          patientName: row.ride.patient.preferredName,
        }
      : null,
    lastMessage: last ? toMessageDto(last, view.viewerId) : null,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unreadCount: view.unreadCount,
  };
}

/** The other side, as the viewer thinks of it. */
function titleFor(row: ConversationRow, role: ConversationRole): string {
  const operator = row.organization.name;
  switch (row.kind) {
    case 'dispatchFamily':
      return role === 'dispatcher'
        ? `${row.patient?.preferredName ?? 'Patient'} · family`
        : `${operator} dispatch`;
    case 'dispatchDriver':
      return role === 'dispatcher'
        ? (row.driver?.displayName ?? 'Driver')
        : `${operator} dispatch`;
    case 'driverDriver': {
      const a = row.driver?.displayName ?? 'Driver';
      const b = row.peerDriver?.displayName ?? 'Driver';
      return role === 'dispatcher' ? `${a} & ${b}` : `${a} · ${b}`;
    }
    case 'operatorDrivers':
      return `${operator} team`;
  }
}

export function toMessageDto(message: MessageRow, viewerId: string | null): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderRole: message.senderRole,
    senderLabel: message.senderLabel,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    clientMessageId: message.clientMessageId,
    mine: viewerId !== null && message.senderUserId === viewerId,
  };
}

function whoSent(sender: ConversationRole, recipient: ConversationRole): string {
  switch (sender) {
    case 'dispatcher':
      return 'Dispatch';
    case 'family':
      return 'A family member';
    case 'driver':
      return recipient === 'driver' ? 'A colleague' : 'A driver';
  }
}

function firstName(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Someone';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}
