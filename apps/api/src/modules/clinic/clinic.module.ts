import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { CareModule } from '../care/care.module';
import { ClinicController } from './clinic.controller';
import { ClinicPortalService } from './clinic.service';

/**
 * The clinic portal — Stage 5B.
 *
 * `CareModule` for the ride state machine. The clinic decides *when* a car is
 * sent; who drives and what the ride may do next stay exactly where they were,
 * which is what stops a second dispatch model growing here.
 */
@Module({
  imports: [OrganizationsModule, CareModule],
  controllers: [ClinicController],
  providers: [ClinicPortalService],
})
export class ClinicModule {}
