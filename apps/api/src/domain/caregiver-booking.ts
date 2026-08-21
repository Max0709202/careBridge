import { InvalidTransitionError, ValidationError } from '../common/errors';

/**
 * Booking a companion, and what it costs.
 *
 * **Companion care, not clinical care.** Sitting with somebody, helping them
 * to a door, being in the room. Nothing here describes a treatment, and
 * nothing in this file should ever grow a field that does.
 */

export type BookingStatus =
  | 'requested'
  | 'confirmed'
  | 'inProgress'
  | 'completed'
  | 'cancelledByFamily'
  | 'cancelledByCaregiver'
  | 'noShow';

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'requested',
  'confirmed',
  'inProgress',
  'completed',
  'cancelledByFamily',
  'cancelledByCaregiver',
  'noShow',
];

const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  requested: ['confirmed', 'cancelledByFamily', 'cancelledByCaregiver'],
  confirmed: ['inProgress', 'cancelledByFamily', 'cancelledByCaregiver', 'noShow'],
  // No cancellation once somebody has arrived and started. What would be
  // cancelled has already partly happened, and the honest end for a visit that
  // went wrong is a completion plus a dispute.
  inProgress: ['completed'],
  completed: [],
  cancelledByFamily: [],
  cancelledByCaregiver: [],
  noShow: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransitionBooking(from, to)) throw new InvalidTransitionError(from, to);
}

/** Whether this booking still occupies the caregiver's calendar. */
export function holdsTheSlot(status: BookingStatus): boolean {
  return status === 'requested' || status === 'confirmed' || status === 'inProgress';
}

// ─── the money ───────────────────────────────────────────────────────────────

/**
 * The platform's cut, in basis points.
 *
 * Fifteen per cent. Stamped on the booking when it is made rather than read at
 * completion, for the same reason a ride's price rule version is: a charge has
 * to stay explicable by the rule that produced it, and a commission that
 * changed between the booking and the visit must not silently re-price work
 * somebody has already agreed to do.
 */
export const CAREGIVER_COMMISSION_BASIS_POINTS = 1500;

/**
 * The shortest engagement that may be booked, and the shortest that is
 * charged.
 *
 * An hour. Below it the travel outweighs the work for the caregiver, and a
 * marketplace of twenty-minute jobs is one nobody accepts.
 */
export const MINIMUM_BOOKING_MINUTES = 60;

/**
 * Billing granularity.
 *
 * Fifteen minutes, **rounded up**. Rounding down would have a caregiver work
 * fourteen minutes for nothing; rounding to the nearest would make the
 * direction of the error depend on the clock. Up is the choice that never
 * takes somebody's time without paying for it, and the family is told the rule
 * before they book.
 */
export const BILLING_INCREMENT_MINUTES = 15;

/**
 * What is actually chargeable, from when the caregiver arrived and left.
 *
 * Computed from the checked times rather than the booked window, because a
 * visit that ran twenty minutes over is twenty minutes of somebody's
 * afternoon — and one that ended early should not be charged for time nobody
 * spent.
 *
 * Never less than the booked window's minimum, though: a caregiver who arrives
 * and is sent home after ten minutes has still given up the slot, turned down
 * other work, and travelled.
 */
export function billableMinutes(input: {
  checkedInAt: Date;
  checkedOutAt: Date;
}): number {
  const worked = Math.max(
    0,
    (input.checkedOutAt.getTime() - input.checkedInAt.getTime()) / 60_000,
  );

  const rounded =
    Math.ceil(worked / BILLING_INCREMENT_MINUTES) * BILLING_INCREMENT_MINUTES;

  return Math.max(MINIMUM_BOOKING_MINUTES, rounded);
}

export interface BookingCharge {
  billableMinutes: number;
  totalCents: number;
  platformFeeCents: number;
  caregiverPayoutCents: number;
}

/**
 * What the family pays and what the caregiver keeps.
 *
 * Integer arithmetic throughout, and the payout is derived by **subtraction**
 * rather than by its own percentage. Two independent roundings would let the
 * two halves fail to add up to the total, and a cent that belongs to nobody is
 * a reconciliation somebody spends an afternoon on.
 */
