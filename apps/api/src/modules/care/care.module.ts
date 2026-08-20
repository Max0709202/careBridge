import { Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { BillingModule } from '../billing/billing.module';
import { TrackingModule } from '../tracking/tracking.module';

import {
  AppointmentsController,
  CareController,
  ClinicsController,
  InvitationsController,
  MeController,
  NotificationsController,
  PatientsController,
  RidesController,
} from './care.controller';
import { CareService } from './care.service';
import { PatientsService } from './patients.service';
import { ClinicsService } from './clinics.service';
import { AppointmentsService } from './appointments.service';
import { RidesService } from './rides.service';
import { RideSimulatorService } from './ride-simulator.service';
import { NotificationsService } from './notifications.service';
import { PreferencesService } from './preferences.service';
import { InvitationsService } from './invitations.service';
import { DevicesService } from './devices.service';
import { GeocodingService } from './geocoding.service';
import { RemindersService } from './reminders.service';
import { NotificationDispatchService } from './notification-dispatch.service';

@Module({
  // ConfigModule is deliberately not global (see its docblock), so every
  // module that needs the validated environment imports it explicitly.
  // BillingModule answers two questions rides cannot answer for themselves:
  // whether the household is on a plan at all, and whether the operator's
  // seats have already funded the platform's cut of this fare.
  imports: [ConfigModule, BillingModule, TrackingModule],
  controllers: [
    CareController,
    MeController,
    PatientsController,
    ClinicsController,
    AppointmentsController,
    RidesController,
    NotificationsController,
    InvitationsController,
  ],
  providers: [
    CareService,
    PatientsService,
    ClinicsService,
    AppointmentsService,
    RidesService,
    RideSimulatorService,
    NotificationsService,
    PreferencesService,
    InvitationsService,
    DevicesService,
    NotificationDispatchService,
    GeocodingService,
    RemindersService,
  ],
  // AuthController returns a snapshot with the session, so it needs CareService.
  // RidesService is exported for DispatchModule: an operator decides *who*
  // drives, and the machine that decides what a ride may do next stays in one
  // place rather than being reimplemented on the dispatch side.
  exports: [CareService, InvitationsService, DevicesService, RidesService],
})
export class CareModule {}
