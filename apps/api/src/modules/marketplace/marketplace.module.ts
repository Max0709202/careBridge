import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CareModule } from '../care/care.module';
import { AdminModule } from '../admin/admin.module';
import {
  MarketplaceAdminController,
  MarketplaceController,
} from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { PlatformRoleGuard } from '../admin/platform-role.guard';

/**
 * The caregiver marketplace — Stage 5A.
 *
 * `CareModule` for `CareService.requirePermission`: booking somebody to sit
 * with a patient uses the same grant as arranging a car, because inventing a
 * separate permission would mean two answers to "who may arrange care".
 */
@Module({
  imports: [AuditModule, CareModule, AdminModule],
  controllers: [MarketplaceController, MarketplaceAdminController],
  providers: [MarketplaceService, PlatformRoleGuard],
})
export class MarketplaceModule {}
