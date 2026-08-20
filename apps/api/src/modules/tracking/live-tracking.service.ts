import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  POSITION_STORE,
  type LivePosition,
  type PositionStorePort,
} from '../../infrastructure/tracking/position-store.port';
import { TrackingGateway } from './tracking.gateway';

/**
 * The seam between a ride changing and a map changing.
 *
 * `RidesService` calls this; it does not know a WebSocket exists. That matters
 * for one specific reason rather than tidiness: every method here is called
 * from **inside a database transaction's call site**, and none of them may be
 * able to fail it. A ride that completed must stay completed even if Redis is
 * down and the map never hears about it — the alternative is a transition
 * rolled back by a cache, which is a state machine controlled by a cache.
 *
 * So everything below swallows its own failures and logs. Live tracking is
 * allowed to degrade; the ride record is not.
 */
@Injectable()
export class LiveTrackingService {
  private readonly logger = new Logger(LiveTrackingService.name);

  constructor(
    @Inject(POSITION_STORE) private readonly positions: PositionStorePort,
    private readonly gateway: TrackingGateway,
  ) {}

  /** Pushes a position to everyone watching this ride. */
  async publish(position: LivePosition): Promise<void> {
    try {
      await this.positions.publish(position);
    } catch (error) {
      this.logger.warn(
        `Could not publish a position: ${message(error)}. The ride row still has it.`,
      );
    }
  }

  /**
   * Ends live tracking for a ride.
   *
   * Called the instant a ride reaches a terminal state, and it does two things
   * that are not the same: it **forgets** the stored position, so nothing can
   * be read afterwards, and it **closes the room**, so clients are told rather
   * than left watching a map that has quietly stopped moving.
   *
   * The TTL would forget it eventually. "Eventually" is up to two minutes of a
   * finished trip's last position still being readable by anyone who was
   * watching, and the rule this product holds is that location stops being
   * available when the ride ends.
   */
  async end(rideId: string): Promise<void> {
    try {
      await this.positions.forget(rideId);
      await this.gateway.closeRoom(rideId, 'ended');
    } catch (error) {
      this.logger.warn(`Could not close tracking for ${rideId}: ${message(error)}`);
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}
