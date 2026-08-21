import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationError, ValidationError } from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import {
  DRIVER_WORK_STATUSES,
  assertDriverTransition,
  canDeclareNoShow,
  driverMovesFrom,
  noShowWaitRemainingSeconds,
} from '../../domain/driver-authority';
import { isAssignable } from '../../domain/driver-status';
import { allowsLocationSharing, type RideStatus } from '../../domain/ride-status';
import {
  LOCATION_BACKLOG_MS,
  TrackingFreshness,
  checkPositionFreshness,
} from '../../domain/tracking';
import { RidesService } from '../care/rides.service';
import { LiveTrackingService } from '../tracking/live-tracking.service';
import type { ReportLocationDto } from '../care/dto/ride.dto';
import type {
  DriverProfileDto,
  DriverRideDto,
  LocationBatchResultDto,
} from './driver.dto';

type Tx = Prisma.TransactionClient;

const DRIVER_INCLUDE = {
  vehicle: true,
  organization: { select: { name: true } },
} satisfies Prisma.DriverInclude;

type DriverRow = Prisma.DriverGetPayload<{ include: typeof DRIVER_INCLUDE }>;

const RIDE_INCLUDE = {
  patient: { select: { preferredName: true, phone: true } },
  pickup: true,
  destination: true,
} satisfies Prisma.RideInclude;

type RideRow = Prisma.RideGetPayload<{ include: typeof RIDE_INCLUDE }>;

/**
 * The driver's side of the product.
 *
 * Every method starts by resolving the caller to a driver record, and nothing
 * here takes a driver id from the caller. That is the whole authorisation
 * model: a driver acts as themselves and only ever on rides that name them, so
 * there is no id in a path that could be swapped for somebody else's. The
 * operator surface works the other way round — a dispatcher names the driver —
 * and the two must not be confused.
 */
