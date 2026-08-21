import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CareService } from '../care/care.service';
import { AuthorizationError, ValidationError } from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import {
  CAREGIVER_COMMISSION_BASIS_POINTS,
  assertBookable,
  assertBookingTransition,
  billableMinutes,
  cancellationFee,
  chargeFor,
  holdsTheSlot,
  type BookingStatus,
} from '../../domain/caregiver-booking';
import {
  compareForSearch,
  isBookable,
  reputationOf,
  reviewIsEligible,
  verificationDisplay,
} from '../../domain/caregiver-reputation';
import type {
  BookingDto,
  CancellationQuoteDto,
  CaregiverCardDto,
  CaregiverProfileDto,
} from './marketplace.dto';
import type {
  CancelBookingDto,
  CreateBookingDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
  ReviewBookingDto,
  SaveCaregiverProfileDto,
  SearchCaregiversDto,
} from './dto/marketplace.request.dto';

const CARD_INCLUDE = {
  reviews: { select: { rating: true } },
} satisfies Prisma.CaregiverInclude;

const BOOKING_INCLUDE = {
  caregiver: { select: { id: true, displayName: true, userId: true } },
  patient: { select: { preferredName: true } },
  review: { select: { id: true } },
  dispute: { select: { id: true, status: true } },
} satisfies Prisma.CaregiverBookingInclude;

type BookingRow = Prisma.CaregiverBookingGetPayload<{
  include: typeof BOOKING_INCLUDE;
}>;

