import { Module } from '@nestjs/common';

import { AccessTokenModule } from '../auth/access-token.module';
import { EtaService } from './eta.service';
import { LiveTrackingService } from './live-tracking.service';
import { StalenessWatchdog } from './staleness.watchdog';
import { TrackingAuthorizer } from './tracking.authorizer';
import { TrackingGateway } from './tracking.gateway';

/**
 * Live tracking: the gateway, who may watch, and the watchdog that notices
 * silence.
 *
 * Two exports, both of them things `RidesService` calls without knowing what
 * is behind them. It knows nothing about WebSockets, which keeps the ride
 * state machine free of a transport concern and keeps a Redis outage from
 * being able to fail a transition; and it knows nothing about routing vendors,
 * which keeps a vendor outage from being able to fail a position report.
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
    EtaService,
    StalenessWatchdog,
  ],
  exports: [LiveTrackingService, EtaService],
})
export class TrackingModule {}
