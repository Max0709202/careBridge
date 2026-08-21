import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import { ClinicPortalService } from './clinic.service';
import { ClinicDayDto, ClinicSiteDto, ExpectedArrivalDto } from './clinic.dto';
import { ClaimClinicDto, ClinicDayQueryDto } from './dto/clinic.request.dto';

/**
 * The clinic portal.
 *
 * Scoped by an organisation of kind `clinicNetwork`, and every appointment is
 * checked against a site that organisation has **claimed**. The claim is the
 * authorisation: no endpoint here takes an appointment id as a capability, and
 * a transport operator's dispatcher pointing this at their own organisation id
 * gets the same refusal a stranger does.
 *
 * What a clinic is shown is deliberately narrow — a name, a time, and whether
 * a car is coming. Not a home address, not a telephone number, not a care
 * circle. A clinic knows a great deal about its own patients; this portal must
 * not become a second route into a *family's* record of somebody.
 */
@ApiTags('clinic')
@ApiBearerAuth('access-token')
@Controller('organizations/:organizationId/clinic')
export class ClinicController {
  constructor(private readonly portal: ClinicPortalService) {}

  @Get('sites')
  @ApiOperation({ summary: 'The sites this network has claimed' })
  @ApiOkResponse({ type: [ClinicSiteDto] })
  sites(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<ClinicSiteDto[]> {
    return this.portal.sites(userId, organizationId);
  }

  @Post('sites/:clinicId/claim')
  @ApiOperation({
    summary: 'Attach an existing clinic record to this network',
    description:
      'A claim rather than a creation: the record was almost certainly typed by a family saying where their relative’s appointment is. Restricted to an admin and audited, because claiming a site grants sight of every appointment anybody has ever booked there.',
  })
  @ApiOkResponse({ type: [ClinicSiteDto] })
  claim(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('clinicId', ParseUUIDPipe) clinicId: string,
    @Body() body: ClaimClinicDto,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSiteDto[]> {
    return this.portal.claim(userId, organizationId, clinicId, body.note ?? null, ctx);
  }

  @Get('day')
  @ApiOperation({
    summary: 'Everybody expected today, and where their car is',
    description:
      'The date is resolved in the **clinic’s** own zone rather than the server’s. A portal that showed yesterday’s list to a west-coast clinic every morning would be useless by nine o’clock.',
  })
  @ApiOkResponse({ type: ClinicDayDto })
  day(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ClinicDayQueryDto,
  ): Promise<ClinicDayDto> {
    return this.portal.day(userId, organizationId, query, new Date());
  }

  @Post('appointments/:appointmentId/check-in')
  @Idempotent()
  @ApiOperation({
    summary: 'The patient walked in',
    description:
      'Never inferred from the ride completing. A completed ride says a car reached an address; this says somebody inside the building saw them, and the gap between the two is an eighty-year-old at the wrong entrance of a hospital.',
  })
  @ApiOkResponse({ type: ExpectedArrivalDto })
  checkIn(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<ExpectedArrivalDto> {
    return this.portal.checkIn(userId, organizationId, appointmentId, ctx);
  }

  @Post('appointments/:appointmentId/ready')
  @Idempotent()
  @ApiOperation({
    summary: 'The visit is over — send the car',
    description:
      'What a `flexibleReturn` ride has been waiting for since it was booked. Nobody knows when a cardiology follow-up will finish, which is why the return leg is created without a time; this is the thing that tells it the time has come.',
  })
  @ApiOkResponse({ type: ExpectedArrivalDto })
  ready(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<ExpectedArrivalDto> {
    return this.portal.readyForReturn(userId, organizationId, appointmentId, ctx);
  }
}
