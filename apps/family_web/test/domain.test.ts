import { describe, expect, it } from 'vitest';

import {
  formatClock,
  formatCountdown,
  formatDay,
  formatDuration,
  formatFreshness,
  formatMiles,
  formatRelativeDay,
  formatShortDay,
  groupInFours,
  maskPhone,
  combineLocal,
} from '../src/core/formatting';
import { distanceMiles, estimateDriveMinutes } from '../src/core/geo';
import { formatMoney, multiplyCents } from '../src/core/money';
import {
  cardExpiresSoon,
  cardHasExpired,
  DunningCopy,
  periodPriceCents,
  subscriptionSummary,
  type Invoice,
  type PaymentMethod,
  type Subscription,
  type SubscriptionPlan,
} from '../src/domain/billing';
import { initialsOf, newerPoint, type TrackingPoint } from '../src/domain/models';
import { estimateFare, standardPricingRule } from '../src/domain/pricing';
import {
  rideAllowsLocationSharing,
  ridePassengerIsOnboard,
  rideIsTerminal,
} from '../src/domain/statuses';

describe('money', () => {
  it('formats cents without floating-point drift', () => {
    expect(formatMoney(1800)).toBe('$18.00');
    expect(formatMoney(3463)).toBe('$34.63');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(-350)).toBe('-$3.50');
  });

  it('rounds half away from zero, as the server and the Dart client do', () => {
    expect(multiplyCents(225, 2.5)).toBe(563); // 562.5 → 563
    expect(multiplyCents(-225, 2.5)).toBe(-563);
    expect(multiplyCents(45, 11)).toBe(495);
  });
});

describe('fare estimate', () => {
  it('itemises base, distance, time and named surcharges', () => {
    const e = estimateFare({
      rule: standardPricingRule,
      distanceMiles: 4.2,
      durationMinutes: 17,
      wheelchairAccessRequired: true,
      assistanceRequired: true,
    });
    expect(e.baseCents).toBe(1200);
    expect(e.distanceChargeCents).toBe(945);
    expect(e.timeChargeCents).toBe(765);
    expect(e.surcharges.map((s) => s.label)).toEqual([
      'Wheelchair-accessible vehicle',
      'Door-through-door assistance',
    ]);
    expect(e.totalCents).toBe(1200 + 945 + 765 + 1500 + 800);
    expect(e.minimumApplied).toBe(false);
  });

  it('shows when the minimum fare lifted the total', () => {
    const e = estimateFare({
      rule: standardPricingRule,
      distanceMiles: 0,
      durationMinutes: 0,
    });
    expect(e.totalCents).toBe(1800);
    expect(e.minimumApplied).toBe(true);
  });

  it('refuses negative inputs', () => {
    expect(() =>
      estimateFare({
        rule: standardPricingRule,
        distanceMiles: -1,
        durationMinutes: 0,
      }),
    ).toThrow();
  });

  it('estimates distance and drive time conservatively', () => {
    const a = { latitude: 39.9612, longitude: -82.9988 };
    const b = { latitude: 40.0, longitude: -83.0 };
    const miles = distanceMiles(a, b);
    expect(miles).toBeGreaterThan(2.6 * 1.3 * 0.9);
    expect(estimateDriveMinutes(miles)).toBeGreaterThan(6);
    expect(estimateDriveMinutes(0)).toBe(0);
  });
});

describe('formatting', () => {
  const now = new Date(2026, 7, 12, 9, 0); // Wed 12 Aug 2026

  it('matches the intl patterns the Flutter app uses', () => {
    expect(formatClock(9, 5)).toBe('9:05 AM');
    expect(formatClock(0, 0)).toBe('12:00 AM');
    expect(formatClock(12, 30)).toBe('12:30 PM');
    expect(formatDay(new Date(2026, 7, 13))).toBe('Thursday 13 August');
    expect(formatShortDay(new Date(2026, 7, 13))).toBe('Thu 13 Aug');
  });

  it('labels days relative to today', () => {
    expect(formatRelativeDay(new Date(2026, 7, 12, 23), now)).toBe('Today');
    expect(formatRelativeDay(new Date(2026, 7, 13, 1), now)).toBe('Tomorrow');
    expect(formatRelativeDay(new Date(2026, 7, 11), now)).toBe('Yesterday');
    expect(formatRelativeDay(new Date(2026, 7, 15), now)).toBe('Saturday');
    expect(formatRelativeDay(new Date(2026, 7, 20), now)).toBe('Thu 20 Aug');
  });

  it('counts down in words, not clock times', () => {
    expect(formatCountdown(-1)).toBe('now');
    expect(formatCountdown(30_000)).toBe('in under a minute');
    expect(formatCountdown(60_000)).toBe('in 1 minute');
    expect(formatCountdown(12 * 60_000)).toBe('in 12 minutes');
    expect(formatCountdown(61 * 60_000)).toBe('in about an hour');
    expect(formatCountdown(3 * 3_600_000)).toBe('in about 3 hours');
    expect(formatCountdown(30 * 3_600_000)).toBe('tomorrow');
    expect(formatCountdown(72 * 3_600_000)).toBe('in 3 days');
  });

  it('always says how old a position is', () => {
    expect(formatFreshness(2_000)).toBe('just now');
    expect(formatFreshness(45_000)).toBe('45 seconds ago');
    expect(formatFreshness(60_000)).toBe('1 minute ago');
    expect(formatFreshness(4 * 60_000)).toBe('4 minutes ago');
    expect(formatFreshness(3_600_000)).toBe('1 hour ago');
  });

  it('formats durations, phones, miles and secrets', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(120)).toBe('2 hr');
    expect(formatDuration(80)).toBe('1 hr 20 min');
    expect(maskPhone('(614) 555-0141')).toBe('(614) •••-••41');
    expect(maskPhone('555-41')).toBe('•••-41');
    expect(maskPhone('12')).toBe('•••');
    expect(formatMiles(4)).toBe('4.0');
    expect(formatMiles(4.3)).toBe('4.3');
    expect(groupInFours('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(initialsOf('Sarah Whitfield')).toBe('SW');
    expect(initialsOf('Cher')).toBe('C');
    expect(initialsOf('  ')).toBe('?');
  });

  it('combines a date and a time field into a local instant', () => {
    expect(combineLocal('2026-08-13', '10:40')?.getTime()).toBe(
      new Date(2026, 7, 13, 10, 40).getTime(),
    );
    expect(combineLocal('', '10:40')).toBeNull();
    expect(combineLocal('2026-08-13', '')).toBeNull();
  });
});

