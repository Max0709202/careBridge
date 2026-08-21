import {
  BILLING_INCREMENT_MINUTES,
  BOOKING_STATUSES,
  CAREGIVER_COMMISSION_BASIS_POINTS,
  FREE_CANCELLATION_HOURS,
  MINIMUM_BOOKING_MINUTES,
  assertBookable,
  assertBookingTransition,
  billableMinutes,
  cancellationFee,
  canTransitionBooking,
  chargeFor,
  holdsTheSlot,
  overlaps,
  type BookingStatus,
} from './caregiver-booking';
import { InvalidTransitionError, ValidationError } from '../common/errors';

/**
 * Booking a companion, and what it costs.
 *
 * The tests that matter are the ones about rounding and about cancelling.
 * Rounding decides whether somebody is paid for the last fourteen minutes of
 * their afternoon; cancelling decides who bears the cost when a hospital rings
 * at eight in the morning.
 */

const now = new Date('2026-06-15T09:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe('the booking sequence', () => {
  it('waits for the caregiver to answer', () => {
    expect(canTransitionBooking('requested', 'confirmed')).toBe(true);
    expect(canTransitionBooking('requested', 'inProgress')).toBe(false);
  });

  it('lets either side call it off before it starts', () => {
    for (const from of ['requested', 'confirmed'] as BookingStatus[]) {
      expect(canTransitionBooking(from, 'cancelledByFamily')).toBe(true);
      expect(canTransitionBooking(from, 'cancelledByCaregiver')).toBe(true);
    }
  });

  it('will not cancel a visit that has already begun', () => {
    // What would be cancelled has already partly happened. The honest end for
    // a visit that went wrong is a completion plus a dispute.
    expect(canTransitionBooking('inProgress', 'cancelledByFamily')).toBe(false);
    expect(canTransitionBooking('inProgress', 'completed')).toBe(true);
  });

  it('records a no-show as its own thing, not a cancellation', () => {
    // It is the outcome a family is owed an explanation for.
    expect(canTransitionBooking('confirmed', 'noShow')).toBe(true);
    expect(BOOKING_STATUSES).toContain('noShow');
  });

  it('leaves a finished booking alone', () => {
    for (const to of BOOKING_STATUSES) {
      expect(canTransitionBooking('completed', to)).toBe(false);
      expect(canTransitionBooking('cancelledByFamily', to)).toBe(false);
    }
  });

  it('throws on a move that is not allowed', () => {
    expect(() => assertBookingTransition('completed', 'inProgress')).toThrow(
      InvalidTransitionError,
    );
  });

  it('knows which states hold the calendar slot', () => {
    expect(holdsTheSlot('requested')).toBe(true);
    expect(holdsTheSlot('confirmed')).toBe(true);
    expect(holdsTheSlot('inProgress')).toBe(true);
    expect(holdsTheSlot('completed')).toBe(false);
    expect(holdsTheSlot('cancelledByFamily')).toBe(false);
  });
});

describe('what is chargeable', () => {
  const checkedInAt = new Date('2026-06-15T10:00:00Z');

  it('charges the time actually spent, not the time booked', () => {
    // A visit that ran twenty minutes over is twenty minutes of somebody's
    // afternoon.
    expect(
      billableMinutes({
        checkedInAt,
        checkedOutAt: new Date('2026-06-15T12:20:00Z'),
      }),
      // Two hours twenty, rounded up to the next quarter-hour.
    ).toBe(150);
  });

  it('rounds up, never down', () => {
    // Rounding down would have a caregiver work fourteen minutes for nothing.
    expect(
      billableMinutes({
        checkedInAt,
        checkedOutAt: new Date('2026-06-15T12:01:00Z'),
      }),
    ).toBe(135);
    expect(BILLING_INCREMENT_MINUTES).toBe(15);
  });

  it('never charges less than the minimum, however short the visit', () => {
    // Somebody who arrives and is sent home after ten minutes has still given
    // up the slot, turned down other work, and travelled.
    expect(
      billableMinutes({
        checkedInAt,
        checkedOutAt: new Date('2026-06-15T10:10:00Z'),
      }),
    ).toBe(MINIMUM_BOOKING_MINUTES);
  });

  it('does not go negative on a nonsensical pair of times', () => {
    expect(
      billableMinutes({
        checkedInAt,
        checkedOutAt: new Date('2026-06-15T09:00:00Z'),
      }),
    ).toBe(MINIMUM_BOOKING_MINUTES);
  });
});

