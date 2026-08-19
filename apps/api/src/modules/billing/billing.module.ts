import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingController, OrganizationsController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [BillingController, OrganizationsController],
  providers: [BillingService],
  // AuthService starts a household's trial at registration, and RidesService
  // asks whether a fare's platform margin is already funded by the operator's
  // seats. Both go through the service; neither touches the tables.
  exports: [BillingService],
})
export class BillingModule {}
