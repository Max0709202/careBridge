import { Module } from '@nestjs/common';

import { AccessTokenModule } from '../auth/access-token.module';
import { LiveTrackingService } from './live-tracking.service';
import { StalenessWatchdog } from './staleness.watchdog';
import { TrackingAuthorizer } from './tracking.authorizer';
import { TrackingGateway } from './tracking.gateway';

/**
 * Live tracking: the gateway, who may watch, and the watchdog that notices
 * silence.
 *
 * `LiveTrackingService` is the only export. `RidesService` calls it and knows
 * nothing about WebSockets — which keeps the ride state machine free of a
 * transport concern, and keeps a Redis outage from being able to fail a
 * transition.
 */
@Module({
  // AccessTokenModule rather than AuthModule: AuthModule imports CareModule,
  // and CareModule needs this one so a ride transition can close a live map —
  // importing it here would close a cycle. What the gateway actually needs is
  // the token check, which is why that lives on its own.
  imports: [AccessTokenModule],
  providers: [
    TrackingGateway,
    TrackingAuthorizer,
    LiveTrackingService,
    StalenessWatchdog,
  ],
  exports: [LiveTrackingService],
})
export class TrackingModule {}
