import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingModule } from '../billing/billing.module';
import { CareModule } from '../care/care.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { DocumentsService } from './documents.service';

@Module({
  // CareModule for the ride state machine — dispatch decides *who* drives, and
  // the machine that decides what a ride may do next stays in one place.
  // BillingModule because approving a driver moves a billable seat.
  imports: [OrganizationsModule, BillingModule, CareModule],
  controllers: [DispatchController],
  providers: [DispatchService, DocumentsService],
  // DocumentsService is exported for DriverModule: a driver uploads their own
  // paperwork, and the rules about what may be uploaded belong in one place
  // rather than being written twice for the two sides of the same table.
  exports: [DispatchService, DocumentsService],
})
export class DispatchModule {}
