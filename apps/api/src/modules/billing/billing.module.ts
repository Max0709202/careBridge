import { Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingController, OrganizationsController } from './billing.controller';
import { WebhooksController } from './webhooks.controller';
import { BillingService } from './billing.service';
import { BillingCycleService } from './billing-cycle.service';
import { InvoicesService } from './invoices.service';

@Module({
  // ConfigModule is deliberately not global — see its docstring — so every
  // module that needs the validated environment imports it explicitly.
  imports: [ConfigModule, OrganizationsModule],
  controllers: [BillingController, OrganizationsController, WebhooksController],
  providers: [BillingService, InvoicesService, BillingCycleService],
  // AuthService starts a household's trial at registration, and RidesService
  // asks whether a fare's platform margin is already funded by the operator's
  // seats. Both go through the service; neither touches the tables.
  exports: [BillingService],
})
export class BillingModule {}
