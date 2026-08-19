import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import type { DriverStatus } from '../../domain/driver-status';
import { DispatchService } from './dispatch.service';
import { DispatchQueueDto, DriverDto, VehicleDto } from './dispatch.dto';
import {
  AssignRideDto,
  CreateDriverDto,
  CreateVehicleDto,
  SetDriverStatusDto,
  SetShiftDto,
} from './dto/dispatch.request.dto';

/**
 * Everything a transport operator does, scoped by the organisation in the path.
 *
 * The scoping is the authorisation: no endpoint here takes a driver or ride id
 * as a capability. `requireMembership` runs first, and every row is then
 * checked against the organisation in the path — an id belonging to another
 * company answers 404, indistinguishable from one that does not exist.
 */
@ApiTags('dispatch')
@ApiBearerAuth('access-token')
@Controller('organizations/:organizationId')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  // ─── fleet ────────────────────────────────────────────────────────────────

  @Get('vehicles')
  @ApiOperation({ summary: "The operator's vehicles" })
  @ApiOkResponse({ type: [VehicleDto] })
  vehicles(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<VehicleDto[]> {
    return this.dispatch.vehicles(userId, organizationId);
  }

  @Post('vehicles')
  @Idempotent()
  @ApiOperation({ summary: 'Add a vehicle' })
  @ApiCreatedResponse({ type: VehicleDto })
  addVehicle(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: CreateVehicleDto,
    @Ctx() ctx: RequestContext,
  ): Promise<VehicleDto> {
    return this.dispatch.addVehicle(userId, organizationId, body, ctx);
  }

  // ─── roster ───────────────────────────────────────────────────────────────

  @Get('drivers')
  @ApiOperation({ summary: 'The roster, with who is billable and who is free' })
  @ApiOkResponse({ type: [DriverDto] })
  drivers(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<DriverDto[]> {
    return this.dispatch.drivers(userId, organizationId);
  }

  @Post('drivers')
  @Idempotent()
  @ApiOperation({
    summary: 'Add a driver',
    description:
      'Created as `invited`. The billable seat moves at approval, so a roster can be built without being charged for people who have not handed in a licence.',
  })
  @ApiCreatedResponse({ type: DriverDto })
  addDriver(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: CreateDriverDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DriverDto> {
    return this.dispatch.addDriver(userId, organizationId, body, ctx);
  }

  @Post('drivers/:driverId/status')
  @ApiOperation({
    summary: 'Move a driver through the lifecycle',
    description:
      'Crossing into or out of `approved` grants or releases a billable seat, in the same transaction as the status change.',
  })
  @ApiOkResponse({ type: DriverDto })
  setDriverStatus(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Body() body: SetDriverStatusDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DriverDto> {
    return this.dispatch.setDriverStatus(
      userId,
      organizationId,
      driverId,
      body.to as DriverStatus,
      body.reason,
      ctx,
    );
  }

  @Put('drivers/:driverId/shift')
  @ApiOperation({
    summary: 'Put a driver on or off shift',
    description:
      'A dispatcher may do this: they are the person who knows somebody called in sick, and waiting for an admin would leave the queue offering a driver who is not there.',
  })
  @ApiOkResponse({ type: DriverDto })
  setShift(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Body() body: SetShiftDto,
  ): Promise<DriverDto> {
    return this.dispatch.setShift(userId, organizationId, driverId, body.onShift);
  }

  // ─── the queue ────────────────────────────────────────────────────────────

  @Get('dispatch/queue')
  @ApiOperation({
    summary: 'Rides waiting for a car, ordered by when the car is needed',
    description:
      'Not by when the request arrived: a ride booked this morning for 4pm is not more urgent than one booked five minutes ago for 2pm.',
  })
  @ApiOkResponse({ type: DispatchQueueDto })
  queue(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<DispatchQueueDto> {
    return this.dispatch.queue(userId, organizationId);
  }

  @Post('dispatch/rides/:rideId/assign')
  @Idempotent()
  @ApiOperation({
    summary: 'Give a ride to a driver, or move it to another one',
    description:
      'Eligibility is asserted, not advised — a wheelchair trip cannot be given to a saloon car, and a driver cannot be given a second passenger. A reassignment requires a reason and passes through `reassignmentRequired`, so the family timeline records that the first driver dropped it.',
  })
  @ApiOkResponse({ type: DispatchQueueDto })
  assign(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() body: AssignRideDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DispatchQueueDto> {
    return this.dispatch.assign(userId, organizationId, rideId, body, ctx);
  }
}
