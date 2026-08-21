import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformRoleGuard } from './platform-role.guard';
import { FeatureFlagService } from './feature-flag.service';

/**
 * CareBridge's own staff surfaces.
 *
 * `FeatureFlagService` is exported because flags are read from everywhere and
 * written only here — keeping the read path in the module that owns the table
 * is what stops a second, subtly different evaluation appearing next to a
 * feature that wanted one.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformRoleGuard, FeatureFlagService],
  exports: [FeatureFlagService],
})
export class AdminModule {}
