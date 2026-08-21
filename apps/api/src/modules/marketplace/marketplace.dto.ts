import { ApiProperty } from '@nestjs/swagger';

import { BOOKING_STATUSES } from '../../domain/caregiver-booking';
import { CAREGIVER_STATUSES } from '../../domain/caregiver-reputation';

/**
 * The marketplace wire contract.
 *
 * The shape of `CaregiverCardDto` is the product position made concrete.
 * `verificationStatement` is a **sentence**, not a badge, and there is no
 * boolean called `isVerified` for a UI to render as a tick. A family choosing
 * somebody to sit with their mother is entitled to know exactly how much of
 * the checking the platform did, and a green tick is the opposite of that.
 */

export class CaregiverCardDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;

  @ApiProperty({
    type: String,
    description: 'First name and last initial. Never a full legal name.',
  })
  displayName!: string;

  @ApiProperty({ type: String }) bio!: string;
  @ApiProperty({ type: 'integer' }) yearsExperience!: number;
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty({ type: 'integer' }) hourlyRateCents!: number;
  @ApiProperty({ type: String }) serviceArea!: string;

  @ApiProperty({ enum: CAREGIVER_STATUSES, enumName: 'CaregiverStatus' })
  status!: string;

  @ApiProperty({
    type: Number,
    format: 'float',
    nullable: true,
    description:
      'Pulled towards a prior, so one bad review cannot halve a career. Null until there are enough reviews to say anything — a number from one opinion looks exactly like a number from a hundred.',
  })
  rating!: number | null;

  @ApiProperty({ type: Number, format: 'float', nullable: true })
  rawAverage!: number | null;

  @ApiProperty({ type: 'integer' }) reviewCount!: number;

  @ApiProperty({
    type: String,
    description:
      'What was checked and when, in a sentence. Deliberately not a badge: this platform does not assert that anybody is safe, and a tick would say exactly that.',
  })
  verificationStatement!: string;

  @ApiProperty({ type: Boolean }) identityConfirmed!: boolean;
  @ApiProperty({ type: Boolean }) backgroundCheckRun!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  backgroundCheckAgeDays!: number | null;
}

export class AvailabilityWindowDto {
  @ApiProperty({ type: 'integer', description: '1 = Monday, 7 = Sunday (ISO).' })
  weekday!: number;

  @ApiProperty({ type: 'integer' }) startMinute!: number;
  @ApiProperty({ type: 'integer' }) endMinute!: number;
  @ApiProperty({ type: String }) timeZone!: string;
}

export class CaregiverProfileDto extends CaregiverCardDto {
  @ApiProperty({ type: () => [AvailabilityWindowDto] })
  availability!: AvailabilityWindowDto[];

  @ApiProperty({ type: () => [ReviewDto] })
  reviews!: ReviewDto[];
}

export class ReviewDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer' }) rating!: number;
  @ApiProperty({ type: String, nullable: true }) comment!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class BookingDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) caregiverId!: string;
  @ApiProperty({ type: String }) caregiverName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId!: string;
  @ApiProperty({ type: String }) patientName!: string;

  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;

  @ApiProperty({ enum: BOOKING_STATUSES, enumName: 'BookingStatus' })
  status!: string;

  @ApiProperty({
    type: 'integer',
    description:
      'The rate agreed at booking, not today’s. A caregiver raising their price must not re-price work somebody has already agreed to.',
  })
  hourlyRateCents!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedInAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedOutAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true }) billableMinutes!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) totalCents!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'What the caregiver keeps. Derived by subtraction, so the two halves always add up.',
  })
  caregiverPayoutCents!: number | null;

  @ApiProperty({ type: String, nullable: true }) cancellationReason!: string | null;

  @ApiProperty({ type: Boolean }) hasReview!: boolean;
  @ApiProperty({ type: Boolean }) hasOpenDispute!: boolean;
}

export class CancellationQuoteDto {
  @ApiProperty({ type: 'integer' }) feeCents!: number;

  @ApiProperty({
    type: String,
    description: 'Shown before the family confirms, in their own words.',
  })
  explanation!: string;
}