describe('splitting the money', () => {
  it('takes the commission stamped on the booking', () => {
    const charge = chargeFor({
      minutes: 120,
      hourlyRateCents: 2800,
      commissionBasisPoints: CAREGIVER_COMMISSION_BASIS_POINTS,
    });

    expect(charge.totalCents).toBe(5600);
    expect(charge.platformFeeCents).toBe(840);
    expect(charge.caregiverPayoutCents).toBe(4760);
  });

  it('always adds up', () => {
    // The payout is derived by subtraction rather than by its own percentage.
    // Two independent roundings would leave a cent belonging to nobody, and a
    // cent belonging to nobody is an afternoon of reconciliation.
    for (const minutes of [60, 75, 90, 135, 200, 415]) {
      for (const rate of [1799, 2350, 2800, 3333]) {
        const charge = chargeFor({
          minutes,
          hourlyRateCents: rate,
          commissionBasisPoints: CAREGIVER_COMMISSION_BASIS_POINTS,
        });
        expect(charge.platformFeeCents + charge.caregiverPayoutCents).toBe(
          charge.totalCents,
        );
      }
    }
  });

  it('refuses a rate of nothing', () => {
    expect(() =>
      chargeFor({ minutes: 60, hourlyRateCents: 0, commissionBasisPoints: 1500 }),
    ).toThrow(ValidationError);
  });
});

describe('cancelling', () => {
  const booked = { startsAt: at(48), endsAt: at(51), hourlyRateCents: 3000 };

  it('is free with more than a day’s notice', () => {
    // Long enough for a caregiver to fill the slot.
    const outcome = cancellationFee({ ...booked, now, by: 'family' });
    expect(outcome.feeCents).toBe(0);
    expect(outcome.explanation).toMatch(/no charge/i);
  });

  it('is free exactly at the boundary', () => {
    const outcome = cancellationFee({
      startsAt: at(FREE_CANCELLATION_HOURS),
      endsAt: at(FREE_CANCELLATION_HOURS + 3),
      hourlyRateCents: 3000,
      now,
      by: 'family',
    });
    expect(outcome.feeCents).toBe(0);
  });

  it('charges half for late notice, not the whole visit', () => {
    // The caregiver has lost the slot but not spent the afternoon. A full
    // charge for work not done is a term that ends up in a complaint.
    const outcome = cancellationFee({
      startsAt: at(2),
      endsAt: at(5),
      hourlyRateCents: 3000,
      now,
      by: 'family',
    });

    expect(outcome.feeCents).toBe(4500);
    expect(outcome.explanation).toMatch(/half/i);
  });

  it('never charges the family when the caregiver cancels', () => {
    // They may have a very good reason, and the family is left without help
    // either way.
    const outcome = cancellationFee({
      startsAt: at(1),
      endsAt: at(4),
      hourlyRateCents: 3000,
      now,
      by: 'caregiver',
    });
    expect(outcome.feeCents).toBe(0);
  });
});

describe('the calendar', () => {
  it('treats back-to-back visits as not overlapping', () => {
    // Half-open. Two till three and three till four is a busy afternoon, not a
    // double booking.
    expect(
      overlaps({ startsAt: at(2), endsAt: at(3) }, { startsAt: at(3), endsAt: at(4) }),
    ).toBe(false);
  });

  it('catches an overlap in either direction', () => {
    const a = { startsAt: at(2), endsAt: at(5) };
    const b = { startsAt: at(4), endsAt: at(6) };
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
  });

  it('refuses a visit shorter than the minimum', () => {
    expect(() => assertBookable({ startsAt: at(2), endsAt: at(2.5) }, [], now)).toThrow(
      ValidationError,
    );
  });

  it('refuses a visit in the past', () => {
    expect(() => assertBookable({ startsAt: at(-2), endsAt: at(-1) }, [], now)).toThrow(
      /already passed/i,
    );
  });

  it('refuses one that ends before it starts', () => {
    expect(() => assertBookable({ startsAt: at(5), endsAt: at(3) }, [], now)).toThrow(
      ValidationError,
    );
  });

  it('refuses a clash with a booking that holds the slot', () => {
    expect(() =>
      assertBookable(
        { startsAt: at(2), endsAt: at(4) },
        [{ startsAt: at(3), endsAt: at(5), status: 'confirmed' }],
        now,
      ),
    ).toThrow(/already booked/i);
  });

  it('ignores a clash with one that was cancelled', () => {
    expect(() =>
      assertBookable(
        { startsAt: at(2), endsAt: at(4) },
        [{ startsAt: at(3), endsAt: at(5), status: 'cancelledByFamily' }],
        now,
      ),
    ).not.toThrow();
  });
});