@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rideMachine: RidesService,
    private readonly audit: AuditService,
    private readonly tracking: LiveTrackingService,
  ) {}

  // ─── who is calling ───────────────────────────────────────────────────────

  /**
   * Resolves the signed-in account to the driver record it drives as, claiming
   * an unclaimed one on first use.
   *
   * The claim is the only interesting part. An operator builds a roster before
   * anybody has signed up — that is why a driver starts as `invited` — so the
   * link cannot be made when the row is created. It is made here, the first
   * time the person actually opens the app, by matching the address the
   * operator recorded against the address on the account.
   *
   * **Only a verified address matches.** Without that, registering with a
   * driver's email address would be enough to inherit their assignments, and
   * with them a series of passengers' home addresses and telephone numbers.
   * The verification is what makes the match evidence of anything.
   */
  private async requireDriver(userId: string): Promise<DriverRow> {
    const linked = await this.prisma.driver.findUnique({
      where: { userId },
      include: DRIVER_INCLUDE,
    });
    if (linked) return linked;

    return this.claim(userId);
  }

  private async claim(userId: string): Promise<DriverRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    // An unverified address is not a claim. Same refusal as "no such driver":
    // the response must not tell a stranger that an address is on somebody's
    // roster, which is a fact about where a person works.
    if (!user?.emailVerifiedAt) throw new AuthorizationError();

    const candidate = await this.prisma.driver.findFirst({
      where: {
        invitedEmail: user.email,
        userId: null,
        // An offboarded driver is gone. Their row is kept so old rides still
        // name somebody, and it must not become a way back in.
        status: { not: 'offboarded' },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) throw new AuthorizationError();

    // Guarded rather than a plain update: `userId: null` in the where clause
    // makes the claim a compare-and-set, so two requests arriving together
    // cannot both take the place and the second cannot overwrite the first.
    const claimed = await this.prisma.driver.updateMany({
      where: { id: candidate.id, userId: null },
      data: { userId, accountLinkedAt: new Date() },
    });

    if (claimed.count === 0) {
      // Lost the race. Overwhelmingly the common cause is this same driver
      // opening the app on a second device at the same moment, and refusing
      // them would be absurd — so the loser re-reads, and is refused only if
      // the place really did go to somebody else.
      const winner = await this.prisma.driver.findUnique({
        where: { userId },
        include: DRIVER_INCLUDE,
      });
      if (winner) return winner;
      throw new AuthorizationError();
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'driver.account_claimed',
      entityType: 'Driver',
      entityId: candidate.id,
      changedFields: ['userId', 'accountLinkedAt'],
    });

    return this.prisma.driver.findUniqueOrThrow({
      where: { id: candidate.id },
      include: DRIVER_INCLUDE,
    });
  }

  // ─── the shift ────────────────────────────────────────────────────────────

  async profile(userId: string): Promise<DriverProfileDto> {
    return toProfile(await this.requireDriver(userId));
  }

  /**
   * On or off shift.
   *
   * Refuses to go off shift mid-trip, and that is not paternalism about
   * working hours: dispatch reads "on shift" to decide who can be offered the
   * next job, and a driver who disappears from that list while carrying
   * somebody is a passenger nobody is accountable for. Finishing the ride —
   * or telephoning dispatch, who can stand them down — is the way out.
   */
  async setShift(userId: string, onShift: boolean): Promise<DriverProfileDto> {
    const driver = await this.requireDriver(userId);

    if (onShift && !isAssignable(driver.status)) {
      throw new ValidationError(
        driver.status === 'suspended'
          ? 'Your account is suspended. Speak to your dispatcher before starting a shift.'
          : 'Your operator has not approved you to drive yet.',
        'onShift',
      );
    }

    if (!onShift) {
      const active = await this.prisma.ride.count({
        where: { driverId: driver.id, status: { in: [...DRIVER_WORK_STATUSES] } },
      });
      if (active > 0) {
        throw new ValidationError(
          'Finish the ride you are on before going off shift.',
          'onShift',
        );
      }
    }

    const updated = await this.prisma.driver.update({
      where: { id: driver.id },
      data: { onShift },
      include: DRIVER_INCLUDE,
    });
    return toProfile(updated);
  }

  // ─── the work ─────────────────────────────────────────────────────────────

  /**
   * Everything this driver still has to do, soonest first.
   *
   * Deliberately not a history. A finished ride leaves this list and takes the
   * passenger's address and telephone number with it — the record of who was
   * carried where belongs to the operator, not to a phone in a glovebox.
   */
  async rides(userId: string): Promise<DriverRideDto[]> {
    const driver = await this.requireDriver(userId);
    const now = new Date();

    const rows = await this.prisma.ride.findMany({
      where: { driverId: driver.id, status: { in: [...DRIVER_WORK_STATUSES] } },
      include: RIDE_INCLUDE,
      orderBy: { scheduledPickupAt: 'asc' },
    });

    const arrivals = await this.arrivalTimes(rows.map((ride) => ride.id));
    return rows.map((ride) => toRide(ride, arrivals.get(ride.id) ?? null, now));
  }

  /**
   * Moves a ride along.
   *
   * Two guards sit in front of the state machine, and they pull in opposite
   * directions on purpose.
   *
   * **Taking on work** requires an approved driver who is on shift, because
   * accepting a ride is the moment a person becomes responsible for a
   * passenger.
   *
   * **Finishing work already begun** requires neither. A driver suspended
   * halfway through a trip still has somebody in the car; refusing to let them
   * record the drop-off would leave the ride stuck and the passenger's family
   * watching a screen that never changes. Suspension stops the *next* job, and
   * dispatch is the one who deals with the current one.
   */
  async advance(
    userId: string,
    rideId: string,
    to: RideStatus,
    reason: string | null,
    ctx: RequestContext,
  ): Promise<DriverRideDto> {
    const driver = await this.requireDriver(userId);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({
        where: { id: rideId },
        select: { id: true, driverId: true, status: true },
      });
      // Not this driver's ride is answered exactly as no such ride, so the
      // endpoint cannot be used to find out who else is driving today.
      if (!ride || ride.driverId !== driver.id) throw new AuthorizationError();

      assertDriverTransition(ride.status, to);

      if (to === 'driverAccepted') {
        this.assertMayTakeWork(driver);
      }

      if (to === 'noShow') {
        await this.assertWaitServed(tx, rideId, now);
      }

      await this.rideMachine.transition(tx, {
        rideId,
        to,
        at: now,
        actor: driver.displayName,
        reason: reason?.trim() || null,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: `driver.ride_${to}`,
          entityType: 'Ride',
          entityId: rideId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    const updated = await this.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
      include: RIDE_INCLUDE,
    });
    const arrivals = await this.arrivalTimes([rideId]);
    return toRide(updated, arrivals.get(rideId) ?? null, now);
  }

  private assertMayTakeWork(driver: DriverRow): void {
    if (!isAssignable(driver.status)) {
      throw new ValidationError(
        'Your operator has not approved you to drive. Speak to your dispatcher.',
      );
    }
    if (!driver.onShift) {
      throw new ValidationError('Start your shift before accepting a ride.');
    }
  }

  private async assertWaitServed(tx: Tx, rideId: string, now: Date): Promise<void> {
    const arrivedAt = await this.arrivedAt(tx, rideId);
    if (!canDeclareNoShow(arrivedAt, now)) {
      const seconds = noShowWaitRemainingSeconds(arrivedAt, now);
      throw new ValidationError(
        `Wait a little longer — a no-show can be recorded in ${Math.ceil(seconds / 60)} minute(s).`,
        'to',
      );
    }
  }

  // ─── position ─────────────────────────────────────────────────────────────

  /**
   * A flush of the driver app's offline queue.
   *
   * Three rules, and each exists because the batch is the case the single-point
   * endpoint could not express.
   *
   *   1. **The whole batch is refused once the ride is over.** Not filtered —
   *      refused. Location stops being collectable the moment a ride reaches a
   *      state that does not permit it, and a queue that drains afterwards is
   *      carrying readings that should never be stored.
   *   2. **Old readings are kept as history but do not move the map.** A batch
   *      that drains after a tunnel legitimately contains positions from four
   *      minutes ago. They belong in the journey record, and they must not
   *      overwrite a fresher position the family is already looking at.
   *   3. **Re-sending is free.** One device takes one reading per instant, so
   *      the unique index on `(rideId, capturedAt)` turns a retry of a batch
   *      whose response was lost into a no-op.
   */
  async reportLocations(
    userId: string,
    rideId: string,
    points: ReportLocationDto[],
    now: Date,
  ): Promise<LocationBatchResultDto> {
    const driver = await this.requireDriver(userId);

    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, driverId: true, status: true, lastCapturedAt: true },
    });
    if (!ride || ride.driverId !== driver.id) throw new AuthorizationError();

    if (!allowsLocationSharing(ride.status)) {
      throw new ValidationError(
        'That ride is not in a state where location may be shared.',
      );
    }

    const usable = keepUsable(points, now);
    const newest = usable.at(-1);
    if (!newest) {
      return { stored: 0, ignored: points.length, positionUpdated: false };
    }

    const written = await this.prisma.rideLocationSample.createMany({
      data: usable.map((point) => ({
        rideId,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracyMeters ?? DEFAULT_ACCURACY_METERS,
        capturedAt: point.capturedAt,
        receivedAt: now,
      })),
      // A retried flush inserts nothing rather than duplicating a stretch of
      // somebody's journey in the record a dispute would be settled from.
      skipDuplicates: true,
    });

    const movesTheMap =
      checkPositionFreshness(newest.capturedAt, now).ok &&
      (ride.lastCapturedAt === null || newest.capturedAt > ride.lastCapturedAt);

    if (movesTheMap) {
      const accuracyMeters = newest.accuracyMeters ?? DEFAULT_ACCURACY_METERS;
      await this.prisma.ride.update({
        where: { id: rideId },
        data: {
          lastLatitude: newest.latitude,
          lastLongitude: newest.longitude,
          lastAccuracyMeters: accuracyMeters,
          lastCapturedAt: newest.capturedAt,
          etaMinutes: newest.etaMinutes ?? null,
        },
      });

      // After the row, and unable to fail the caller: a Redis outage degrades
      // the live map without costing a driver their upload — which they would
      // then retry, on the connection that has just come back.
      await this.tracking.publish({
        rideId,
        latitude: newest.latitude,
        longitude: newest.longitude,
        accuracyMeters,
        capturedAt: newest.capturedAt.toISOString(),
        etaMinutes: newest.etaMinutes ?? null,
      });
    }

    return {
      stored: written.count,
      ignored: points.length - written.count,
      positionUpdated: movesTheMap,
    };
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  /** When each of these rides recorded the driver reaching the kerb. */
  private async arrivalTimes(rideIds: string[]): Promise<Map<string, Date>> {
    if (rideIds.length === 0) return new Map();

    const rows = await this.prisma.rideStatusHistory.findMany({
      where: { rideId: { in: rideIds }, toStatus: 'driverArrived' },
      orderBy: { at: 'desc' },
      select: { rideId: true, at: true },
    });

    const latest = new Map<string, Date>();
    // Descending, so the first row seen for a ride is the most recent arrival
    // — which is the one the wait is counted from if a driver arrived, left
    // and came back.
    for (const row of rows) {
      if (!latest.has(row.rideId)) latest.set(row.rideId, row.at);
    }
    return latest;
  }

  private async arrivedAt(tx: Tx, rideId: string): Promise<Date | null> {
    const row = await tx.rideStatusHistory.findFirst({
      where: { rideId, toStatus: 'driverArrived' },
      orderBy: { at: 'desc' },
      select: { at: true },
    });
    return row?.at ?? null;
  }
}

