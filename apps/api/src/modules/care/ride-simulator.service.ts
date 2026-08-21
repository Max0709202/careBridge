import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { lerp, type Coordinates } from '../../domain/geo';
import {
  allowsLocationSharing,
  canTransitionRide,
  isTerminalRideStatus,
  type RideStatus,
} from '../../domain/ride-status';
import { CareService } from './care.service';
import { RidesService } from './rides.service';

/**
 * Stand-in for the driver app and the dispatch service.
 *
 * This is **not** a shortcut. It drives a ride through exactly the same
 * `RidesService.transition` a real driver's transitions will, and writes
 * position reports through the same `reportLocation` that validates freshness
 * and ride state. It has no privileged path: an illegal transition here is
 * rejected exactly as it would be from a driver's phone.
 *
 * It lives on the **server**, which is where a driver's transitions come from.
 * Running the script in the Flutter app — as the previous build did — meant a
 * closed browser tab stopped the trip and a page refresh lost it. Here, the
 * trip carries on and the state survives; `simulationActive` is persisted so a
 * restart resumes rather than abandons.
 *
 * When `apps/mobile_driver` exists, this service is deleted and nothing else
 * changes.
 */
@Injectable()
export class RideSimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RideSimulatorService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly rides: RidesService,
  ) {}

  /** Picks simulations back up after a restart, rather than silently dropping them. */
  async onModuleInit(): Promise<void> {
    const running = await this.prisma.ride.findMany({
      where: {
        simulationActive: true,
        status: { notIn: ['completed', 'canceled', 'noShow'] },
      },
      select: { id: true },
    });

    for (const ride of running) {
      this.schedule(ride.id);
    }
    if (running.length > 0) {
      this.logger.log(`Resumed ${running.length} preview trip(s) after restart`);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  async start(userId: string, rideId: string): Promise<void> {
    await this.care.requireRidePermission(userId, rideId, 'requestTransport');

    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundError();
    if (isTerminalRideStatus(ride.status)) {
      throw new ValidationError('That ride has already finished.');
    }

    // Resuming a paused trip keeps its elapsed position in the script, so
    // "Continue the trip" continues rather than restarting from the kerb.
    await this.prisma.ride.update({
      where: { id: rideId },
      data: { simulationActive: true },
    });

    if (ride.status === 'requested') {
      await this.prisma.$transaction((tx) =>
        this.rides.transition(tx, {
          rideId,
          to: 'awaitingAssignment',
          at: new Date(),
          actor: 'CareBridge',
          reason: 'Preview trip',
        }),
      );
    }

    this.schedule(rideId);
  }

  async stop(userId: string, rideId: string): Promise<void> {
    await this.care.requireRidePermission(userId, rideId, 'requestTransport');
    this.clear(rideId);
    await this.prisma.ride.update({
      where: { id: rideId },
      data: { simulationActive: false },
    });
  }

  private schedule(rideId: string): void {
    this.clear(rideId);
    const timer = setInterval(() => {
      void this.tick(rideId).catch((error) => {
        this.logger.error(`Preview trip ${rideId} failed`, error);
        void this.forceStop(rideId);
      });
    }, 1000);
    // Do not hold the process open on this timer alone.
    timer.unref?.();
    this.timers.set(rideId, timer);
  }

  private clear(rideId: string): void {
    const timer = this.timers.get(rideId);
    if (timer) clearInterval(timer);
    this.timers.delete(rideId);
  }

  private async forceStop(rideId: string): Promise<void> {
    this.clear(rideId);
    await this.prisma.ride
      .update({ where: { id: rideId }, data: { simulationActive: false } })
      .catch(() => undefined);
  }

  private async tick(rideId: string): Promise<void> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { pickup: true, destination: true },
    });

    if (!ride || !ride.simulationActive || isTerminalRideStatus(ride.status)) {
      await this.forceStop(rideId);
      return;
    }

    const t = ride.simulationElapsedSeconds + 1;
    await this.prisma.ride.update({
      where: { id: rideId },
      data: { simulationElapsedSeconds: t },
    });

    const next = SCRIPT[t];
    if (next && canTransitionRide(ride.status, next)) {
      const driverId = await this.driverFor(ride.wheelchairRequired);
      await this.prisma.$transaction((tx) =>
        this.rides.transition(tx, {
          rideId,
          to: next,
          at: new Date(),
          actor: 'Preview driver',
          reason: 'Preview trip',
          driverId: next === 'assigned' ? driverId : undefined,
        }),
      );
    }

    const current = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { status: true },
    });
    if (!current) return;

    if (isTerminalRideStatus(current.status)) {
      await this.forceStop(rideId);
      return;
    }

    if (!allowsLocationSharing(current.status)) return;

    const position = positionFor(current.status, t, {
      pickup: coordsOf(ride.pickup),
      destination: coordsOf(ride.destination),
    });
    if (!position) return;

    const now = new Date();
    await this.prisma.$transaction((tx) =>
      this.rides.reportLocation(
        tx,
        rideId,
        {
          latitude: position.latitude,
          longitude: position.longitude,
          accuracyMeters: 12,
          capturedAt: now.toISOString(),
        },
        now,
      ),
    );
  }

  private async driverFor(wheelchairRequired: boolean): Promise<string> {
    // Wheelchair accessibility is a hard constraint on assignment, never a
    // preference (assumption P7). A dispatcher that offered a saloon car for a
    // wheelchair user would be a wasted journey and a distressed passenger.
    const driver = await this.prisma.driver.findFirst({
      where: { vehicle: { isWheelchairAccessible: wheelchairRequired } },
      orderBy: { displayName: 'asc' },
    });
    if (!driver) {
      throw new NotFoundError();
    }
    return driver.id;
  }
}

/** The script, in seconds since the trip started. */
const SCRIPT: Record<number, RideStatus | undefined> = {
  2: 'assigned',
  5: 'driverAccepted',
  8: 'driverEnRoute',
  30: 'driverArrived',
  36: 'passengerOnboard',
  39: 'inProgress',
  75: 'arrivedAtDestination',
  82: 'completed',
};

function coordsOf(address: {
  latitude: number | null;
  longitude: number | null;
}): Coordinates | null {
  return address.latitude != null && address.longitude != null
    ? { latitude: address.latitude, longitude: address.longitude }
    : null;
}

/**
 * Where the car is. On the way to pickup it approaches from a point about a
 * mile away; after pickup it runs from the pickup address to the destination.
 */
function positionFor(
  status: RideStatus,
  t: number,
  route: { pickup: Coordinates | null; destination: Coordinates | null },
): Coordinates | null {
  const { pickup, destination } = route;
  if (!pickup || !destination) return null;

  switch (status) {
    case 'driverEnRoute': {
      const progress = clamp((t - 8) / 22);
      const start = {
        latitude: pickup.latitude - 0.018,
        longitude: pickup.longitude - 0.021,
      };
      return lerp(start, pickup, progress);
    }
    case 'driverArrived':
    case 'passengerOnboard':
      return pickup;
    case 'inProgress':
      return lerp(pickup, destination, clamp((t - 39) / 36));
    case 'arrivedAtDestination':
      return destination;
    default:
      return null;
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
