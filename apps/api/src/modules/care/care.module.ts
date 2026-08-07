import { Module } from '@nestjs/common';

import {
  AppointmentsController,
  CareController,
  ClinicsController,
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

@Module({
  controllers: [
    CareController,
    MeController,
    PatientsController,
    ClinicsController,
    AppointmentsController,
    RidesController,
    NotificationsController,
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
  ],
  // AuthController returns a snapshot with the session, so it needs CareService.
  exports: [CareService],
})
export class CareModule {}