describe('tracking', () => {
  const point = (at: number, latitude = 0): TrackingPoint => ({
    coordinates: { latitude, longitude: 0 },
    capturedAt: new Date(at),
    accuracyMeters: 12,
  });

  it('takes whichever reading exists', () => {
    expect(newerPoint(null, null)).toBeNull();
    expect(newerPoint(point(1), null)?.capturedAt.getTime()).toBe(1);
    expect(newerPoint(null, point(2))?.capturedAt.getTime()).toBe(2);
  });

  it('prefers the reading the device took most recently, whatever arrived first', () => {
    expect(newerPoint(point(1), point(2))?.capturedAt.getTime()).toBe(2);
    expect(newerPoint(point(2), point(1))?.capturedAt.getTime()).toBe(2);
  });

  it('keeps the first when both were captured at the same instant', () => {
    expect(newerPoint(point(5, 1), point(5, 2))?.coordinates.latitude).toBe(1);
  });

  it('allows location sharing only while the trip is under way', () => {
    expect(rideAllowsLocationSharing('assigned')).toBe(false);
    expect(rideAllowsLocationSharing('driverEnRoute')).toBe(true);
    expect(rideAllowsLocationSharing('arrivedAtDestination')).toBe(true);
    expect(rideAllowsLocationSharing('completed')).toBe(false);
    expect(ridePassengerIsOnboard('inProgress')).toBe(true);
    expect(ridePassengerIsOnboard('driverArrived')).toBe(false);
    expect(rideIsTerminal('noShow')).toBe(true);
  });
});

describe('billing', () => {
  const card: PaymentMethod = {
    id: 'c',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2026,
    isDefault: true,
  };

  it('judges card expiry against the end of the expiry month', () => {
    expect(cardHasExpired(card, new Date(Date.UTC(2026, 11, 1)))).toBe(false);
    expect(cardHasExpired(card, new Date(Date.UTC(2026, 11, 31, 23)))).toBe(false);
    expect(cardHasExpired(card, new Date(Date.UTC(2027, 0, 1)))).toBe(true);
  });

  it('warns before a card lapses rather than after', () => {
    expect(cardExpiresSoon(card, new Date(Date.UTC(2026, 11, 1)))).toBe(true);
    expect(cardExpiresSoon(card, new Date(Date.UTC(2026, 5, 1)))).toBe(false);
    expect(cardExpiresSoon(card, new Date(Date.UTC(2027, 1, 1)))).toBe(false);
  });

  it('says what has not stopped before what failed', () => {
    const invoice = { status: 'open' } as Invoice;
    expect(DunningCopy.headline(invoice)).toBe('Your payment did not go through');
    expect(DunningCopy.detail(invoice)).toMatch(/^Nothing has been switched off/);
    expect(DunningCopy.detail({ status: 'uncollectible' } as Invoice)).toMatch(
      /stopped trying/,
    );
  });

  it('prices a family plan at its base and a seat plan by graduated bands', () => {
    const family = {
      basePriceCents: 2900,
      includedSeats: 0,
      seatTiers: [],
    } as unknown as SubscriptionPlan;
    expect(periodPriceCents(family)).toBe(2900);

    const seats = {
      basePriceCents: 10000,
      includedSeats: 5,
      seatTiers: [
        { upToSeats: 20, unitPriceCents: 1500 },
        { upToSeats: null, unitPriceCents: 1000 },
      ],
    } as unknown as SubscriptionPlan;
    // 15 drivers in the first band, 5 in the second.
    expect(periodPriceCents(seats, 25)).toBe(10000 + 15 * 1500 + 5 * 1000);
    expect(periodPriceCents(seats, 3)).toBe(10000);
  });

  it('summarises a subscription in one line', () => {
    const s = { planName: 'Family', status: 'pastDue' } as Subscription;
    expect(subscriptionSummary(s)).toBe('Family — payment failed');
    expect(subscriptionSummary({ ...s, status: 'expired' })).toBe('No plan');
  });
});
