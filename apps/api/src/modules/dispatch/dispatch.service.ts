import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RidesService } from '../care/rides.service';
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import {
  assertDriverTransition,
  occupiesSeat,
  type DriverStatus,
} from '../../domain/driver-status';
import {
  assertAssignable,
  dispatchQueue,
  driverEligibility,
  isAwaitingDispatch,
  type DriverCandidate,
} from '../../domain/dispatch';
import type {
  DispatchQueueDto,
  DispatchQueueItemDto,
  DriverDto,
  VehicleDto,
} from './dispatch.dto';
import type {
  AssignRideDto,
  CreateDriverDto,
  CreateVehicleDto,
} from './dto/dispatch.request.dto';

type Tx = Prisma.TransactionClient;

const DRIVER_INCLUDE = { vehicle: true } satisfies Prisma.DriverInclude;

/** Roles that may change what the company is, as opposed to run its day. */
const ADMIN_ROLES = ['owner', 'admin'] as const;
/** Roles that run the day. */
const DISPATCH_ROLES = ['owner', 'admin', 'dispatcher'] as const;

/**
 * The operator's side of a ride: who drives, and who decides.
 *
 * This is the first slice of Stage 3, and it replaces a scripted stand-in
 * rather than adding to it — before it, a driver appeared on a ride because
 * `ride-simulator.service.ts` put one there. What it does **not** yet include
 * is the driver's own app, live location over a socket, or the Flutter Web
 * console; those are the rest of the stage. The state machine lands first
 * because everything above it is a client of these rules.
 *
 * Two couplings are deliberate and worth naming:
 *
 *   - **Approval moves money.** A driver becoming `approved` takes a billable
 *     seat and one leaving it releases one, through `BillingService`. Anything
 *     else means a second place that decides what an operator is billed for.
 *   - **Assignment is not a matter of judgement.** The wheelchair rule and the
 *     one-passenger-at-a-time rule are in `domain/dispatch.ts` and are
 *     asserted, not advised. A dispatcher under pressure at 8am should not be
 *     the last line of defence against a saloon car meeting a wheelchair.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly billing: BillingService,
    private readonly rides: RidesService,
    private readonly audit: AuditService,
  ) {}

  // ─── may this operator work at all ────────────────────────────────────────

  /**
   * An operator may dispatch if they are paying for the product **or** have
   * never subscribed at all.
   *
   * The second half is not an oversight. The fee model funds the platform's
   * cut of a fare one of two ways: the operator's seats, or the pricing rule's
   * basis points if they have no plan. The basis-points path exists precisely
   * so a pilot operator can start before procurement finishes, and gating
   * dispatch on a subscription would close the door that path was cut for.
   *
   * What is refused is an operator whose subscription lapsed or was cancelled.
   * They chose the seats model and then stopped paying for it, and quietly
   * dropping them back onto per-ride would reward exactly that.
   */
  private async requireOperable(organizationId: string, db: Tx | PrismaService) {
    const account = await db.billingAccount.findUnique({ where: { organizationId } });
    if (!account) return;

    if (!(await this.billing.organizationHasEntitlement(organizationId, 'driverApp'))) {
      throw new ValidationError(
        'This operator does not have an active CareBridge plan. Renew it to dispatch trips.',
      );
    }
  }

  // ─── vehicles ─────────────────────────────────────────────────────────────

  async vehicles(userId: string, organizationId: string): Promise<VehicleDto[]> {
    await this.organizations.requireMembership(userId, organizationId, DISPATCH_ROLES);

    const rows = await this.prisma.vehicle.findMany({
      where: { organizationId },
      orderBy: { licensePlate: 'asc' },
    });
    return rows.map(toVehicleDto);
  }

  async addVehicle(
    userId: string,
    organizationId: string,
    dto: CreateVehicleDto,
    ctx: RequestContext,
  ): Promise<VehicleDto> {
    await this.organizations.requireMembership(userId, organizationId, ADMIN_ROLES);

    const vehicle = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vehicle.create({
        data: {
          organizationId,
          make: dto.make.trim(),
          model: dto.model.trim(),
          color: dto.color.trim(),
          licensePlate: dto.licensePlate.trim(),
          isWheelchairAccessible: dto.isWheelchairAccessible,
        },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'dispatch.vehicle_added',
          entityType: 'Vehicle',
          entityId: created.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return created;
    });

    return toVehicleDto(vehicle);
  }

  // ─── the roster ───────────────────────────────────────────────────────────

  async drivers(userId: string, organizationId: string): Promise<DriverDto[]> {
    await this.organizations.requireMembership(userId, organizationId, DISPATCH_ROLES);

    const rows = await this.prisma.driver.findMany({
      where: { organizationId },
      include: DRIVER_INCLUDE,
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });

    const active = await this.activeRideCounts(rows.map((d) => d.id));
    return rows.map((row) => toDriverDto(row, active.get(row.id) ?? 0));
  }

  /**
   * Adds a driver as `invited`, never as approved.
   *
   * The seat only moves at approval, so an operator can build a roster without
   * being billed for people who have not yet handed in a licence.
   */
  async addDriver(
    userId: string,
    organizationId: string,
    dto: CreateDriverDto,
    ctx: RequestContext,
  ): Promise<DriverDto> {
    await this.organizations.requireMembership(userId, organizationId, ADMIN_ROLES);

    const driver = await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({ where: { id: dto.vehicleId } });
      // Same 404 as "no such vehicle": another operator's fleet must not be
      // probeable by id.
      if (!vehicle || vehicle.organizationId !== organizationId) {
        throw new AuthorizationError();
      }

      const created = await tx.driver.create({
        data: {
          organizationId,
          displayName: dto.displayName.trim(),
          vehicleId: dto.vehicleId,
          yearsDriving: dto.yearsDriving ?? 1,
          status: 'invited',
          // Lower-cased to match how accounts store theirs. A claim compares
          // the two literally, and a capital letter typed by a dispatcher
          // would otherwise mean a driver whose app never finds them.
          invitedEmail: dto.email?.trim().toLowerCase() ?? null,
        },
        include: DRIVER_INCLUDE,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'dispatch.driver_added',
          entityType: 'Driver',
          entityId: created.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return created;
    });

    return toDriverDto(driver, 0);
  }

  /**
   * Moves a driver through the lifecycle, and moves the seat with them.
   *
   * The seat change is inside the same transaction as the status change, so a
   * failure cannot leave an operator approved-but-unbilled or
   * billed-but-offboarded. Which of those is worse depends on which way round
   * it happened, and neither is discoverable without an audit.
   */
  async setDriverStatus(
    userId: string,
    organizationId: string,
    driverId: string,
    to: DriverStatus,
    reason: string | undefined,
    ctx: RequestContext,
  ): Promise<DriverDto> {
    await this.organizations.requireMembership(userId, organizationId, ADMIN_ROLES);
    const now = new Date();

    const driver = await this.prisma.$transaction(async (tx) => {
      const current = await tx.driver.findUnique({
        where: { id: driverId },
        include: DRIVER_INCLUDE,
      });
      if (!current || current.organizationId !== organizationId) {
        throw new AuthorizationError();
      }

      assertDriverTransition(current.status, to);

      if (to === 'suspended' && !reason?.trim()) {
        // An unexplained suspension is a dispute nobody can settle later.
        throw new ValidationError('Say why the driver is being suspended.', 'reason');
      }

      const held = occupiesSeat(current.status);
      const holds = occupiesSeat(to);

      const updated = await tx.driver.update({
        where: { id: driverId },
        data: {
          status: to,
          approvedAt:
            to === 'approved' ? (current.approvedAt ?? now) : current.approvedAt,
          approvedByUserId:
            to === 'approved'
              ? (current.approvedByUserId ?? userId)
              : current.approvedByUserId,
          suspensionReason: to === 'suspended' ? (reason?.trim() ?? null) : null,
          deactivatedAt: holds ? null : (current.deactivatedAt ?? now),
          // A driver who stops being approved stops being on shift. Leaving
          // the flag set would offer dispatch somebody who cannot drive.
          onShift: holds ? current.onShift : false,
        },
        include: DRIVER_INCLUDE,
      });

      if (held !== holds) {
        await this.billing.recordSeatChange({
          db: tx,
          organizationId,
          driverId,
          change: holds ? 'granted' : 'released',
          actorUserId: userId,
          now,
        });
      }

      await this.audit.record(
        {
          actorUserId: userId,
          action: `dispatch.driver_${to}`,
          entityType: 'Driver',
          entityId: driverId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['status', ...(held !== holds ? ['seat'] : [])],
        },
        tx,
      );

      return updated;
    });

    const active = await this.activeRideCounts([driverId]);
    return toDriverDto(driver, active.get(driverId) ?? 0);
  }

  /**
   * Shift on or off. A dispatcher may do this, because they are the person who
   * knows somebody called in sick — waiting for an admin would leave the queue
   * offering a driver who is not there.
   */
  async setShift(
    userId: string,
    organizationId: string,
    driverId: string,
    onShift: boolean,
  ): Promise<DriverDto> {
    await this.organizations.requireMembership(userId, organizationId, DISPATCH_ROLES);

    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: DRIVER_INCLUDE,
    });
    if (!driver || driver.organizationId !== organizationId) {
      throw new AuthorizationError();
    }

    if (onShift && !occupiesSeat(driver.status)) {
      throw new ValidationError(
        'That driver has not been approved to carry passengers.',
        'onShift',
      );
    }

    const updated = await this.prisma.driver.update({
      where: { id: driverId },
      data: { onShift },
      include: DRIVER_INCLUDE,
    });

    const active = await this.activeRideCounts([driverId]);
    return toDriverDto(updated, active.get(driverId) ?? 0);
  }

  // ─── the queue ────────────────────────────────────────────────────────────

  /**
   * Rides waiting for a car, ordered by when the car is needed.
   *
   * **The scoping here is honest about a gap.** The MVP runs one operator in
   * one metro area (O1), so an unassigned ride belongs to whoever is looking at
   * it. A second operator in the same area needs a routing decision — which
   * rides are offered to which company — that does not exist yet, and inventing
   * one now would be guessing. Until then the queue is unassigned rides plus
   * the ones this operator already settled, and that limit is written down
   * rather than left to be discovered.
   */
  async queue(userId: string, organizationId: string): Promise<DispatchQueueDto> {
    await this.organizations.requireMembership(userId, organizationId, DISPATCH_ROLES);
    const now = new Date();

    const [rides, drivers] = await Promise.all([
      this.prisma.ride.findMany({
        where: {
          status: { in: ['requested', 'awaitingAssignment', 'reassignmentRequired'] },
          OR: [
            { settledOrganizationId: null },
            { settledOrganizationId: organizationId },
          ],
        },
        include: { patient: true, pickup: true, destination: true },
        orderBy: { scheduledPickupAt: 'asc' },
        take: 200,
      }),
      this.candidates(organizationId),
    ]);

    const ordered = dispatchQueue(
      rides.map((ride) => ({
        rideId: ride.id,
        status: ride.status,
        scheduledPickupAt: ride.scheduledPickupAt,
        wheelchairRequired: ride.wheelchairRequired,
        row: ride,
      })),
      now,
    );

    const items: DispatchQueueItemDto[] = ordered.map((entry) => ({
      rideId: entry.rideId,
      status: entry.status,
      patientName: entry.row.patient.preferredName,
      pickupLine: `${entry.row.pickup.line1}, ${entry.row.pickup.city}`,
      destinationLine: `${entry.row.destination.line1}, ${entry.row.destination.city}`,
      scheduledPickupAt: entry.row.scheduledPickupAt.toISOString(),
      wheelchairRequired: entry.row.wheelchairRequired,
      assistanceRequired: entry.row.assistanceRequired,
      urgency: entry.urgency,
      candidates: drivers.map((driver) => {
        const { eligible, reasons } = driverEligibility(driver, entry);
        return {
          driverId: driver.driverId,
          displayName: driver.displayName,
          eligible,
          reasons: [...reasons],
        };
      }),
    }));

    return {
      organizationId,
      items,
      availableDrivers: drivers.filter(
        (d) => occupiesSeat(d.status) && d.onShift && d.activeRideCount === 0,
      ).length,
    };
  }

  // ─── assignment ───────────────────────────────────────────────────────────

  /**
   * Gives a ride to a driver, or takes it off one and gives it to another.
   *
   * Reassignment goes through `reassignmentRequired` rather than straight from
   * `assigned` to `assigned`: the intermediate state is what the family's
   * timeline reads back later, and a self-transition would lose the fact that
   * the first driver dropped it.
   */
  async assign(
    userId: string,
    organizationId: string,
    rideId: string,
    dto: AssignRideDto,
    ctx: RequestContext,
  ): Promise<DispatchQueueDto> {
    await this.organizations.requireMembership(userId, organizationId, DISPATCH_ROLES);
    await this.requireOperable(organizationId, this.prisma);

    const actor = await this.actorName(userId);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError();

      if (
        ride.settledOrganizationId != null &&
        ride.settledOrganizationId !== organizationId
      ) {
        // Another company is already carrying this one, and their payout is
        // already pinned to it.
        throw new AuthorizationError();
      }

      const candidate = await this.candidate(tx, organizationId, dto.driverId);
      assertAssignable(candidate, { wheelchairRequired: ride.wheelchairRequired });

      const status = ride.status;

      if (!isAwaitingDispatch(status)) {
        if (!ride.driverId) throw new NotFoundError();
        if (!dto.reason?.trim()) {
          throw new ValidationError(
            'Say why the trip is being taken off its current driver.',
            'reason',
          );
        }
        await this.rides.transition(tx, {
          rideId,
          to: 'reassignmentRequired',
          at: now,
          actor,
          reason: dto.reason.trim(),
        });
      } else if (status === 'requested') {
        // A ride the family has asked for but nothing has picked up yet.
        await this.rides.transition(tx, {
          rideId,
          to: 'awaitingAssignment',
          at: now,
          actor,
        });
      }

      await this.rides.transition(tx, {
        rideId,
        to: 'assigned',
        at: now,
        actor,
        driverId: dto.driverId,
        reason: dto.reason?.trim() ?? null,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: isAwaitingDispatch(status)
            ? 'dispatch.ride_assigned'
            : 'dispatch.ride_reassigned',
          entityType: 'Ride',
          entityId: rideId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['driverId', 'status'],
        },
        tx,
      );
    });

    return this.queue(userId, organizationId);
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async candidates(organizationId: string): Promise<DriverCandidate[]> {
    const drivers = await this.prisma.driver.findMany({
      where: { organizationId, status: { not: 'offboarded' } },
      include: DRIVER_INCLUDE,
      orderBy: { displayName: 'asc' },
    });

    const active = await this.activeRideCounts(drivers.map((d) => d.id));

    return drivers.map((driver) => ({
      driverId: driver.id,
      displayName: driver.displayName,
      status: driver.status,
      onShift: driver.onShift,
      vehicleIsWheelchairAccessible: driver.vehicle.isWheelchairAccessible,
      activeRideCount: active.get(driver.id) ?? 0,
    }));
  }

  private async candidate(
    tx: Tx,
    organizationId: string,
    driverId: string,
  ): Promise<DriverCandidate> {
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      include: DRIVER_INCLUDE,
    });
    if (!driver || driver.organizationId !== organizationId) {
      throw new AuthorizationError();
    }

    const active = await tx.ride.count({
      where: {
        driverId,
        status: { notIn: ['completed', 'canceled', 'noShow', 'draft'] },
      },
    });

    return {
      driverId: driver.id,
      displayName: driver.displayName,
      status: driver.status,
      onShift: driver.onShift,
      vehicleIsWheelchairAccessible: driver.vehicle.isWheelchairAccessible,
      activeRideCount: active,
    };
  }

  private async activeRideCounts(driverIds: string[]): Promise<Map<string, number>> {
    if (driverIds.length === 0) return new Map();

    const rows = await this.prisma.ride.groupBy({
      by: ['driverId'],
      where: {
        driverId: { in: driverIds },
        status: { notIn: ['completed', 'canceled', 'noShow', 'draft'] },
      },
      _count: { _all: true },
    });

    return new Map(
      rows.filter((r) => r.driverId != null).map((r) => [r.driverId!, r._count._all]),
    );
  }

  private async actorName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    return user?.fullName ?? 'Dispatch';
  }
}

function toVehicleDto(row: {
  id: string;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
}): VehicleDto {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    color: row.color,
    licensePlate: row.licensePlate,
    isWheelchairAccessible: row.isWheelchairAccessible,
  };
}

function toDriverDto(
  row: Prisma.DriverGetPayload<{ include: typeof DRIVER_INCLUDE }>,
  activeRideCount: number,
): DriverDto {
  return {
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    onShift: row.onShift,
    rating: row.rating,
    yearsDriving: row.yearsDriving,
    vehicle: toVehicleDto(row.vehicle),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    occupiesSeat: occupiesSeat(row.status),
    activeRideCount,
    invitedEmail: row.invitedEmail,
    // The account itself is never exposed here — only whether one is attached.
    // A dispatcher needs to know a driver can be reached through the app, not
    // who the account belongs to.
    hasAppAccount: row.userId !== null,
  };
}
