import { Module } from '@nestjs/common';

import { CareModule } from '../care/care.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DispatchModule } from '../dispatch/dispatch.module';
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
 * family's map as well as the database. `DispatchModule` for `DocumentsService`:
 * a driver uploads their paperwork and an operator reviews it, and the rules
 * about what may be uploaded belong in one place rather than being written
 * twice for the two sides of the same table.
 */
@Module({
  imports: [CareModule, TrackingModule, DispatchModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
