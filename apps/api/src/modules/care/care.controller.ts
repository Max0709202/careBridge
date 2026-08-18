import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

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
import { CareStateDto } from './care.dto';
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
import { InvitationsService } from './invitations.service';
import { RateLimit } from '../../common/rate-limit.guard';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationDto,
} from './dto/invitation.dto';
import { DevicesService } from './devices.service';
import {
  DeviceTokenDto,
  NotificationPreferenceDto,
  RegisterDeviceDto,
  SetNotificationPreferenceDto,
} from './dto/notification.dto';

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
@ApiTags('care')
@ApiBearerAuth('access-token')
@Controller('care')
export class CareController {
  constructor(private readonly care: CareService) {}

  @Get('state')
  @ApiOkResponse({ type: CareStateDto })
  async state(@CurrentUser() userId: string): Promise<CareStateDto> {
    return this.care.snapshot(userId);
  }
}

@ApiTags('me')
@ApiBearerAuth('access-token')
@Controller('me')
export class MeController {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly care: CareService,
    private readonly devices: DevicesService,
  ) {}

  @Patch('preferences')
  @ApiOperation({ summary: 'UI preferences: selected patient, simplified mode' })
  @ApiOkResponse({ type: CareStateDto })
  async update(
    @CurrentUser() userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<CareStateDto> {
    await this.preferences.update(userId, dto);
    return this.care.snapshot(userId);
  }

  // ─── devices ────────────────────────────────────────────────────────────

  @Get('devices')
  @ApiOkResponse({ type: [DeviceTokenDto] })
  @ApiOperation({
    summary: 'Devices registered for push',
    description:
      'The registration token itself is never returned — it is a capability to push to that device, and the list only needs to be recognisable.',
  })
  async listDevices(@CurrentUser() userId: string): Promise<DeviceTokenDto[]> {
    return this.devices.list(userId);
  }

  @Post('devices')
  @ApiOkResponse({ type: DeviceTokenDto })
  @ApiOperation({ summary: 'Register or refresh an FCM token for this device' })
  async registerDevice(
    @CurrentUser() userId: string,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceTokenDto> {
    return this.devices.register(userId, dto);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop pushing to a device' })
  async revokeDevice(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.devices.revoke(userId, id);
  }
}

@ApiTags('patients')
@ApiBearerAuth('access-token')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly care: CareService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  @ApiOkResponse({ type: CareStateDto })
  async create(
    @CurrentUser() userId: string,
    @Body() dto: SavePatientDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Put(':id')
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
  async archive(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.patients.archive(userId, id, ctx);
    return this.care.snapshot(userId);
  }

  @Put(':id/permissions')
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
  async select(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.patients.select(userId, id);
    return this.care.snapshot(userId);
  }

  // ─── invitations ────────────────────────────────────────────────────────

  @Get(':id/invitations')
  @ApiOkResponse({ type: [InvitationDto] })
  @ApiOperation({ summary: 'Invitations issued for this patient' })
  async listInvitations(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationDto[]> {
    return this.invitations.list(userId, id);
  }

  @Post(':id/invitations')
  @ApiOkResponse({ type: InvitationDto })
  @ApiOperation({
    summary: 'Invite someone into this patient’s care circle',
    description:
      'Requires manageAccess, a verified address on the inviter, and permissions no broader than the inviter’s own. The emailed link is single-use, expiring, and can only be accepted by a verified account with the invited address.',
  })
  async invite(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvitationDto,
    @Ctx() ctx: RequestContext,
  ): Promise<InvitationDto> {
    return this.invitations.invite(userId, id, dto, ctx);
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an invitation that has not been accepted' })
  async revokeInvitation(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.invitations.revoke(userId, id, invitationId, ctx);
  }
}

/**
 * Accepting an invitation is not a patient-scoped route, and cannot be: the
 * caller has no access to that patient yet, which is the whole point. It hangs
 * off `/invitations` so no route in `/patients/:id` has to make an exception
 * to the rule that every one of them resolves through a grant.
 */
@ApiTags('patients')
@ApiBearerAuth('access-token')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly care: CareService,
  ) {}

  // Authenticated, but the token in the body is a bearer credential in its
  // own right: it grants standing access to a vulnerable person's address and
  // daily movements, and any registered account may present one. Guessing is
  // counted like any other token guess.
  @RateLimit('tokenGuess')
  @Post('accept')
  @ApiCreatedResponse({ type: CareStateDto })
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'The signed-in account must be the invited address and must have verified it. Returns the full state snapshot, which now includes the newly shared patient.',
  })
  async accept(
    @CurrentUser() userId: string,
    @Body() dto: AcceptInvitationDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.invitations.accept(userId, dto.token, ctx);
    return this.care.snapshot(userId);
  }
}

@ApiTags('clinics')
@ApiBearerAuth('access-token')
@Controller('clinics')
export class ClinicsController {
  constructor(
    private readonly clinics: ClinicsService,
    private readonly care: CareService,
  ) {}

  @Post()
  @ApiOkResponse({ type: CareStateDto })
  async create(
    @CurrentUser() userId: string,
    @Body() dto: SaveClinicDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.clinics.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }
}

@ApiTags('appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly rides: RidesService,
    private readonly care: CareService,
  ) {}

  @Post()
  @ApiOkResponse({ type: CareStateDto })
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateAppointmentDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.appointments.create(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/reschedule')
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
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

@ApiTags('rides')
@ApiBearerAuth('access-token')
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly simulator: RideSimulatorService,
    private readonly care: CareService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOkResponse({ type: CareStateDto })
  async request(
    @CurrentUser() userId: string,
    @Body() dto: RequestTransportDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CareStateDto> {
    await this.rides.requestTransport(userId, dto, ctx);
    return this.care.snapshot(userId);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
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
  @ApiOkResponse({ type: CareStateDto })
  async startPreview(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.simulator.start(userId, id);
    return this.care.snapshot(userId);
  }

  @Post(':id/preview/stop')
  @ApiOkResponse({ type: CareStateDto })
  async stopPreview(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.simulator.stop(userId, id);
    return this.care.snapshot(userId);
  }
}

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly care: CareService,
  ) {}

  @Post('read-all')
  @HttpCode(200)
  @ApiOkResponse({ type: CareStateDto })
  async markAllRead(@CurrentUser() userId: string): Promise<CareStateDto> {
    await this.notifications.markAllRead(userId);
    return this.care.snapshot(userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOkResponse({ type: CareStateDto })
  async markRead(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CareStateDto> {
    await this.notifications.markRead(userId, id);
    return this.care.snapshot(userId);
  }

  // ─── per-channel preferences ────────────────────────────────────────────

  @Get('preferences')
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  @ApiOperation({
    summary: 'The full notification matrix',
    description:
      'Returned complete — defaults merged with the user’s changes — so the client never has to hold a second copy of the policy, which would be free to drift from the server’s.',
  })
  async listPreferences(
    @CurrentUser() userId: string,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notifications.preferences(userId);
  }

  @Put('preferences')
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  @ApiOperation({
    summary: 'Turn one channel on or off for one event kind',
    description:
      'Only email and push are configurable. In-app is the record of what happened and is always on.',
  })
  async setPreference(
    @CurrentUser() userId: string,
    @Body() dto: SetNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notifications.setPreference(userId, dto.kind, dto.channel, dto.enabled);
  }
}