/**
 * The caregiver marketplace — Stage 5A.
 *
 * **Companion care, not clinical care.** Nothing here records a treatment, a
 * medication or a condition, and nothing should be added that does.
 *
 * The authorisation model is the same one the rest of the product uses and is
 * worth stating because a marketplace makes it easy to forget: a family member
 * may only book for a patient they hold a `requestTransport` grant on, and a
 * caregiver may only act on bookings that name them. There is no endpoint here
 * that takes a patient id as a capability.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly audit: AuditService,
  ) {}

  // ─── finding somebody ─────────────────────────────────────────────────────

  async search(query: SearchCaregiversDto, now: Date): Promise<CaregiverCardDto[]> {
    const rows = await this.prisma.caregiver.findMany({
      where: {
        // Only `verified` is bookable, so only `verified` is findable. A
        // profile nobody may book is a dead end with somebody's photograph on
        // it.
        status: 'verified',
        ...(query.city
          ? { serviceAreaCity: { equals: query.city, mode: 'insensitive' } }
          : {}),
        ...(query.state
          ? { serviceAreaState: { equals: query.state, mode: 'insensitive' } }
          : {}),
        ...(query.language ? { languages: { has: query.language } } : {}),
        ...(query.maxHourlyRateCents
          ? { hourlyRateCents: { lte: query.maxHourlyRateCents } }
          : {}),
      },
      include: CARD_INCLUDE,
      take: 100,
    });

    return rows
      .map((row) => this.toCard(row, now))
      .sort((a, b) =>
        compareForSearch(
          {
            reviewCount: a.reviewCount,
            rawAverage: a.rawAverage,
            rating: a.rating,
            hasEnoughReviews: true,
          },
          {
            reviewCount: b.reviewCount,
            rawAverage: b.rawAverage,
            rating: b.rating,
            hasEnoughReviews: true,
          },
        ),
      );
  }

  async profile(caregiverId: string, now: Date): Promise<CaregiverProfileDto> {
    const row = await this.prisma.caregiver.findUnique({
      where: { id: caregiverId },
      include: {
        ...CARD_INCLUDE,
        availability: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      },
    });
    if (!row || !isBookable(row.status)) {
      throw new AuthorizationError();
    }

    const reviews = await this.prisma.caregiverReview.findMany({
      where: { caregiverId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      ...this.toCard(row, now),
      availability: row.availability.map((window) => ({
        weekday: window.weekday,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        timeZone: window.timeZone,
      })),
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        // The comment, not its author. A family reading reviews does not need
        // to know which other family wrote one.
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  // ─── being a caregiver ────────────────────────────────────────────────────

  /**
   * Creates or updates the caller's own listing.
   *
   * Always lands as `applied`, never `verified`. Verification is a thing
   * CareBridge does out of band — there is deliberately no endpoint that
   * verifies somebody, because an endpoint that can mark a caregiver verified
   * is the most valuable thing in this module to find a flaw in.
   */
  async saveProfile(
    userId: string,
    input: SaveCaregiverProfileDto,
    ctx: RequestContext,
  ): Promise<CaregiverProfileDto> {
    const caregiverId = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.caregiver.findUnique({ where: { userId } });

      const data = {
        displayName: input.displayName.trim(),
        bio: input.bio.trim(),
        yearsExperience: input.yearsExperience,
        languages: input.languages.map((language) => language.trim()).filter(Boolean),
        hourlyRateCents: input.hourlyRateCents,
        serviceAreaCity: input.serviceAreaCity.trim(),
        serviceAreaState: input.serviceAreaState.trim().toUpperCase(),
      };

      const saved = existing
        ? await tx.caregiver.update({ where: { userId }, data })
        : await tx.caregiver.create({ data: { ...data, userId, status: 'applied' } });

      await this.audit.record(
        {
          actorUserId: userId,
          action: existing
            ? 'marketplace.profile_updated'
            : 'marketplace.profile_created',
          entityType: 'Caregiver',
          entityId: saved.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: Object.keys(data),
        },
        tx,
      );

      return saved.id;
    });

    // Read back through the caller's own view rather than the public one: an
    // applied caregiver cannot see themselves through `profile`, which refuses
    // anybody not yet bookable.
    return this.ownProfile(userId, new Date(), caregiverId);
  }

  private async ownProfile(
    userId: string,
    now: Date,
    caregiverId: string,
  ): Promise<CaregiverProfileDto> {
    const row = await this.prisma.caregiver.findUniqueOrThrow({
      where: { id: caregiverId },
      include: {
        ...CARD_INCLUDE,
        availability: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      },
    });
    void userId;

    return {
      ...this.toCard(row, now),
      availability: row.availability.map((window) => ({
        weekday: window.weekday,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        timeZone: window.timeZone,
      })),
      reviews: [],
    };
  }

  async setAvailability(
    userId: string,
    windows: readonly {
      weekday: number;
      startMinute: number;
      endMinute: number;
      timeZone: string;
    }[],
  ): Promise<CaregiverProfileDto> {
    const caregiver = await this.requireCaregiver(userId);

    await this.prisma.$transaction(async (tx) => {
      // Replaced wholesale rather than merged. A weekly calendar is a small
      // thing somebody edits as a whole, and merging would leave a window
      // nobody meant to keep.
      await tx.caregiverAvailability.deleteMany({
        where: { caregiverId: caregiver.id },
      });
      if (windows.length > 0) {
        await tx.caregiverAvailability.createMany({
          data: windows.map((window) => ({ ...window, caregiverId: caregiver.id })),
        });
      }
    });

    return this.ownProfile(userId, new Date(), caregiver.id);
  }

  // ─── booking ──────────────────────────────────────────────────────────────

  async book(
    userId: string,
    input: CreateBookingDto,
    now: Date,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    // The same grant that lets somebody arrange transport. Booking a person to
    // sit with a patient is at least as consequential, and inventing a
    // separate permission would mean two answers to "who may arrange care".
    await this.care.requirePermission(userId, input.patientId, 'requestTransport');

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    const booking = await this.prisma.$transaction(async (tx) => {
      const caregiver = await tx.caregiver.findUnique({
        where: { id: input.caregiverId },
      });
      if (!caregiver || !isBookable(caregiver.status)) {
        throw new AuthorizationError();
      }

      const existing = await tx.caregiverBooking.findMany({
        where: {
          caregiverId: caregiver.id,
          status: { in: ['requested', 'confirmed', 'inProgress'] },
          endsAt: { gt: now },
        },
        select: { startsAt: true, endsAt: true, status: true },
      });

      assertBookable(
        { startsAt, endsAt },
        existing.map((row) => ({ ...row, status: row.status })),
        now,
      );

      const created = await tx.caregiverBooking.create({
        data: {
          caregiverId: caregiver.id,
          patientId: input.patientId,
          bookedByUserId: userId,
          startsAt,
          endsAt,
          // Stamped now, not read at completion. A caregiver raising their
          // price must not re-price work somebody has already agreed to.
          hourlyRateCents: caregiver.hourlyRateCents,
          commissionBasisPoints: CAREGIVER_COMMISSION_BASIS_POINTS,
          status: 'requested',
        },
        include: BOOKING_INCLUDE,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'marketplace.booking_requested',
          entityType: 'CaregiverBooking',
          entityId: created.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return created;
    });

    return toBookingDto(booking);
  }

  /** The caregiver accepting. */
  async respond(
    userId: string,
    bookingId: string,
    accept: boolean,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const caregiver = await this.requireCaregiver(userId);

    return this.moveBooking(
      bookingId,
      accept ? 'confirmed' : 'cancelledByCaregiver',
      userId,
      ctx,
      (booking) => {
        if (booking.caregiverId !== caregiver.id) throw new AuthorizationError();
      },
      accept ? {} : { cancellationReason: 'The caregiver could not take it.' },
    );
  }

  /** What cancelling would cost, before anybody commits to it. */
  async cancellationQuote(
    userId: string,
    bookingId: string,
    now: Date,
  ): Promise<CancellationQuoteDto> {
    const booking = await this.requireBookingParticipant(userId, bookingId);
    const by = booking.bookedByUserId === userId ? 'family' : 'caregiver';

    return cancellationFee({
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      hourlyRateCents: booking.hourlyRateCents,
      now,
      by,
    });
  }

  async cancel(
    userId: string,
    bookingId: string,
    input: CancelBookingDto,
    now: Date,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const booking = await this.requireBookingParticipant(userId, bookingId);
    const isFamily = booking.bookedByUserId === userId;

    const quote = cancellationFee({
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      hourlyRateCents: booking.hourlyRateCents,
      now,
      by: isFamily ? 'family' : 'caregiver',
    });

    return this.moveBooking(
      bookingId,
      isFamily ? 'cancelledByFamily' : 'cancelledByCaregiver',
      userId,
      ctx,
      () => undefined,
      {
        cancellationReason: input.reason.trim(),
        cancelledAt: now,
        // The late-cancellation fee is recorded on the booking rather than
        // charged here. Taking money needs the billing module and an invoice;
        // what this owes is a truthful record of what was agreed.
        totalCents: quote.feeCents > 0 ? quote.feeCents : null,
      },
    );
  }

  /** The caregiver arriving. */
  async checkIn(
    userId: string,
    bookingId: string,
    now: Date,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const caregiver = await this.requireCaregiver(userId);

    return this.moveBooking(
      bookingId,
      'inProgress',
      userId,
      ctx,
      (booking) => {
        if (booking.caregiverId !== caregiver.id) throw new AuthorizationError();
      },
      { checkedInAt: now },
    );
  }

  /**
   * The caregiver leaving, and the moment the money is decided.
   *
   * Computed from the checked times rather than the booked window: a visit
   * that ran twenty minutes over is twenty minutes of somebody's afternoon,
   * and one that ended early should not be charged for time nobody spent.
   */
  async checkOut(
    userId: string,
    bookingId: string,
    now: Date,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const caregiver = await this.requireCaregiver(userId);

    return this.moveBooking(
      bookingId,
      'completed',
      userId,
      ctx,
      (booking) => {
        if (booking.caregiverId !== caregiver.id) throw new AuthorizationError();
        if (!booking.checkedInAt) {
          throw new ValidationError('Check in before checking out.');
        }
      },
      undefined,
      (booking) => {
        const minutes = billableMinutes({
          checkedInAt: booking.checkedInAt!,
          checkedOutAt: now,
        });
        const charge = chargeFor({
          minutes,
          hourlyRateCents: booking.hourlyRateCents,
          commissionBasisPoints: booking.commissionBasisPoints,
        });

        return {
          checkedOutAt: now,
          billableMinutes: charge.billableMinutes,
          totalCents: charge.totalCents,
          platformFeeCents: charge.platformFeeCents,
          caregiverPayoutCents: charge.caregiverPayoutCents,
        };
      },
    );
  }

  /** Nobody came. */
  async markNoShow(
    userId: string,
    bookingId: string,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const booking = await this.requireBookingParticipant(userId, bookingId);
    if (booking.bookedByUserId !== userId) {
      // Only the family reports a no-show. A caregiver who did not turn up
      // marking their own booking as a no-show would be marking the family.
      throw new AuthorizationError();
    }

    return this.moveBooking(bookingId, 'noShow', userId, ctx, () => undefined);
  }

  // ─── afterwards ───────────────────────────────────────────────────────────

  async review(
    userId: string,
    bookingId: string,
    input: ReviewBookingDto,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const booking = await this.requireBookingParticipant(userId, bookingId);

    if (booking.bookedByUserId !== userId) throw new AuthorizationError();
    if (!reviewIsEligible(booking.status)) {
      // A marketplace where a cancelled engagement can be rated is one where a
      // family who never met somebody can end their career.
      throw new ValidationError('Only a visit that happened can be reviewed.');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.caregiverReview.findUnique({ where: { bookingId } });
      if (existing) throw new ValidationError('That visit has already been reviewed.');

      await tx.caregiverReview.create({
        data: {
          bookingId,
          caregiverId: booking.caregiverId,
          rating: input.rating,
          comment: input.comment?.trim() || null,
          authorUserId: userId,
        },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'marketplace.review_written',
          entityType: 'CaregiverBooking',
          entityId: bookingId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['rating'],
        },
        tx,
      );
    });

    return toBookingDto(await this.loadBooking(bookingId));
  }

  async raiseDispute(
    userId: string,
    bookingId: string,
    input: RaiseDisputeDto,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    const booking = await this.requireBookingParticipant(userId, bookingId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bookingDispute.findUnique({ where: { bookingId } });
      if (existing) throw new ValidationError('That visit is already in dispute.');

      await tx.bookingDispute.create({
        data: { bookingId, raisedByUserId: userId, reason: input.reason.trim() },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'marketplace.dispute_raised',
          entityType: 'CaregiverBooking',
          entityId: bookingId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      void booking;
    });

    return toBookingDto(await this.loadBooking(bookingId));
  }

  /**
   * Somebody at CareBridge deciding.
   *
   * Restricted to platform staff by the controller. A dispute decides whether
   * money moves and whether somebody keeps working here, so it is not left to
   * either party — and it names its reason, because the same question will be
   * asked again.
   */
  async resolveDispute(
    actorUserId: string,
    bookingId: string,
    input: ResolveDisputeDto,
    ctx: RequestContext,
  ): Promise<BookingDto> {
    await this.prisma.$transaction(async (tx) => {
      const dispute = await tx.bookingDispute.findUnique({ where: { bookingId } });
      if (!dispute) throw new AuthorizationError();
      if (dispute.status !== 'open') {
        throw new ValidationError('That dispute has already been decided.');
      }

      await tx.bookingDispute.update({
        where: { bookingId },
        data: {
          status: 'resolved',
          outcome: input.outcome as 'upheld' | 'refunded' | 'waived',
          resolutionNote: input.note.trim(),
          resolvedByUserId: actorUserId,
          resolvedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: `marketplace.dispute_${input.outcome}`,
          entityType: 'CaregiverBooking',
          entityId: bookingId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['status', 'outcome'],
        },
        tx,
      );
    });

    return toBookingDto(await this.loadBooking(bookingId));
  }

  // ─── lists ────────────────────────────────────────────────────────────────

  /** Everything the caller is part of, either side of the arrangement. */
  async bookings(userId: string): Promise<BookingDto[]> {
    const caregiver = await this.prisma.caregiver.findUnique({ where: { userId } });

    const rows = await this.prisma.caregiverBooking.findMany({
      where: {
        OR: [
          { bookedByUserId: userId },
          ...(caregiver ? [{ caregiverId: caregiver.id }] : []),
        ],
      },
      include: BOOKING_INCLUDE,
      orderBy: { startsAt: 'desc' },
      take: 100,
    });

    return rows.map(toBookingDto);
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async requireCaregiver(userId: string) {
    const caregiver = await this.prisma.caregiver.findUnique({ where: { userId } });
    if (!caregiver) throw new AuthorizationError();
    return caregiver;
  }

  private async loadBooking(bookingId: string): Promise<BookingRow> {
    return this.prisma.caregiverBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
  }

  /**
   * The booking, if the caller is one of the two parties.
   *
   * Family or caregiver and nobody else. A booking id is not a capability:
   * it appears in a URL and a notification, and treating possession of one as
   * permission would make both a disclosure.
   */
  private async requireBookingParticipant(
    userId: string,
    bookingId: string,
  ): Promise<BookingRow> {
    const booking = await this.loadBooking(bookingId).catch(() => null);
    if (!booking) throw new AuthorizationError();

    const isFamily = booking.bookedByUserId === userId;
    const isCaregiver = booking.caregiver.userId === userId;
    if (!isFamily && !isCaregiver) throw new AuthorizationError();

    return booking;
  }

  private async moveBooking(
    bookingId: string,
    to: BookingStatus,
    actorUserId: string,
    ctx: RequestContext,
    guard: (booking: BookingRow) => void,
    extra?: Prisma.CaregiverBookingUpdateInput,
    derive?: (booking: BookingRow) => Prisma.CaregiverBookingUpdateInput,
  ): Promise<BookingDto> {
    await this.prisma.$transaction(async (tx) => {
      const booking = await tx.caregiverBooking.findUnique({
        where: { id: bookingId },
        include: BOOKING_INCLUDE,
      });
      if (!booking) throw new AuthorizationError();

      guard(booking);
      assertBookingTransition(booking.status, to);

      await tx.caregiverBooking.update({
        where: { id: bookingId },
        data: { status: to, ...(extra ?? {}), ...(derive ? derive(booking) : {}) },
      });

      await this.audit.record(
        {
          actorUserId,
          action: `marketplace.booking_${to}`,
          entityType: 'CaregiverBooking',
          entityId: bookingId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    return toBookingDto(await this.loadBooking(bookingId));
  }

  private toCard(
    row: Prisma.CaregiverGetPayload<{ include: typeof CARD_INCLUDE }>,
    now: Date,
  ): CaregiverCardDto {
    const reputation = reputationOf(row.reviews.map((review) => review.rating));
    const verification = verificationDisplay(
      {
        identityVerifiedAt: row.identityVerifiedAt,
        backgroundCheckAt: row.backgroundCheckAt,
      },
      now,
    );

    return {
      id: row.id,
      displayName: row.displayName,
      bio: row.bio,
      yearsExperience: row.yearsExperience,
      languages: row.languages,
      hourlyRateCents: row.hourlyRateCents,
      serviceArea: `${row.serviceAreaCity}, ${row.serviceAreaState}`,
      status: row.status,
      // Withheld until there are enough reviews to mean something. A number
      // from one opinion looks exactly like a number from a hundred.
      rating: reputation.hasEnoughReviews ? reputation.rating : null,
      rawAverage: reputation.hasEnoughReviews ? reputation.rawAverage : null,
      reviewCount: reputation.reviewCount,
      verificationStatement: verification.statement,
      identityConfirmed: verification.identityConfirmed,
      backgroundCheckRun: verification.backgroundCheckRun,
      backgroundCheckAgeDays: verification.backgroundCheckAgeDays,
    };
  }
}

function toBookingDto(row: BookingRow): BookingDto {
  return {
    id: row.id,
    caregiverId: row.caregiverId,
    caregiverName: row.caregiver.displayName,
    patientId: row.patientId,
    patientName: row.patient.preferredName,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    hourlyRateCents: row.hourlyRateCents,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
    billableMinutes: row.billableMinutes,
    totalCents: row.totalCents,
    caregiverPayoutCents: row.caregiverPayoutCents,
    cancellationReason: row.cancellationReason,
    hasReview: row.review !== null,
    hasOpenDispute: row.dispute?.status === 'open',
  };
}

/** Re-exported so the controller can name it without a second import path. */
export { holdsTheSlot };
