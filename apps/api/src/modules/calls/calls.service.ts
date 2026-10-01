import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AppTarget, CallPartyKind, CallSession, CallStatus } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  TELEPHONY,
  type CallStatusUpdate,
  type TelephonyPort,
} from '../../infrastructure/telephony/telephony.port';
import {
  REALTIME_BUS,
  type RealtimeBusPort,
} from '../../infrastructure/realtime/realtime-bus.port';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { AccessQueries } from '../../common/access.queries';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import {
  canCall,
  type ActorFacts,
  type CallPartyKindName,
  type ConversationRole,
  type RideFacts,
} from '../../domain/conversation-access';
import { normalizeE164 } from '../../domain/phone';
import {
  callSummaryLine,
  canAdvanceCall,
  isMissedByCallee,
  isTerminalCallStatus,
} from '../../domain/relay-calls';
import { ConversationAuthorizer } from '../messaging/conversation.authorizer';
import { MessagingService } from '../messaging/messaging.service';
import type {
  CallContextQueryDto,
  CallSessionDto,
  CallTargetDto,
  MyNumberDto,
  StartCallDto,
} from './calls.dto';

/** Where a call is being placed from, and in what capacity. */
interface CallContext {
  actor: ActorFacts;
  role: ConversationRole;
  organizationId: string;
  conversationId: string | null;
  ride: RideFacts | null;
  patientId: string | null;
  /** Drivers this context is about — the thread's, or the ride's. */
  driverIds: string[];
}

/** Someone callable from a context, before availability is worked out. */
interface Candidate {
  kind: CallPartyKindName;
  id: string;
  label: string;
}

/** How far back a callback to the relay number is matched to a call. */
const CALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const CALLBACK_CANDIDATES = 50;

const RELATIONSHIP_LABEL: Record<string, string> = {
  professionalCaregiver: 'caregiver',
  other: 'family',
};

/**
 * Relay calls. ADR-0014.
 *
 * Who may call whom is `canCall` in the domain; this service works out the
 * context (a thread or a ride), resolves numbers at dial time, and turns the
 * provider's callbacks into a call record, a line in the thread, and — when
 * the callee's phone rang and nobody answered — a missed-call notification.
 *
 * **No number is stored.** `CallSession` names the callee by id; the number is
 * looked up when the provider asks for it, so the call log is not a directory
 * and a number changed in the meantime is the one dialled.
 */
