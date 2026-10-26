import { describe, expect, it } from 'vitest';

import { careStateFromJson, invoiceFromJson, subscriptionFromJson } from '../src/api/codec';
import type { components } from '../src/api/schema';
import {
  activeRideFor,
  activeRidesFor,
  can,
  canView,
  nextAppointmentFor,
  patientById,
  selectedPatient,
  unreadNotificationCount,
} from '../src/state/careState';
import { accessIsPrimary } from '../src/domain/permissions';
import { loadSnapshot, Seeded } from './support/fixture';

/**
 * The same snapshot the Flutter codec test decodes (test/fixtures in the repo
 * root), captured from the real API — so both clients are checked against one
 * sample of the contract rather than each against what it already expects.
 */
describe('care state snapshot', () => {
  const json = loadSnapshot();

  it('decodes the signed-in user and their care circle', () => {
    const state = careStateFromJson(json);
    expect(state.user?.email).toBe('sarah@example.com');
    expect(state.patients.map((p) => p.preferredName)).toEqual(expect.arrayContaining(['Eleanor', 'Frank']));
    expect(selectedPatient(state)?.preferredName).toBe('Eleanor');
  });

  it('carries the access grant every patient-scoped screen checks', () => {
    const state = careStateFromJson(json);
    const grant = state.access[Seeded.eleanor]!;
    expect(accessIsPrimary(grant)).toBe(true);
    expect(canView(state, Seeded.eleanor)).toBe(true);
    expect(can(state, Seeded.eleanor, 'requestTransport')).toBe(true);
    // A patient nobody granted access to is invisible, not merely hidden.
    expect(canView(state, '00000000-0000-4000-8000-0000000000aa')).toBe(false);
  });

  it('keeps no date of birth anywhere', () => {
    const encoded = JSON.stringify(json);
    expect(encoded).not.toContain('dateOfBirth');
    expect(patientById(careStateFromJson(json), Seeded.eleanor)?.ageBand).toBe('from75to84');
  });

  it('decodes money as integer cents and times as instants', () => {
    const state = careStateFromJson(json);
    const ride = state.rides.find((r) => r.id === Seeded.outboundRide)!;
    expect(ride.estimate.totalCents).toBe(3463);
    expect(ride.scheduledPickupAt.toISOString()).toBe('2026-08-13T10:00:00.000Z');
    expect(ride.simulationActive).toBe(false);
  });

  it('picks the ride and appointment the dashboard leads with', () => {
    const state = careStateFromJson(json);
    const now = new Date('2026-08-12T12:00:00Z');
    expect(nextAppointmentFor(state, Seeded.eleanor, now)?.id).toBe(Seeded.nextAppointment);
    expect(activeRideFor(state, Seeded.eleanor)?.status).toBe('awaitingAssignment');
    // Nothing moving: only the next ride requested, not every pending one.
    expect(activeRidesFor(state, Seeded.eleanor)).toHaveLength(1);
    expect(unreadNotificationCount(state)).toBe(0);
  });

  it('falls back rather than crashing on an enum value this build does not know', () => {
    const tampered = structuredClone(json) as components['schemas']['CareStateDto'];
    tampered.rides[0]!.status = 'teleporting';
    tampered.patients[0]!.mobilityNeeds = ['walker', 'jetpack'];
    const state = careStateFromJson(tampered);
    expect(state.rides[0]!.status).toBe('requested');
    expect(state.patients[0]!.mobilityNeeds).toEqual(['walker']);
  });

  it('fails loudly on a missing required field', () => {
    const broken = structuredClone(json) as components['schemas']['CareStateDto'];
    delete (broken.rides[0] as Partial<components['schemas']['RideDto']>).estimate;
    expect(() => careStateFromJson(broken)).toThrow();
  });
});

describe('billing codec', () => {
  it('drops an invoice whose status it does not recognise rather than guessing "Paid"', () => {
    const dto = {
      id: 'i',
      number: 'CB-1',
      reason: 'subscriptionPeriod',
      status: 'settled_somehow',
      currency: 'usd',
      subtotalCents: 1,
      creditAppliedCents: 0,
      totalCents: 1,
      amountPaidCents: 0,
      lines: [],
      issuedAt: '2026-08-01T00:00:00Z',
      paidAt: null,
      attemptCount: 1,
      nextAttemptAt: null,
      lastFailureCode: null,
    } as unknown as components['schemas']['InvoiceDto'];
    expect(invoiceFromJson(dto)).toBeNull();
    expect(invoiceFromJson({ ...dto, status: 'void' })?.status).toBe('void');
  });

  it('keeps only entitlements it knows', () => {
    const sub = subscriptionFromJson({
      id: 's',
      payer: 'family',
      status: 'active',
      interval: 'monthly',
      planCode: 'family',
      planName: 'Family',
      planVersion: 'v1',
      seats: 0,
      currentPeriodStart: '2026-08-01T00:00:00Z',
      currentPeriodEnd: '2026-09-01T00:00:00Z',
      trialEndsAt: null,
      pastDueSince: null,
      cancelRequestedAt: null,
      entitlements: ['liveTracking', 'timeTravel'],
      carriedCreditCents: 0,
      renewalQuote: { totalCents: 2900 },
    } as unknown as components['schemas']['SubscriptionDto']);
    expect(sub?.entitlements).toEqual(['liveTracking']);
    expect(sub?.renewalTotalCents).toBe(2900);
  });
});