export function chargeFor(input: {
  minutes: number;
  hourlyRateCents: number;
  commissionBasisPoints: number;
}): BookingCharge {
  if (input.hourlyRateCents <= 0) {
    throw new ValidationError('A caregiver’s rate must be more than nothing.');
  }

  const totalCents = Math.round((input.hourlyRateCents * input.minutes) / 60);
  const platformFeeCents = Math.round(
    (totalCents * input.commissionBasisPoints) / 10_000,
  );

  return {
    billableMinutes: input.minutes,
    totalCents,
    platformFeeCents,
    caregiverPayoutCents: totalCents - platformFeeCents,
  };
}

// ─── cancelling ──────────────────────────────────────────────────────────────

/**
 * How much notice makes a cancellation free.
 *
 * Twenty-four hours. Long enough for a caregiver to fill the slot, short
 * enough that a family dealing with a hospital admission is not penalised for
 * something they learned that morning.
 */
export const FREE_CANCELLATION_HOURS = 24;

/**
 * The fee for cancelling late, as a share of the booked value.
 *
 * Half. Not the whole amount: the caregiver has lost the slot but not spent
 * the afternoon, and a full charge for work not done is the kind of term that
 * ends up in a complaint rather than in a payment.
 */
export const LATE_CANCELLATION_BASIS_POINTS = 5000;

export interface CancellationOutcome {
  feeCents: number;
  /** Said to the family before they confirm, in their own words. */
  explanation: string;
}

export function cancellationFee(input: {
  startsAt: Date;
  endsAt: Date;
  hourlyRateCents: number;
  now: Date;
  by: 'family' | 'caregiver';
}): CancellationOutcome {
  // A caregiver cancelling never charges the family. They may have a very good
  // reason, and the family is the one left without help either way.
  if (input.by === 'caregiver') {
    return { feeCents: 0, explanation: 'No charge — the caregiver cancelled.' };
  }

  const hoursOfNotice = (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;

  if (hoursOfNotice >= FREE_CANCELLATION_HOURS) {
    return {
      feeCents: 0,
      explanation: 'No charge — this is more than a day before the visit.',
    };
  }

  const bookedMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
  const booked = chargeFor({
    minutes: Math.max(MINIMUM_BOOKING_MINUTES, bookedMinutes),
    hourlyRateCents: input.hourlyRateCents,
    commissionBasisPoints: 0,
  });

  const feeCents = Math.round(
    (booked.totalCents * LATE_CANCELLATION_BASIS_POINTS) / 10_000,
  );

  return {
    feeCents,
    explanation:
      'Half the visit is charged — this is less than a day’s notice, and the caregiver has kept the time free.',
  };
}

// ─── the calendar ────────────────────────────────────────────────────────────

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

/** Whether two windows touch. Half-open, so 2–3 and 3–4 do not. */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Whether a requested window is one this booking may have.
 *
 * The database also refuses an overlapping booking, with an exclusion
 * constraint — because two families booking the same hour at the same moment
 * is exactly the race a check like this one loses, and the consequence is
 * somebody sitting alone while the caregiver is at the other address. This
 * exists so the common case gets a sentence rather than a constraint
 * violation.
 */
export function assertBookable(
  window: TimeWindow,
  existing: readonly (TimeWindow & { status: BookingStatus })[],
  now: Date,
): void {
  if (window.endsAt <= window.startsAt) {
    throw new ValidationError('The visit has to end after it starts.', 'endsAt');
  }

  const minutes = (window.endsAt.getTime() - window.startsAt.getTime()) / 60_000;
  if (minutes < MINIMUM_BOOKING_MINUTES) {
    throw new ValidationError(
      `The shortest visit is ${MINIMUM_BOOKING_MINUTES} minutes.`,
      'endsAt',
    );
  }

  if (window.startsAt <= now) {
    throw new ValidationError('That time has already passed.', 'startsAt');
  }

  if (existing.some((b) => holdsTheSlot(b.status) && overlaps(window, b))) {
    throw new ValidationError('That caregiver is already booked then.', 'startsAt');
  }
}
