import { Injectable } from '@nestjs/common';
import type { Conversation } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessQueries } from '../../common/access.queries';
import {
  roleIn,
  type ActorFacts,
  type ConversationRole,
  type ConversationSubject,
  type DriverFacts,
  type RideFacts,
} from '../../domain/conversation-access';
import { isTerminalRideStatus, RIDE_STATUSES } from '../../domain/ride-status';
import type { DriverStatus } from '../../domain/driver-status';

const TERMINAL_STATUSES = RIDE_STATUSES.filter(isTerminalRideStatus);

/**
 * Gathers the facts `domain/conversation-access.ts` decides on.
 *
 * Nothing here decides anything. That split is the same one tracking uses,
 * and for the same reason: the rules are exhaustively testable only if the
 * part that touches the database has no opinions.
 */
@Injectable()
export class ConversationAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessQueries,
  ) {}

  async actor(userId: string): Promise<ActorFacts> {
    const [dispatchesFor, familyOf, driver] = await Promise.all([
      this.access.dispatchOrganizationIds(userId),
      this.access.familyPatientIds(userId),
      this.prisma.driver.findUnique({
        where: { userId },
        select: { id: true, organizationId: true, status: true, onShift: true },
      }),
    ]);

    return {
      userId,
      dispatchesFor,
      familyOf,
      driver: driver ? toDriverFacts(driver) : null,
    };
  }

  async driver(driverId: string): Promise<DriverFacts | null> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, organizationId: true, status: true, onShift: true },
    });
    return driver ? toDriverFacts(driver) : null;
  }

  /**
   * The ride, with the operator carrying it and when it ended.
   *
   * The operator is the settled one when there is one — a reassignment moves
   * the driver, not the company — and otherwise the assigned driver's.
   * `endedAt` comes from the status history rather than `updatedAt`, because
   * the thread's grace period is measured from the end of the trip and not
   * from whatever last touched the row.
   */
  async ride(rideId: string): Promise<RideFacts | null> {
    return (await this.rides([rideId])).get(rideId) ?? null;
  }

  /** `ride`, for many at once — the inbox needs one per ride-linked thread. */
  async rides(rideIds: string[]): Promise<Map<string, RideFacts>> {
    const facts = new Map<string, RideFacts>();
    if (rideIds.length === 0) return facts;

    const rides = await this.prisma.ride.findMany({
      where: { id: { in: [...new Set(rideIds)] } },
      select: {
        id: true,
        patientId: true,
        status: true,
        driverId: true,
        settledOrganizationId: true,
        updatedAt: true,
        driver: { select: { organizationId: true } },
      },
    });

    const ended = rides.filter((r) => isTerminalRideStatus(r.status));
    const endings = ended.length
      ? await this.prisma.rideStatusHistory.groupBy({
          by: ['rideId'],
          where: {
            rideId: { in: ended.map((r) => r.id) },
            toStatus: { in: [...TERMINAL_STATUSES] },
          },
          _max: { at: true },
        })
      : [];
    const endedAt = new Map(endings.map((e) => [e.rideId, e._max.at]));

    for (const ride of rides) {
      const status = ride.status;
      facts.set(ride.id, {
        id: ride.id,
        patientId: ride.patientId,
        status,
        driverId: ride.driverId,
        operatorId: ride.settledOrganizationId ?? ride.driver?.organizationId ?? null,
        endedAt: isTerminalRideStatus(status)
          ? (endedAt.get(ride.id) ?? ride.updatedAt)
          : null,
      });
    }
    return facts;
  }

  /** Operators that have carried, or are carrying, this patient. */
  async operatorsServingPatient(patientId: string): Promise<Set<string>> {
    const rides = await this.prisma.ride.findMany({
      where: {
        patientId,
        OR: [{ settledOrganizationId: { not: null } }, { driverId: { not: null } }],
      },
      select: {
        settledOrganizationId: true,
        driver: { select: { organizationId: true } },
      },
    });

    const ids = new Set<string>();
    for (const ride of rides) {
      if (ride.settledOrganizationId) ids.add(ride.settledOrganizationId);
      if (ride.driver) ids.add(ride.driver.organizationId);
    }
    return ids;
  }

  /** The caller's role in an existing conversation, with the ride facts it was decided on. */
  async roleFor(
    actor: ActorFacts,
    conversation: Conversation,
  ): Promise<{ role: ConversationRole | null; ride: RideFacts | null }> {
    const ride = conversation.rideId ? await this.ride(conversation.rideId) : null;
    return { role: roleIn(actor, toSubject(conversation), ride), ride };
  }

  /**
   * Everyone who is in a conversation right now, with their role.
   *
   * Computed at the moment of sending, so a message goes to the circle as it
   * is, not as it was when the thread was opened. The role decides which app
   * a notification is routed to.
   */
  async members(
    conversation: Conversation,
    ride: RideFacts | null,
  ): Promise<Map<string, ConversationRole>> {
    const members = new Map<string, ConversationRole>();
    const add = (userIds: Iterable<string>, role: ConversationRole): void => {
      for (const id of userIds) if (!members.has(id)) members.set(id, role);
    };

    // Dispatch first, so someone who is both is reached as a dispatcher —
    // matching `roleIn`.
    add(await this.access.dispatcherUserIds(conversation.organizationId), 'dispatcher');

    switch (conversation.kind) {
      case 'dispatchFamily':
        if (conversation.patientId) {
          add(await this.access.familyUserIds(conversation.patientId), 'family');
        }
        break;

      case 'dispatchDriver': {
        const driverId = conversation.driverId;
        if (!driverId) break;
        // A ride thread belongs to whoever the ride is assigned to *now*.
        if (conversation.rideId && ride?.driverId !== driverId) break;
        add(
          await this.driverUserIds({ id: driverId }, conversation.organizationId),
          'driver',
        );
        break;
      }

      case 'driverDriver': {
        const ids = [conversation.driverId, conversation.peerDriverId].filter(
          (id): id is string => id !== null,
        );
        add(
          await this.driverUserIds({ id: { in: ids } }, conversation.organizationId),
          'driver',
        );
        break;
      }

      case 'operatorDrivers':
        add(await this.driverUserIds({}, conversation.organizationId), 'driver');
        break;
    }

    return members;
  }

  private async driverUserIds(
    where: { id?: string | { in: string[] } },
    organizationId: string,
  ): Promise<string[]> {
    const drivers = await this.prisma.driver.findMany({
      where: { ...where, organizationId, status: 'approved', userId: { not: null } },
      select: { userId: true },
    });
    return drivers.map((d) => d.userId).filter((id): id is string => id !== null);
  }
}

export function toSubject(conversation: Conversation): ConversationSubject {
  return {
    kind: conversation.kind,
    organizationId: conversation.organizationId,
    patientId: conversation.patientId,
    driverId: conversation.driverId,
    peerDriverId: conversation.peerDriverId,
    rideId: conversation.rideId,
  };
}

function toDriverFacts(driver: {
  id: string;
  organizationId: string;
  status: string;
  onShift: boolean;
}): DriverFacts {
  return {
    id: driver.id,
    organizationId: driver.organizationId,
    status: driver.status as DriverStatus,
    onShift: driver.onShift,
  };
}
