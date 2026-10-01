/**
 * Wire → domain. Mirrors lib/data/care_codec.dart and lib/data/billing_codec.dart.
 *
 * Forgiving about *unknown* enum values (a member the server has and this build
 * does not falls back rather than crashing the screen) and strict about
 * *missing* required fields — a contract break fails loudly rather than
 * rendering half an object. The wire shapes come from the generated
 * `schema.d.ts`, so a field that changes on the server is a type error here.
 */
import {
  AGE_BANDS,
  APPOINTMENT_TYPES,
  MOBILITY_NEEDS,
  NOTIFICATION_KINDS,
  type Address,
  type AppNotification,
  type AppUser,
  type Appointment,
  type Clinic,
  type Driver,
  type EmergencyContact,
  type Patient,
  type Ride,
  type RideEvent,
  type StatusChange,
  type TrackingPoint,
} from '../domain/models';
import {
  FAMILY_PERMISSIONS,
  RELATIONSHIP_TYPES,
  type FamilyPermission,
  type PatientAccess,
} from '../domain/permissions';
import type { PriceEstimate } from '../domain/pricing';
import { APPOINTMENT_STATUSES, RIDE_STATUSES } from '../domain/statuses';
import {
  ENTITLEMENTS,
  SUBSCRIPTION_STATUSES,
  type Invoice,
  type PaymentMethod,
  type Subscription,
  type SubscriptionPlan,
} from '../domain/billing';
import type { CareState } from '../state/careState';
import type { components } from './schema';

type S = components['schemas'];

// ─── helpers ────────────────────────────────────────────────────────────────

function enumOr<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  return enumOrNull(values, raw) ?? fallback;
}

