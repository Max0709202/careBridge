import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import { PlatformRoleGuard, RequiresPlatform } from '../admin/platform-role.guard';
import { MarketplaceService } from './marketplace.service';
import {
  BookingDto,
  CancellationQuoteDto,
  CaregiverCardDto,
  CaregiverProfileDto,
} from './marketplace.dto';
import {
  CancelBookingDto,
  CreateBookingDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
  ReviewBookingDto,
  SaveCaregiverProfileDto,
  SearchCaregiversDto,
} from './dto/marketplace.request.dto';

/**
 * The caregiver marketplace — Stage 5A.
 *
 * **Companion care, not clinical care**, and no claim anywhere that a platform
 * check makes anybody safe. What a family is shown is a sentence describing
 * what was checked and when, not a badge — see `CaregiverCardDto`.
 *
 * FOUNDATION gates Stage 5 on pilot evidence. This is built and behind a
 * feature flag rather than switched on: the code exists so the decision is
 * about the product rather than about the schedule.
 */
@ApiTags('marketplace')
@ApiBearerAuth('access-token')
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  // ─── finding somebody ─────────────────────────────────────────────────────

  @Get('caregivers')
  @ApiOperation({
    summary: 'Search bookable caregivers',
    description:
      'Ordered by a lower confidence bound on the rating, so a longer good record always outranks a shorter one and a single five-star review cannot reach the top. **Not** ordered by verification: ranking by it would be the platform asserting the safety claim it says it does not make.',
  })
  @ApiOkResponse({ type: [CaregiverCardDto] })
  search(@Query() query: SearchCaregiversDto): Promise<CaregiverCardDto[]> {
    return this.marketplace.search(query, new Date());
  }

  @Get('caregivers/:caregiverId')
  @ApiOperation({ summary: 'One caregiver, with their availability and reviews' })
  @ApiOkResponse({ type: CaregiverProfileDto })
  profile(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
  ): Promise<CaregiverProfileDto> {
    return this.marketplace.profile(caregiverId, new Date());
  }

  // ─── being one ────────────────────────────────────────────────────────────

  @Put('me')
  @ApiOperation({
    summary: 'Create or update your own listing',
    description:
      'Always lands as `applied`. There is deliberately no endpoint that marks somebody verified — one that could would be the most valuable thing in this module to find a flaw in.',
  })
  @ApiOkResponse({ type: CaregiverProfileDto })
  saveProfile(
    @CurrentUser() userId: string,
    @Body() body: SaveCaregiverProfileDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CaregiverProfileDto> {
    return this.marketplace.saveProfile(userId, body, ctx);
  }

  @Put('me/availability')
  @ApiOperation({
    summary: 'Replace your weekly availability',
    description:
      'Weekly rather than a list of dates: somebody who has to re-enter their availability every Sunday stops by the third week, and a marketplace of stale availability is a marketplace of dead ends.',
  })
  @ApiOkResponse({ type: CaregiverProfileDto })
  setAvailability(
    @CurrentUser() userId: string,
    @Body()
    body: {
      windows: {
        weekday: number;
        startMinute: number;
        endMinute: number;
        timeZone: string;
      }[];
    },
  ): Promise<CaregiverProfileDto> {
    return this.marketplace.setAvailability(userId, body.windows ?? []);
  }

  // ─── bookings ─────────────────────────────────────────────────────────────

  @Get('bookings')
  @ApiOperation({ summary: 'Everything you are part of, either side of it' })
  @ApiOkResponse({ type: [BookingDto] })
  bookings(@CurrentUser() userId: string): Promise<BookingDto[]> {
    return this.marketplace.bookings(userId);
  }

  @Post('bookings')
  @Idempotent()
  @ApiOperation({
    summary: 'Ask a caregiver for a visit',
    description:
      'Requires the same `requestTransport` grant that arranging a car does. Booking somebody to sit with a patient is at least as consequential, and a separate permission would mean two answers to “who may arrange care”.',
  })
  @ApiCreatedResponse({ type: BookingDto })
  book(
    @CurrentUser() userId: string,
    @Body() body: CreateBookingDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.book(userId, body, new Date(), ctx);
  }

  @Post('bookings/:bookingId/accept')
  @ApiOperation({ summary: 'The caregiver accepting' })
  @ApiOkResponse({ type: BookingDto })
  accept(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.respond(userId, bookingId, true, ctx);
  }

  @Post('bookings/:bookingId/decline')
  @ApiOperation({ summary: 'The caregiver declining' })
  @ApiOkResponse({ type: BookingDto })
  decline(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.respond(userId, bookingId, false, ctx);
  }

  @Get('bookings/:bookingId/cancellation-quote')
  @ApiOperation({
    summary: 'What cancelling would cost, before committing to it',
    description:
      'Free with more than a day’s notice; half after that, never the whole visit. A caregiver cancelling never charges the family.',
  })
  @ApiOkResponse({ type: CancellationQuoteDto })
  quote(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ): Promise<CancellationQuoteDto> {
    return this.marketplace.cancellationQuote(userId, bookingId, new Date());
  }

  @Post('bookings/:bookingId/cancel')
  @ApiOperation({ summary: 'Call it off' })
  @ApiOkResponse({ type: BookingDto })
  cancel(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: CancelBookingDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.cancel(userId, bookingId, body, new Date(), ctx);
  }

  @Post('bookings/:bookingId/check-in')
  @ApiOperation({ summary: 'The caregiver arriving' })
  @ApiOkResponse({ type: BookingDto })
  checkIn(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.checkIn(userId, bookingId, new Date(), ctx);
  }

  @Post('bookings/:bookingId/check-out')
  @ApiOperation({
    summary: 'The caregiver leaving, and the moment the money is decided',
    description:
      'Charged from the checked times rather than the booked window, rounded up to a quarter-hour: a visit that ran twenty minutes over is twenty minutes of somebody’s afternoon, and rounding down would have a caregiver work fourteen minutes for nothing.',
  })
  @ApiOkResponse({ type: BookingDto })
  checkOut(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.checkOut(userId, bookingId, new Date(), ctx);
  }

  @Post('bookings/:bookingId/no-show')
  @ApiOperation({
    summary: 'Nobody came',
    description:
      'Reported by the family only. A caregiver marking their own booking as a no-show would be marking the family.',
  })
  @ApiOkResponse({ type: BookingDto })
  noShow(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.markNoShow(userId, bookingId, ctx);
  }

  // ─── afterwards ───────────────────────────────────────────────────────────

  @Post('bookings/:bookingId/review')
  @ApiOperation({
    summary: 'Rate a visit that happened',
    description:
      'Only a completed booking, and only once. A marketplace where a cancelled engagement can be rated is one where a family who never met somebody can end their career.',
  })
  @ApiOkResponse({ type: BookingDto })
  review(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: ReviewBookingDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.review(userId, bookingId, body, ctx);
  }

  @Post('bookings/:bookingId/dispute')
  @ApiOperation({ summary: 'Raise a disagreement about a visit' })
  @ApiOkResponse({ type: BookingDto })
  dispute(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: RaiseDisputeDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.raiseDispute(userId, bookingId, body, ctx);
  }
}

/**
 * Deciding a dispute.
 *
 * A separate controller so the platform guard applies to it and to nothing
 * else in the marketplace. A dispute decides whether money moves and whether
 * somebody keeps working here, so it is not left to either party.
 */
@ApiTags('marketplace')
@ApiBearerAuth('access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/marketplace')
export class MarketplaceAdminController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post('bookings/:bookingId/dispute/resolve')
  @RequiresPlatform('admin')
  @ApiOperation({
    summary: 'Decide a dispute',
    description:
      'Names an outcome, a reason and a person — enforced by a check constraint as well as here. A decision with none of those is one nobody can defend when the same question is asked again.',
  })
  @ApiOkResponse({ type: BookingDto })
  resolve(
    @CurrentUser() userId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: ResolveDisputeDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BookingDto> {
    return this.marketplace.resolveDispute(userId, bookingId, body, ctx);
  }
}
