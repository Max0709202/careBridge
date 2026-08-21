import { Module } from '@nestjs/common';

import { CareModule } from '../care/care.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

/**
 * The driver app's half of the system.
 *
 * Separate from `DispatchModule` even though both are about drivers, because
 * they answer to different people and authorise completely differently: a
 * dispatcher names a driver and is checked against an organisation, while a
 * driver acts only as themselves. Folding them together would mean one
 * controller holding both models, which is how an endpoint ends up with the
 * wrong one.
 *
 * `CareModule` for the ride state machine — the machine that decides what a
 * ride may do next stays in one place, and this module only narrows it to what
 * belongs to the driver. `TrackingModule` so a flushed queue reaches the
 * family's map as well as the database.
 */
@Module({
  imports: [CareModule, TrackingModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