function enumOrNull<T extends string>(values: readonly T[], raw: unknown): T | null {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function known<T extends string>(values: readonly T[], raw: readonly unknown[] | undefined): T[] {
  const out: T[] = [];
  for (const item of raw ?? []) {
    const value = enumOrNull(values, item);
    if (value !== null && !out.includes(value)) out.push(value);
  }
  return out;
}

function date(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Unparseable date: ${raw}`);
  return parsed;
}

const dateOrNull = (raw: string | null | undefined) => (raw ? date(raw) : null);

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) throw new TypeError(`Missing ${name}`);
  return value;
}

// ─── the care snapshot ──────────────────────────────────────────────────────

export function careStateFromJson(json: S['CareStateDto']): CareState {
  const access: Record<string, PatientAccess> = {};
  for (const [patientId, raw] of Object.entries(
    (json.access ?? {}) as Record<string, S['PatientAccessDto']>,
  )) {
    access[patientId] = accessFromJson(raw);
  }

  return {
    user: json.user ? userFromJson(json.user) : null,
    patients: (json.patients ?? []).map(patientFromJson),
    access,
    clinics: (json.clinics ?? []).map(clinicFromJson),
    appointments: (json.appointments ?? []).map(appointmentFromJson),
    rides: (json.rides ?? []).map(rideFromJson),
    notifications: (json.notifications ?? []).map(notificationFromJson),
    selectedPatientId: json.selectedPatientId ?? null,
    simplifiedMode: json.simplifiedMode ?? false,
  };
}

function userFromJson(json: S['AppUserDto']): AppUser {
  return {
    id: required(json.id, 'user.id'),
    email: required(json.email, 'user.email'),
    fullName: required(json.fullName, 'user.fullName'),
    phone: json.phone ?? null,
    emailVerifiedAt: dateOrNull(json.emailVerifiedAt),
    timeZone: json.timeZone ?? 'America/New_York',
  };
}

function addressFromJson(json: S['AddressDto']): Address {
  return {
    label: json.label,
    line1: json.line1,
    line2: json.line2 ?? null,
    city: json.city,
    state: json.state,
    postalCode: json.postalCode,
    accessNotes: json.accessNotes ?? null,
    coordinates:
      json.latitude === null ||
      json.latitude === undefined ||
      json.longitude === null ||
      json.longitude === undefined
        ? null
        : { latitude: json.latitude, longitude: json.longitude },
  };
}

function patientFromJson(json: S['PatientDto']): Patient {
  return {
    id: required(json.id, 'patient.id'),
    preferredName: required(json.preferredName, 'patient.preferredName'),
    legalName: json.legalName ?? null,
    phone: json.phone,
    homeAddress: addressFromJson(required(json.homeAddress, 'patient.homeAddress')),
    ageBand: enumOrNull(AGE_BANDS, json.ageBand),
    preferredLanguage: json.preferredLanguage ?? 'English',
    mobilityNeeds: known(MOBILITY_NEEDS, json.mobilityNeeds),
    mobilityNotes: json.mobilityNotes ?? null,
    emergencyContacts: (json.emergencyContacts ?? []).map(contactFromJson),
    preferredClinicId: json.preferredClinicId ?? null,
    archivedAt: dateOrNull(json.archivedAt),
  };
}

function contactFromJson(json: S['EmergencyContactDto']): EmergencyContact {
  return {
    id: json.id,
    name: json.name,
    relationship: json.relationship,
    phone: json.phone,
    isPrimary: json.isPrimary ?? false,
  };
}

function accessFromJson(json: S['PatientAccessDto']): PatientAccess {
  return {
    userId: json.userId,
    patientId: json.patientId,
    relationship: enumOr(RELATIONSHIP_TYPES, json.relationship, 'other'),
    permissions: new Set<FamilyPermission>(known(FAMILY_PERMISSIONS, json.permissions)),
    grantedAt: date(json.grantedAt),
    grantedByUserId: json.grantedByUserId ?? null,
    revokedAt: dateOrNull(json.revokedAt),
  };
}

function clinicFromJson(json: S['ClinicDto']): Clinic {
  return {
    id: json.id,
    name: json.name,
    phone: json.phone,
    address: addressFromJson(json.address),
    entranceNotes: json.entranceNotes ?? null,
    operatingNotes: json.operatingNotes ?? null,
  };
}

function appointmentFromJson(json: S['AppointmentDto']): Appointment {
  return {
    id: json.id,
    patientId: json.patientId,
    clinicId: json.clinicId,
    startsAt: date(json.startsAt),
    expectedDurationMinutes: required(json.expectedDurationMinutes, 'expectedDurationMinutes'),
    type: enumOr(APPOINTMENT_TYPES, json.type, 'other'),
    status: enumOr(APPOINTMENT_STATUSES, json.status, 'scheduled'),
    coordinationNotes: json.coordinationNotes ?? null,
    transportRequired: json.transportRequired ?? false,
    timeZoneLabel: json.timeZoneLabel ?? 'clinic time',
    history: (json.history ?? []).map(statusChangeFromJson),
    createdAt: dateOrNull(json.createdAt),
  };
}

function statusChangeFromJson(json: S['StatusChangeDto']): StatusChange {
  return {
    at: date(json.at),
    from: json.from,
    to: json.to,
    actor: json.actor,
    reason: json.reason ?? null,
  };
}

function rideFromJson(json: S['RideDto']): Ride {
  return {
    id: json.id,
    patientId: json.patientId,
    appointmentId: json.appointmentId ?? null,
    roundTripGroupId: json.roundTripGroupId ?? null,
    direction: json.direction === 'returnTrip' ? 'returnTrip' : 'outbound',
    pickup: addressFromJson(json.pickup),
    destination: addressFromJson(json.destination),
    scheduledPickupAt: date(json.scheduledPickupAt),
    flexibleReturn: json.flexibleReturn ?? false,
    status: enumOr(RIDE_STATUSES, json.status, 'requested'),
    wheelchairRequired: json.wheelchairRequired ?? false,
    assistanceRequired: json.assistanceRequired ?? false,
    notesForDriver: json.notesForDriver ?? null,
    driver: json.driver ? driverFromJson(json.driver) : null,
    estimate: estimateFromJson(required(json.estimate, 'ride.estimate')),
    isDelayed: json.isDelayed ?? false,
    delayReason: json.delayReason ?? null,
    cancellationReason: json.cancellationReason ?? null,
    events: (json.events ?? []).map(rideEventFromJson),
    history: (json.history ?? []).map(statusChangeFromJson),
    lastKnownPosition: json.lastKnownPosition ? trackingPointFromJson(json.lastKnownPosition) : null,
    etaMinutes: json.etaMinutes ?? null,
    createdAt: dateOrNull(json.createdAt),
    simulationActive: json.simulationActive === true,
  };
}

function driverFromJson(json: S['DriverDto']): Driver {
  return {
    id: json.id,
    displayName: json.displayName,
    rating: json.rating ?? 5.0,
    yearsDriving: json.yearsDriving ?? 1,
    vehicle: {
      make: json.vehicle.make,
      model: json.vehicle.model,
      color: json.vehicle.color,
      licensePlate: json.vehicle.licensePlate,
      isWheelchairAccessible: json.vehicle.isWheelchairAccessible ?? false,
    },
  };
}

/** Money crosses the wire as integer cents and is never parsed from a decimal string. */
function estimateFromJson(json: S['PriceEstimateDto']): PriceEstimate {
  return {
    ruleVersion: json.ruleVersion,
    distanceMiles: json.distanceMiles,
    durationMinutes: json.durationMinutes,
    baseCents: json.baseCents,
    distanceChargeCents: json.distanceChargeCents,
    timeChargeCents: json.timeChargeCents,
    surcharges: (json.surcharges ?? []).map((s) => ({ label: s.label, amountCents: s.amountCents })),
    totalCents: json.totalCents,
    minimumApplied: json.minimumApplied ?? false,
  };
}

function rideEventFromJson(json: S['RideEventDto']): RideEvent {
  return {
    at: date(json.at),
    title: json.title,
    detail: json.detail ?? null,
    isException: json.isException ?? false,
  };
}

/** Aged against the moment the *device* took the reading. */
export function trackingPointFromJson(json: S['TrackingPointDto']): TrackingPoint {
  return {
    coordinates: { latitude: json.latitude, longitude: json.longitude },
    capturedAt: date(json.capturedAt),
    accuracyMeters: json.accuracyMeters ?? 12,
  };
}

function notificationFromJson(json: S['NotificationDto']): AppNotification {
  return {
    id: json.id,
    kind: enumOr(NOTIFICATION_KINDS, json.kind, 'appointmentChanged'),
    title: json.title,
    body: json.body,
    createdAt: date(json.createdAt),
    readAt: dateOrNull(json.readAt),
    rideId: json.rideId ?? null,
    appointmentId: json.appointmentId ?? null,
    conversationId: json.conversationId ?? null,
  };
}

// ─── billing ────────────────────────────────────────────────────────────────
//
// Unknown values are dropped rather than guessed at: an invoice rendered as
// "Paid" because this build did not recognise `uncollectible` is worse than an
// invoice that does not appear.

export function subscriptionFromJson(dto: S['SubscriptionDto'] | null | undefined): Subscription | null {
  if (!dto) return null;
  const status = enumOrNull(SUBSCRIPTION_STATUSES, dto.status);
  const interval = enumOrNull(['monthly', 'annual'] as const, dto.interval);
  const payer = enumOrNull(['family', 'dispatchOrganization'] as const, dto.payer);
  if (!status || !interval || !payer) return null;

  return {
    id: dto.id,
    payer,
    status,
    interval,
    planCode: dto.planCode,
    planName: dto.planName,
    planVersion: dto.planVersion,
    seats: dto.seats,
    currentPeriodStart: date(dto.currentPeriodStart),
    currentPeriodEnd: date(dto.currentPeriodEnd),
    trialEndsAt: dateOrNull(dto.trialEndsAt),
    pastDueSince: dateOrNull(dto.pastDueSince),
    cancelRequestedAt: dateOrNull(dto.cancelRequestedAt),
    entitlements: known(ENTITLEMENTS, dto.entitlements),
    renewalTotalCents: dto.renewalQuote.totalCents,
    carriedCreditCents: dto.carriedCreditCents ?? 0,
  };
}

export function planFromJson(dto: S['SubscriptionPlanDto']): SubscriptionPlan | null {
  const interval = enumOrNull(['monthly', 'annual'] as const, dto.interval);
  const payer = enumOrNull(['family', 'dispatchOrganization'] as const, dto.payer);
  if (!interval || !payer) return null;

  return {
    code: dto.code,
    version: dto.version,
    payer,
    interval,
    name: dto.name,
    description: dto.description,
    basePriceCents: dto.basePriceCents,
    includedSeats: dto.includedSeats,
    seatTiers: dto.seatTiers.map((t) => ({
      upToSeats: t.upToSeats ?? null,
      unitPriceCents: t.unitPriceCents,
    })),
    entitlements: known(ENTITLEMENTS, dto.entitlements),
    trialDays: dto.trialDays,
    graceDays: dto.graceDays,
  };
}

export function invoiceFromJson(dto: S['InvoiceDto']): Invoice | null {
  const reason = enumOrNull(['subscriptionPeriod', 'seatProration', 'intervalSwitch'] as const, dto.reason);
  const status = enumOrNull(['open', 'paid', 'uncollectible', 'void'] as const, dto.status);
  if (!reason || !status) return null;

  return {
    id: dto.id,
    number: dto.number,
    reason,
    status,
    subtotalCents: dto.subtotalCents,
    creditAppliedCents: dto.creditAppliedCents,
    totalCents: dto.totalCents,
    amountPaidCents: dto.amountPaidCents,
    lines: dto.lines.map((l) => ({
      label: l.label,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
    })),
    issuedAt: date(dto.issuedAt),
    paidAt: dateOrNull(dto.paidAt),
    attemptCount: dto.attemptCount ?? 0,
    nextAttemptAt: dateOrNull(dto.nextAttemptAt),
    lastFailureCode: dto.lastFailureCode ?? null,
  };
}

export function paymentMethodFromJson(dto: S['PaymentMethodDto'] | null | undefined): PaymentMethod | null {
  if (!dto) return null;
  return {
    id: dto.id,
    brand: dto.brand,
    last4: dto.last4,
    expMonth: dto.expMonth,
    expYear: dto.expYear,
    isDefault: dto.isDefault,
  };
}
