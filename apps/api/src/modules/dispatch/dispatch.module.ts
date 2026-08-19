import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingModule } from '../billing/billing.module';
import { CareModule } from '../care/care.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  // CareModule for the ride state machine — dispatch decides *who* drives, and
  // the machine that decides what a ride may do next stays in one place.
  // BillingModule because approving a driver moves a billable seat.
  imports: [OrganizationsModule, BillingModule, CareModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