const DEFAULT_ACCURACY_METERS = 12;

interface UsablePoint {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: Date;
  etaMinutes?: number;
}

/**
 * Sorts a batch, drops what cannot be believed, and collapses repeats.
 *
 * A reading stamped in the future is refused outright rather than clamped: it
 * would age as permanently fresh, which is the one thing a position display
 * must never do. A reading older than the backlog bound is refused because a
 * device silent that long was switched off rather than driving, and without
 * the bound an unsent queue becomes a way to write arbitrary history into a
 * ride's record.
 */
function keepUsable(points: ReportLocationDto[], now: Date): UsablePoint[] {
  const seen = new Set<number>();
  const kept: UsablePoint[] = [];

  for (const point of points) {
    const capturedAt = new Date(point.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) continue;

    const age = now.getTime() - capturedAt.getTime();
    if (age < 0 && Math.abs(age) > TrackingFreshness.maxClockSkewMs) continue;
    if (age > LOCATION_BACKLOG_MS) continue;
    // Within the batch as well as against the table: a queue flushed twice in
    // one request would otherwise make `createMany` fail the whole insert on
    // its own duplicate rather than skipping it.
    if (seen.has(capturedAt.getTime())) continue;

    seen.add(capturedAt.getTime());
    kept.push({ ...point, capturedAt });
  }

  // Ascending, so "the newest" is the last one and the caller does not have to
  // trust the order a phone happened to send.
  kept.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  return kept;
}

