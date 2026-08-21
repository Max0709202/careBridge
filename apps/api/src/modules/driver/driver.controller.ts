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
import type { RideStatus } from '../../domain/ride-status';
import { DriverService } from './driver.service';
import {
  DriverDocumentsDto,
  DriverProfileDto,
  DriverRideDto,
  LocationBatchResultDto,
} from './driver.dto';
import { PresignedUploadDto } from '../dispatch/dispatch.dto';
import { RequestDocumentUploadDto } from '../dispatch/dto/dispatch.request.dto';
import type { DriverDocumentKind } from '../../domain/driver-documents';
import {
  AdvanceRideDto,
  ConfirmDocumentUploadDto,
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

  // ─── paperwork ────────────────────────────────────────────────────────────

  @Get('documents')
  @ApiOperation({
    summary: 'What has been handed in, and what is still wanted',
    description:
      'Includes the rejection note. Being told “you cannot drive” without being told which document and why is how somebody re-uploads the same unreadable photograph three times.',
  })
  @ApiOkResponse({ type: DriverDocumentsDto })
  async documents(@CurrentUser() userId: string): Promise<DriverDocumentsDto> {
    const { state, documents } = await this.driver.documents(userId);
    return {
      compliant: state.compliant,
      missing: [...state.missing],
      expiringSoon: [...state.expiringSoon],
      documents: documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        status: document.status,
        contentType: document.contentType,
        byteSize: document.byteSize,
        expiresAt: document.expiresAt?.toISOString() ?? null,
        submittedAt: document.submittedAt?.toISOString() ?? null,
        reviewedAt: document.reviewedAt?.toISOString() ?? null,
        reviewNote: document.reviewNote,
        superseded: document.supersededAt !== null,
      })),
    };
  }

  @Post('documents')
  @ApiOperation({
    summary: 'Authorise one upload',
    description:
      'Returns a URL to PUT the file to. The bytes never pass through this API — a multipart body would be a copy of the file in the heap of a process that is also holding a WebSocket open for every live ride, and an API that can stream any object is an API where one bug hands over the bucket.',
  })
  @ApiCreatedResponse({ type: PresignedUploadDto })
  requestUpload(
    @CurrentUser() userId: string,
    @Body() body: RequestDocumentUploadDto,
    @Ctx() ctx: RequestContext,
  ): Promise<PresignedUploadDto> {
    return this.driver.requestDocumentUpload(
      userId,
      {
        kind: body.kind as DriverDocumentKind,
        contentType: body.contentType,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      ctx,
    );
  }

  @Post('documents/confirm')
  @ApiOperation({
    summary: 'Say the upload finished',
    description:
      'The server checks storage rather than believing the client. A client reporting its own success could report it without uploading, and an operator would then see a complete file with an empty object behind it.',
  })
  @ApiOkResponse({ type: DriverDocumentsDto })
  async confirmUpload(
    @CurrentUser() userId: string,
    @Body() body: ConfirmDocumentUploadDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DriverDocumentsDto> {
    await this.driver.confirmDocumentUpload(userId, body.documentId, ctx);
    return this.documents(userId);
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
