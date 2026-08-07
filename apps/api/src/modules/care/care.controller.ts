import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CareService } from './care.service';
import { PatientsService } from './patients.service';
import { ClinicsService } from './clinics.service';
import { AppointmentsService } from './appointments.service';
import { RidesService } from './rides.service';
import { RideSimulatorService } from './ride-simulator.service';
import { NotificationsService } from './notifications.service';
import { PreferencesService } from './preferences.service';
import type { CareStateDto } from './care.dto';
import { SavePatientDto, SetPermissionsDto } from './dto/patient.dto';
import { SaveClinicDto } from './dto/clinic.dto';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';
import {
  CancelRideDto,
  ReportLocationDto,
  RequestTransportDto,
  SetDelayDto,
} from './dto/ride.dto';
import { UpdatePreferencesDto } from './dto/preferences.dto';

/**
 * Every mutating route answers with the whole snapshot.
 *
 * One status change can touch a ride, the appointment it belongs to, and the
 * notification list at once. Returning a delta would make the client
 * responsible for reassembling those three into a consistent view — which is
 * how a UI drifts out of step with the server that is supposed to be
 * authoritative. The payload is small at family scale, and the client's state
 * is replaced wholesale rather than patched.
 */
@Controller('care')
export class CareController {
  constructor(private readonly care: CareService) {}

  @Get('state')
  async state(@CurrentUser() userId: string): Promise<CareStateDto> {
    return this.care.snapshot(userId);
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly care: CareService,
  ) {}

  @Patch('preferences')
  async update(
    @CurrentUser() userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<CareStateDto> {
    await this.preferences.update(userId, dto);
    return this.care.snapshot(userId);
  }
}

@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly care: CareService,
  ) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: SavePatientDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Put(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePatientDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.update(userId, id, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/archive')
  async archive(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.archive(userId, id, ctx);
    return this.care.snapshot(userId);
  }

  @Put(':id/permissions')
  async setPermissions(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPermissionsDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.setPermissions(userId, id, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/select')
  async select(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.patients.select(userId, id);
    return this.care.snapshot(userId);
  }
}

@Controller('clinics')
export class ClinicsController {
  constructor(
    private readonly clinics: ClinicsService,
    private readonly care: CareService,
  ) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: SaveClinicDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.clinics.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }
}

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly rides: RidesService,
    private readonly care: CareService,
  ) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateAppointmentDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.appointments.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/reschedule')
  async reschedule(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.appointments.reschedule(userId, id, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.appointments.cancel(userId, id, dto, ctx, (tx, rideId, reason) =>
      this.rides.cancelWithinTransaction(tx, rideId, reason),
    );
    return this.care.snapshot(userId);
  }
}

@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly simulator: RideSimulatorService,
    private readonly care: CareService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async request(
    @CurrentUser() userId: string,
    @Body() dto: RequestTransportDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.rides.requestTransport(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRideDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.rides.cancel(userId, id, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/delay')
  async delay(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDelayDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.rides.setDelay(userId, id, dto, ctx);
    return this.care.snapshot(userId);
  }

  /**
   * The batched-fallback location write. In production the driver app holds
   * this connection, and the server additionally verifies that the caller *is*
   * the driver currently assigned to this ride. Until the driver app exists,
   * `requestTransport` is the closest honest gate — and the freshness and
   * ride-state checks in `reportLocation` apply either way.
   */
  @Post(':id/location')
  async location(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportLocationDto,
  ): Promise<CareStateDto> {
    await this.care.requireRidePermission(userId, id, 'requestTransport');
    await this.prisma.$transaction((tx) =>
      this.rides.reportLocation(tx, id, dto, new Date()),
    );
    return this.care.snapshot(userId);
  }

  @Post(':id/preview/start')
  async startPreview(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.simulator.start(userId, id);
    return this.care.snapshot(userId);
  }

  @Post(':id/preview/stop')
  async stopPreview(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.simulator.stop(userId, id);
    return this.care.snapshot(userId);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly care: CareService,
  ) {}

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() userId: string): Promise<CareStateDto> {
    await this.notifications.markAllRead(userId);
    return this.care.snapshot(userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.notifications.markRead(userId, id);
    return this.care.snapshot(userId);
  }
}