function toProfile(driver: DriverRow): DriverProfileDto {
  return {
    driverId: driver.id,
    organizationId: driver.organizationId,
    organizationName: driver.organization.name,
    displayName: driver.displayName,
    status: driver.status,
    onShift: driver.onShift,
    vehicle: {
      id: driver.vehicle.id,
      make: driver.vehicle.make,
      model: driver.vehicle.model,
      color: driver.vehicle.color,
      licensePlate: driver.vehicle.licensePlate,
      isWheelchairAccessible: driver.vehicle.isWheelchairAccessible,
    },
    canWork: isAssignable(driver.status),
    suspensionReason: driver.suspensionReason,
  };
}

function toRide(ride: RideRow, arrivedAt: Date | null, now: Date): DriverRideDto {
  const status = ride.status;
  const moves = driverMovesFrom(status);

  return {
    id: ride.id,
    status,
    scheduledPickupAt: ride.scheduledPickupAt.toISOString(),
    direction: ride.direction,
    passengerName: ride.patient.preferredName,
    passengerPhone: ride.patient.phone,
    pickup: toAddress(ride.pickup),
    destination: toAddress(ride.destination),
    wheelchairRequired: ride.wheelchairRequired,
    assistanceRequired: ride.assistanceRequired,
    notesForDriver: ride.notesForDriver,
    isDelayed: ride.isDelayed,
    availableTransitions: [...moves],
    noShowAvailableInSeconds: moves.includes('noShow')
      ? noShowWaitRemainingSeconds(arrivedAt, now)
      : null,
    // The same rule the write path enforces, so the app is never asked to
    // collect what the server would refuse to store.
    shareLocation: allowsLocationSharing(status),
    lastCapturedAt: ride.lastCapturedAt?.toISOString() ?? null,
  };
}

function toAddress(address: RideRow['pickup']) {
  return {
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    accessNotes: address.accessNotes,
    latitude: address.latitude,
    longitude: address.longitude,
  };
}