@Injectable()
export class CallsService implements OnModuleInit {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly authorizer: ConversationAuthorizer,
    private readonly access: AccessQueries,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBusPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // The log adapter's simulated progress. Twilio's arrives as webhooks.
    this.telephony.subscribe((update) => {
      void this.apply(update).catch((error: Error) => {
        this.logger.warn(`Could not apply a call status: ${error.message}`);
      });
    });
  }

  // ─── placing calls ────────────────────────────────────────────────────────

  /** Who the caller could ring from here, and whether each is reachable now. */
  async targets(userId: string, where: CallContextQueryDto): Promise<CallTargetDto[]> {
    const context = await this.context(userId, where);
    const callerNumber = await this.callerNumber(userId, context);
    const candidates = await this.candidates(context);

    return Promise.all(
      candidates.map(async (candidate) => {
        const reason = !this.telephony.available
          ? 'Calling is not set up for CareBridge yet.'
          : !callerNumber
            ? 'Add your phone number in Settings to place calls.'
            : !(await this.numberFor(candidate.kind, candidate.id))
              ? 'No phone number on file.'
              : null;
        return { ...candidate, available: reason === null, unavailableReason: reason };
      }),
    );
  }

  async start(userId: string, input: StartCallDto): Promise<CallSessionDto> {
    const context = await this.context(userId, input);
    const candidates = await this.candidates(context);
    const target = candidates.find(
      (c) => c.kind === input.callee.kind && c.id === input.callee.id,
    );
    if (!target) throw new NotFoundError();

    if (!this.telephony.available)
      throw new ConflictError('Calling is not set up for CareBridge yet.');

    const [callerNumber, calleeNumber] = await Promise.all([
      this.callerNumber(userId, context),
      this.numberFor(target.kind, target.id),
    ]);
    if (!callerNumber) {
      throw new ValidationError(
        'Add your phone number in Settings to place calls.',
        'phone',
      );
    }
    if (!calleeNumber)
      throw new ConflictError(`There is no phone number on file for ${target.label}.`);

    const session = await this.prisma.callSession.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        rideId: context.ride?.id ?? null,
        initiatedByUserId: userId,
        callerKind: callerKindFor(context.role),
        calleeKind: target.kind,
        calleeRef: target.id,
      },
    });

    try {
      const { providerRef } = await this.telephony.startBridgedCall({
        callSessionId: session.id,
        relayNumber: this.config.TELEPHONY_RELAY_NUMBER,
        callerNumber,
        calleeNumber,
      });
      await this.prisma.callSession.update({
        where: { id: session.id },
        data: { providerRef },
      });
    } catch (error) {
      await this.prisma.callSession.update({
        where: { id: session.id },
        data: { status: 'failed', endedAt: new Date() },
      });
      this.logger.warn(
        `Relay call ${session.id} could not start: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new ConflictError(
        'We could not place the call. Please try again in a moment.',
      );
    }

    return this.describe(session.id);
  }

  async get(userId: string, callId: string): Promise<CallSessionDto> {
    const session = await this.prisma.callSession.findUnique({ where: { id: callId } });
    if (!session) throw new NotFoundError();

    const mayView =
      session.initiatedByUserId === userId ||
      (await this.access.dispatchesFor(userId, session.organizationId)) ||
      (await this.calleeUserIds(session)).includes(userId);
    if (!mayView) throw new NotFoundError();

    return this.describe(session.id);
  }

  // ─── the caller's own number ─────────────────────────────────────────────

  async myNumber(userId: string): Promise<MyNumberDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    return { phone: user?.phone ?? null };
  }

  /**
   * Stored normalised, so what is shown back is what will be dialled — a
   * number that cannot be dialled is refused now, not discovered when a
   * dispatcher is trying to reach somebody at the kerb.
   */
  async setMyNumber(userId: string, raw: string): Promise<MyNumberDto> {
    const trimmed = raw.trim();
    const phone =
      trimmed.length === 0
        ? null
        : normalizeE164(trimmed, this.config.TELEPHONY_DEFAULT_COUNTRY_CODE);
    if (trimmed.length > 0 && !phone) {
      throw new ValidationError(
        'That number cannot be dialled. Include the area code.',
        'phone',
      );
    }
    await this.prisma.user.update({ where: { id: userId }, data: { phone } });
    return { phone };
  }

  // ─── provider callbacks ───────────────────────────────────────────────────

  /**
   * Moves a call forward. Callbacks arrive late, twice and out of order, so
   * the write is conditional on the status it was decided from: two
   * callbacks racing cannot both apply, and a stale one changes nothing.
   */
  async apply(update: CallStatusUpdate): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { id: update.callSessionId },
    });
    if (!session || !canAdvanceCall(session.status, update.status)) return;

    const now = new Date();
    const terminal = isTerminalCallStatus(update.status);
    const { count } = await this.prisma.callSession.updateMany({
      where: { id: session.id, status: session.status },
      data: {
        status: update.status,
        ...(update.status === 'inProgress' ? { answeredAt: now } : {}),
        ...(terminal ? { endedAt: now } : {}),
        ...(terminal && update.durationSeconds !== undefined
          ? { durationSeconds: update.durationSeconds }
          : {}),
      },
    });
    if (count === 0) return;

    const updated = await this.prisma.callSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const calleeUsers = await this.calleeUserIds(updated);
    const watchers = [
      ...new Set([
        ...(updated.initiatedByUserId ? [updated.initiatedByUserId] : []),
        ...calleeUsers,
      ]),
    ];

    await this.bus.publish({
      userIds: watchers,
      name: 'call.updated',
      payload: { call: await this.describe(updated.id) },
    });

    if (update.status === 'ringingCallee' && calleeUsers.length > 0) {
      // Their phone is ringing now. If the app is open, say who it is — the
      // relay number on the screen means nothing to anybody.
      await this.bus.publish({
        userIds: calleeUsers,
        name: 'call.incoming',
        payload: {
          callId: updated.id,
          fromLabel: await this.callerLabel(updated),
          conversationId: updated.conversationId,
          rideId: updated.rideId,
        },
      });
    }

    if (terminal) await this.finish(updated, session.status, calleeUsers);
  }

  /** The callee's number, when the provider asks for it after the caller answers. */
  async calleeNumberFor(callSessionId: string): Promise<string | null> {
    const session = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
    });
    if (!session || isTerminalCallStatus(session.status)) return null;
    return this.numberFor(session.calleeKind, session.calleeRef);
  }

  /**
   * Someone rang the relay number. If they took part in a relay call in the
   * last day — either side of it — they are put through to that operator's
   * dispatch line; anyone else is told how to reach dispatch.
   */
  async forwardInbound(from: string | null): Promise<string | null> {
    const caller = normalizeE164(from, this.config.TELEPHONY_DEFAULT_COUNTRY_CODE);
    if (!caller) return null;

    const recent = await this.prisma.callSession.findMany({
      where: { startedAt: { gte: new Date(Date.now() - CALLBACK_WINDOW_MS) } },
      orderBy: { startedAt: 'desc' },
      take: CALLBACK_CANDIDATES,
      include: { organization: { select: { phone: true } } },
    });

    for (const session of recent) {
      const [callee, initiator] = await Promise.all([
        this.numberFor(session.calleeKind, session.calleeRef),
        session.initiatedByUserId ? this.userNumber(session.initiatedByUserId) : null,
      ]);
      if (callee === caller || initiator === caller) {
        return normalizeE164(
          session.organization.phone,
          this.config.TELEPHONY_DEFAULT_COUNTRY_CODE,
        );
      }
    }
    return null;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async finish(
    session: CallSession,
    previous: CallStatus,
    calleeUsers: string[],
  ): Promise<void> {
    const reachedCallee = previous === 'ringingCallee' || previous === 'inProgress';

    const line = callSummaryLine(
      session.status,
      reachedCallee,
      session.durationSeconds,
    );
    if (line && session.conversationId) {
      await this.messaging.postSystemLine(session.conversationId, line);
    }

    if (!isMissedByCallee(reachedCallee, session.status) || calleeUsers.length === 0)
      return;

    // The record that the phone rang, pushed so it is seen on a lock screen.
    // Content-free: who kind of called, not their name, not what about.
    const appTarget = APP_FOR_CALLEE[session.calleeKind];
    await this.prisma.notification.createMany({
      data: calleeUsers.map((userId) => ({
        userId,
        kind: 'callMissed' as const,
        title: 'Missed call',
        body: `${callerWord(session.callerKind)} tried to call you. Open CareBridge to call back.`,
        rideId: session.rideId,
        conversationId: session.conversationId,
        appTarget,
      })),
    });
  }

  /** Resolves where a call is being placed from, and refuses if the caller has no part in it. */
  private async context(
    userId: string,
    where: CallContextQueryDto,
  ): Promise<CallContext> {
    if (where.conversationId) {
      const access = await this.messaging.requireAccess(userId, where.conversationId);
      const { conversation, ride } = access;
      const driverIds = [
        conversation.driverId,
        conversation.peerDriverId,
        ride?.driverId,
      ].filter((id): id is string => id !== null && id !== undefined);
      return {
        actor: access.actor,
        role: access.role,
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        ride,
        patientId: conversation.patientId ?? ride?.patientId ?? null,
        driverIds: [...new Set(driverIds)],
      };
    }

    if (!where.rideId)
      throw new ValidationError('Say which conversation or ride this call is about.');

    const [actor, ride] = await Promise.all([
      this.authorizer.actor(userId),
      this.authorizer.ride(where.rideId),
    ]);
    if (!ride?.operatorId) throw new NotFoundError();

    const role: ConversationRole | null = actor.dispatchesFor.has(ride.operatorId)
      ? 'dispatcher'
      : actor.familyOf.has(ride.patientId)
        ? 'family'
        : actor.driver?.status === 'approved' && actor.driver.id === ride.driverId
          ? 'driver'
          : null;
    if (!role) throw new NotFoundError();

    return {
      actor,
      role,
      organizationId: ride.operatorId,
      conversationId: null,
      ride,
      patientId: ride.patientId,
      driverIds: ride.driverId ? [ride.driverId] : [],
    };
  }

  /** Everyone the rules allow this caller to ring from this context, labelled. */
  private async candidates(context: CallContext): Promise<Candidate[]> {
    const allowed = (kind: CallPartyKindName): boolean =>
      canCall(context.role, kind, context.ride);
    const targets: Candidate[] = [];

    if (allowed('dispatch')) {
      const org = await this.prisma.organization.findUnique({
        where: { id: context.organizationId },
        select: { name: true },
      });
      targets.push({
        kind: 'dispatch',
        id: context.organizationId,
        label: `${org?.name ?? 'Operator'} dispatch`,
      });
    }

    if (context.patientId && allowed('patient')) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: context.patientId },
        select: { preferredName: true },
      });
      if (patient)
        targets.push({
          kind: 'patient',
          id: context.patientId,
          label: `${patient.preferredName} (patient)`,
        });
    }

    if (context.patientId && allowed('familyMember')) {
      const grants = await this.prisma.patientAccess.findMany({
        where: {
          patientId: context.patientId,
          revokedAt: null,
          permissions: { has: 'viewProfile' },
        },
        select: { relationship: true, user: { select: { id: true, fullName: true } } },
        orderBy: { grantedAt: 'asc' },
      });
      for (const grant of grants) {
        const relation = RELATIONSHIP_LABEL[grant.relationship] ?? grant.relationship;
        targets.push({
          kind: 'familyMember',
          id: grant.user.id,
          label: `${firstName(grant.user.fullName)} (${relation})`,
        });
      }
    }

    if (allowed('driver') && context.driverIds.length > 0) {
      const drivers = await this.prisma.driver.findMany({
        where: {
          id: { in: context.driverIds },
          organizationId: context.organizationId,
          status: 'approved',
        },
        select: { id: true, displayName: true },
      });
      for (const driver of drivers)
        targets.push({ kind: 'driver', id: driver.id, label: driver.displayName });
    }

    return targets;
  }

  private async numberFor(
    kind: CallPartyKind | CallPartyKindName,
    id: string,
  ): Promise<string | null> {
    let raw: string | null | undefined;
    switch (kind) {
      case 'patient':
        raw = (
          await this.prisma.patient.findUnique({
            where: { id },
            select: { phone: true },
          })
        )?.phone;
        break;
      case 'familyMember':
        raw = (
          await this.prisma.user.findUnique({ where: { id }, select: { phone: true } })
        )?.phone;
        break;
      case 'driver':
        raw = (
          await this.prisma.driver.findUnique({
            where: { id },
            select: { user: { select: { phone: true } } },
          })
        )?.user?.phone;
        break;
      case 'dispatch':
        raw = (
          await this.prisma.organization.findUnique({
            where: { id },
            select: { phone: true },
          })
        )?.phone;
        break;
    }
    return normalizeE164(raw, this.config.TELEPHONY_DEFAULT_COUNTRY_CODE);
  }

  private async userNumber(userId: string): Promise<string | null> {
    return this.numberFor('familyMember', userId);
  }

  /** A dispatcher without a number of their own rings from the operator's line. */
  private async callerNumber(
    userId: string,
    context: CallContext,
  ): Promise<string | null> {
    const own = await this.userNumber(userId);
    if (own || context.role !== 'dispatcher') return own;
    return this.numberFor('dispatch', context.organizationId);
  }

  /** People with an app who are on the receiving end. A patient has none. */
  private async calleeUserIds(session: CallSession): Promise<string[]> {
    switch (session.calleeKind) {
      case 'patient':
        return [];
      case 'familyMember':
        return [session.calleeRef];
      case 'driver': {
        const driver = await this.prisma.driver.findUnique({
          where: { id: session.calleeRef },
          select: { userId: true },
        });
        return driver?.userId ? [driver.userId] : [];
      }
      case 'dispatch':
        return this.access.dispatcherUserIds(session.calleeRef);
    }
  }

  private async callerLabel(session: CallSession): Promise<string> {
    if (session.callerKind !== 'dispatch') return callerWord(session.callerKind);
    const org = await this.prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { name: true },
    });
    return `${org?.name ?? 'CareBridge'} dispatch`;
  }

  private async describe(callId: string): Promise<CallSessionDto> {
    const session = await this.prisma.callSession.findUniqueOrThrow({
      where: { id: callId },
    });
    return {
      id: session.id,
      status: session.status,
      calleeKind: session.calleeKind,
      calleeLabel: await this.calleeLabel(session),
      conversationId: session.conversationId,
      rideId: session.rideId,
      startedAt: session.startedAt.toISOString(),
      answeredAt: session.answeredAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      durationSeconds: session.durationSeconds,
    };
  }

  private async calleeLabel(session: CallSession): Promise<string> {
    switch (session.calleeKind) {
      case 'patient': {
        const p = await this.prisma.patient.findUnique({
          where: { id: session.calleeRef },
          select: { preferredName: true },
        });
        return p ? `${p.preferredName} (patient)` : 'Patient';
      }
      case 'familyMember': {
        const u = await this.prisma.user.findUnique({
          where: { id: session.calleeRef },
          select: { fullName: true },
        });
        return firstName(u?.fullName);
      }
      case 'driver': {
        const d = await this.prisma.driver.findUnique({
          where: { id: session.calleeRef },
          select: { displayName: true },
        });
        return d?.displayName ?? 'Driver';
      }
      case 'dispatch': {
        const o = await this.prisma.organization.findUnique({
          where: { id: session.calleeRef },
          select: { name: true },
        });
        return `${o?.name ?? 'Operator'} dispatch`;
      }
    }
  }
}

const APP_FOR_CALLEE: Record<CallPartyKind, AppTarget> = {
  patient: 'family',
  familyMember: 'family',
  driver: 'driver',
  dispatch: 'ops',
};

function callerKindFor(role: ConversationRole): CallPartyKind {
  switch (role) {
    case 'dispatcher':
      return 'dispatch';
    case 'family':
      return 'familyMember';
    case 'driver':
      return 'driver';
  }
}

function callerWord(kind: CallPartyKind): string {
  switch (kind) {
    case 'dispatch':
      return 'Dispatch';
    case 'driver':
      return 'A driver';
    case 'familyMember':
    case 'patient':
      return 'A family member';
  }
}

function firstName(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Someone';
}
