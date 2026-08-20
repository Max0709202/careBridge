import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TrackingFreshness } from '../../domain/tracking';
import { LOCATION_SHARING_STATUSES } from '../../domain/ride-status';
import { TrackingGateway } from './tracking.gateway';

export interface StalenessSweepResult {
  checked: number;
  stale: number;
}

/**
 * Notices when a car stops reporting.
 *
 * Silence is the failure this watchdog exists for, and silence is exactly what
 * nothing else in the system can see. Every other alert in this product is
 * raised by something *happening* — a status change, a payment, a booking. A
 * driver whose phone died in a tunnel produces no event at all: the last
 * position simply stops moving, and a map showing a stationary car is
 * indistinguishable from a car stopped at traffic lights.
 *
 * The client already ages a position and says "this may be out of date" past
 * `staleMs`. That covers the client that is *watching*. It does nothing for
 * the dispatcher who is not looking at that ride, which is the one who could
 * pick up a phone — so the watchdog runs server-side and pushes.
 *
 * A plain interval rather than the job queue, unlike the retention and billing
 * sweeps. Those measure their windows in days and must survive a restart; this
 * one measures in seconds, is idempotent, and holds nothing worth recovering —
 * a missed pass is corrected twenty seconds later. Putting it on the queue
 * would buy durability for something whose entire value is being current.
 */
@Injectable()
export class StalenessWatchdog implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StalenessWatchdog.name);
  private timer?: NodeJS.Timeout;

  /**
   * Half the staleness threshold, so a ride is never more than about half a
   * window past `staleMs` before anyone is told. Sampling at exactly the
   * threshold would mean a ride could sit at 89 seconds of silence with a
   * 45-second threshold and nobody had noticed yet.
   */
  private static readonly INTERVAL_MS = TrackingFreshness.staleMs / 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: TrackingGateway,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.run().catch((error: Error) => {
        this.logger.error(`Staleness sweep failed: ${error.message}`);
      });
    }, StalenessWatchdog.INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass over the rides that are supposed to be reporting.
   *
   * Only rides in a location-sharing status are considered. A ride sitting at
   * `assigned` is not silent — it has not started, and warning about it would
   * teach a dispatcher to ignore the warning.
   */
  async run(now = new Date()): Promise<StalenessSweepResult> {
    const cutoff = new Date(now.getTime() - TrackingFreshness.staleMs);

    const candidates = await this.prisma.ride.findMany({
      where: {
        status: { in: [...LOCATION_SHARING_STATUSES] },
        OR: [
          { lastCapturedAt: { lt: cutoff } },
          // Never reported at all, despite being in a status that should be.
          // The more worrying of the two: a driver who marked themselves en
          // route and whose app has not sent a single position.
          { lastCapturedAt: null },
        ],
      },
      select: { id: true, lastCapturedAt: true },
      // Bounded. A backlog this large means something systemic, and a sweep
      // that tries to alert on all of it makes the incident worse.
      take: 500,
    });

    for (const ride of candidates) {
      const silentForMs =
        ride.lastCapturedAt == null
          ? null
          : now.getTime() - ride.lastCapturedAt.getTime();

      await this.gateway.announceStale(ride.id, silentForMs);
    }

    if (candidates.length > 0) {
      // No ride id in the message and no patient anywhere near it: this line
      // is about a count, and the ids are on the events that carry them.
      this.logger.warn(
        `${candidates.length} ride(s) have stopped reporting a position`,
      );
    }

    return { checked: candidates.length, stale: candidates.length };
  }
}
