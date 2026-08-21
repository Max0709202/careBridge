import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import type { RideStatus } from '../../domain/ride-status';
import { DriverService } from './driver.service';
import { DriverProfileDto, DriverRideDto, LocationBatchResultDto } from './driver.dto';
import {
  AdvanceRideDto,
  DriverShiftDto,
  ReportLocationBatchDto,
} from './dto/driver.request.dto';

/**
 * The driver app's whole API surface.
 *
 * Note what is missing from every path: a driver id. A driver acts as
 * themselves, resolved from the token, and only on rides that already name
 * them — so there is no identifier here that could be swapped for a
 * colleague's. The operator surface is the mirror image, scoped by an
 * organisation in the path, and the two authorisation models are kept apart on
 * purpose rather than sharing a controller that would have to do both.
 */
@ApiTags('driver')
@ApiBearerAuth('access-token')
@Controller('driver')
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in driver, claiming their roster place on first use',
    description:
      'A driver is added to a roster before they have an account. This is where the two are joined — by matching the address the operator recorded against a **verified** address on the account, because an unverified match would let anyone who knows a driver’s email inherit their assignments.',
  })
  @ApiOkResponse({ type: DriverProfileDto })
  me(@CurrentUser() userId: string): Promise<DriverProfileDto> {
    return this.driver.profile(userId);
  }

  @Put('shift')
  @ApiOperation({
    summary: 'Start or end a shift',
    description:
      'Refuses to end one mid-trip: dispatch reads “on shift” to decide who can be offered the next job, and a driver who leaves that list while carrying somebody is a passenger nobody is accountable for.',
  })
  @ApiOkResponse({ type: DriverProfileDto })
  setShift(
    @CurrentUser() userId: string,
    @Body() body: DriverShiftDto,
  ): Promise<DriverProfileDto> {
    return this.driver.setShift(userId, body.onShift);
  }

  @Get('rides')
  @ApiOperation({
    summary: 'The work still to do, soonest first',
    description:
      'Not a history. A finished ride leaves this list and takes the passenger’s address and telephone number with it — the record of who was carried where belongs to the operator, not to a phone in a glovebox.',
  })
  @ApiOkResponse({ type: [DriverRideDto] })
  rides(@CurrentUser() userId: string): Promise<DriverRideDto[]> {
    return this.driver.rides(userId);
  }

  @Post('rides/:rideId/advance')
  @Idempotent()
  @ApiOperation({
    summary: 'Move a ride to its next state',
    description:
      'Only the driver’s own moves. Accepting requires an approved driver on shift; finishing a trip already begun requires neither, because a driver suspended mid-journey still has somebody in the car.',
  })
  @ApiOkResponse({ type: DriverRideDto })
  advance(
    @CurrentUser() userId: string,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() body: AdvanceRideDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DriverRideDto> {
    return this.driver.advance(
      userId,
      rideId,
      body.to as RideStatus,
      body.reason ?? null,
      ctx,
    );
  }

  @Post('rides/:rideId/locations')
  @ApiOperation({
    summary: 'Flush the offline queue',
    description:
      'Safe to send twice: one device takes one reading per instant, so a retry after a lost response inserts nothing. Readings too old to present as current are still kept as journey history — they simply do not move the position the family is watching.',
  })
  @ApiOkResponse({ type: LocationBatchResultDto })
  reportLocations(
    @CurrentUser() userId: string,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() body: ReportLocationBatchDto,
  ): Promise<LocationBatchResultDto> {
    return this.driver.reportLocations(userId, rideId, body.points, new Date());
  }
}
