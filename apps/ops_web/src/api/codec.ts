/**
 * Wire in, domain out. A port of apps/ops_console/lib/data/ops_codec.dart,
 * admin_codec.dart and billing_codec.dart.
 *
 * The handling of an unrecognised value differs by field, and the difference
 * is deliberate. The common thread: an unknown value must never make a driver
 * look **more** available, an invoice look **more** settled, or a refund look
 * **more** finished than it is.
 *
 *  - A driver with an unknown status is **dropped**: every roster control is
 *    gated on it.
 *  - A candidate's unknown ineligibility reason is **kept**: dropping it would
 *    make them look merely unexplained instead of unavailable.
 *  - A queue item with an unknown urgency is **dropped**: it would sort into
 *    the wrong place.
 *  - An audit row is **rendered as is**: nothing is gated on it, and an audit
 *    log that quietly omits rows is the one thing it cannot be.
 *  - Billing values that are unknown are **dropped**, because here the wrong
 *    guess is money.
 */
import type {
  AuditEntry,
  AuditPage,
  FeatureFlag,
  PlatformStats,
  Refund,
  RefundableInvoice,
} from '../domain/admin';
import { parseRefundStatus } from '../domain/admin';
import type {
  BillingAccount,
  BillingLine,
  BillingQuote,
  Invoice,
  OperatorPlan,
  OperatorSubscription,
  PaymentMethod,
} from '../domain/billing';
import {
  parseInterval,
  parseInvoiceReason,
  parseInvoiceStatus,
  parseSubscriptionStatus,
} from '../domain/billing';
import {
  parseDriverStatus,
  parseReason,
  parseUrgency,
  type IneligibilityReason,
} from '../domain/dispatch';
import type {
  Candidate,
  DispatchQueue,
  Driver,
  Organization,
  QueueItem,
  SeatSummary,
  Vehicle,
} from '../domain/models';
import type {
  Coordinates,
  LiveBoard,
  LivePosition,
  LiveRide,
  LiveRoute,
  ServiceArea,
} from '../domain/liveMap';
import type { components } from './schema';

type S = components['schemas'];

/** Paperwork is rendered straight from the wire, as the Flutter console does. */
export type DriverCompliance = S['DriverComplianceDto'];
export type DriverDocument = S['DriverDocumentDto'];
export type DocumentViewUrl = S['DocumentViewUrlDto'];
/** An account the operator can put on its roster, shown so they can check who it is. */
export type DriverAccountMatch = S['DriverAccountMatchDto'];

const date = (value: string) => new Date(value);
const maybeDate = (value: string | null | undefined) =>
  value ? new Date(value) : null;

// ─── dispatch ───────────────────────────────────────────────────────────────

export const organizationFromWire = (dto: S['OrganizationDto']): Organization => ({
  id: dto.id,
  name: dto.name,
  slug: dto.slug,
  timeZone: dto.timeZone,
  role: dto.role,
});

export const vehicleFromWire = (dto: S['VehicleDto']): Vehicle => ({
  id: dto.id,
  make: dto.make,
  model: dto.model,
  color: dto.color,
  licensePlate: dto.licensePlate,
  isWheelchairAccessible: dto.isWheelchairAccessible,
});

export function driverFromWire(dto: S['DriverDto']): Driver | null {
  const status = parseDriverStatus(dto.status);
  if (status === null) return null;

  return {
    id: dto.id,
    displayName: dto.displayName,
    status,
    onShift: dto.onShift,
    rating: dto.rating,
    yearsDriving: dto.yearsDriving,
    vehicle: vehicleFromWire(dto.vehicle),
    occupiesSeat: dto.occupiesSeat,
    activeRideCount: dto.activeRideCount,
    approvedAt: maybeDate(dto.approvedAt),
    suspensionReason: dto.suspensionReason ?? null,
  };
}

export function candidateFromWire(dto: S['DispatchCandidateDto']): Candidate {
  const reasons: IneligibilityReason[] = [];
  const unrecognisedReasons: string[] = [];
  for (const raw of dto.reasons) {
    const reason = parseReason(raw);
    if (reason === null) unrecognisedReasons.push(raw);
    else reasons.push(reason);
  }
  return {
    driverId: dto.driverId,
    displayName: dto.displayName,
    eligible: dto.eligible,
    reasons,
    unrecognisedReasons,
  };
}

export function queueItemFromWire(dto: S['DispatchQueueItemDto']): QueueItem | null {
  const urgency = parseUrgency(dto.urgency);
  if (urgency === null) return null;

  return {
    rideId: dto.rideId,
    status: dto.status,
    patientName: dto.patientName,
    pickupLine: dto.pickupLine,
    destinationLine: dto.destinationLine,
    scheduledPickupAt: date(dto.scheduledPickupAt),
    wheelchairRequired: dto.wheelchairRequired,
    assistanceRequired: dto.assistanceRequired,
    urgency,
    // Absent from an older server: unknown, never "inside".
    pickupInServiceArea: dto.pickupInServiceArea ?? null,
    candidates: dto.candidates.map(candidateFromWire),
  };
}

/** Rendered in the server's order — by when the car is needed — never re-sorted here. */
export const queueFromWire = (dto: S['DispatchQueueDto']): DispatchQueue => ({
  organizationId: dto.organizationId,
  items: dto.items.map(queueItemFromWire).filter((i): i is QueueItem => i !== null),
  availableDrivers: dto.availableDrivers,
});

// ─── the live map ───────────────────────────────────────────────────────────

/**
 * An area whose kind is unknown, or missing what its kind needs, is **dropped**
 * — drawn as no area at all, not as a guess at one.
 */
export function serviceAreaFromWire(
  dto: S['ServiceAreaDto'] | null | undefined,
): ServiceArea | null {
  if (!dto) return null;
  if (dto.kind === 'radius' && dto.center && typeof dto.radiusMiles === 'number') {
    return {
      kind: 'radius',
      center: coordinates(dto.center),
      radiusMiles: dto.radiusMiles,
    };
  }
  if (dto.kind === 'polygon' && dto.points && dto.points.length >= 3) {
    return { kind: 'polygon', points: dto.points.map(coordinates) };
  }
  return null;
}

const coordinates = (dto: S['CoordinatesDto']): Coordinates => ({
  latitude: dto.latitude,
  longitude: dto.longitude,
});

function livePositionFromWire(
  dto: S['LivePositionDto'] | null | undefined,
): LivePosition | null {
  if (!dto) return null;
  const capturedAt = date(dto.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) return null;
  return {
    latitude: dto.latitude,
    longitude: dto.longitude,
    accuracyMeters: dto.accuracyMeters,
    capturedAt,
  };
}

const liveRideFromWire = (dto: S['LiveRideDto']): LiveRide => ({
  rideId: dto.rideId,
  status: dto.status,
  driverId: dto.driverId,
  driverName: dto.driverName,
  patientName: dto.patientName,
  scheduledPickupAt: date(dto.scheduledPickupAt),
  pickup: dto.pickup ? coordinates(dto.pickup) : null,
  destination: dto.destination ? coordinates(dto.destination) : null,
  position: livePositionFromWire(dto.position),
  etaMinutes: dto.etaMinutes ?? null,
  isDelayed: dto.isDelayed,
  route: liveRouteFromWire(dto.route),
});

/** A route with an unknown target, or too few points to be a road, is dropped. */
function liveRouteFromWire(
  dto: S['LiveRouteDto'] | null | undefined,
): LiveRoute | null {
  if (
    !dto ||
    (dto.target !== 'pickup' && dto.target !== 'destination') ||
    dto.path.length < 2
  )
    return null;
  return { target: dto.target, path: dto.path.map(coordinates) };
}

export const liveBoardFromWire = (dto: S['LiveBoardDto']): LiveBoard => ({
  organizationId: dto.organizationId,
  serviceArea: serviceAreaFromWire(dto.serviceArea),
  rides: dto.rides.map(liveRideFromWire),
});

export const seatsFromWire = (dto: S['OrganizationSeatsDto']): SeatSummary => ({
  organizationId: dto.organizationId,
  activeDrivers: dto.activeDrivers,
  billedSeats: dto.billedSeats,
  renewalTotalCents: dto.renewalQuote?.totalCents ?? null,
  ledger: dto.ledger.map((entry) => ({
    id: entry.id,
    driverDisplayName: entry.driverDisplayName,
    change: entry.change,
    at: date(entry.at),
    seatsAfter: entry.seatsAfter,
    prorationCents: entry.prorationCents,
  })),
});

// ─── administration ─────────────────────────────────────────────────────────

export const statsFromWire = (dto: S['PlatformStatsDto']): PlatformStats => ({
  ridesLast7Days: dto.ridesLast7Days,
  ridesCompletedLast7Days: dto.ridesCompletedLast7Days,
  ridesNoShowLast7Days: dto.ridesNoShowLast7Days,
  ridesCancelledLast7Days: dto.ridesCancelledLast7Days,
  activeRidesNow: dto.activeRidesNow,
  staleTrackingNow: dto.staleTrackingNow,
  familiesSubscribed: dto.familiesSubscribed,
  operatorsSubscribed: dto.operatorsSubscribed,
  driversApproved: dto.driversApproved,
  driversWithExpiringDocuments: dto.driversWithExpiringDocuments,
  documentsAwaitingReview: dto.documentsAwaitingReview,
  invoicesPastDue: dto.invoicesPastDue,
  revenueCentsLast30Days: dto.revenueCentsLast30Days,
  refundedCentsLast30Days: dto.refundedCentsLast30Days,
});

export const auditEntryFromWire = (dto: S['AuditEntryDto']): AuditEntry => ({
  id: dto.id,
  at: date(dto.at),
  action: dto.action,
  entityType: dto.entityType,
  // Field names, never values — copied across as they arrive.
  changedFields: Object.freeze([...dto.changedFields]),
  actorUserId: dto.actorUserId ?? null,
  actorName: dto.actorName ?? null,
  entityId: dto.entityId ?? null,
  correlationId: dto.correlationId ?? null,
  ip: dto.ip ?? null,
});

export const auditPageFromWire = (dto: S['AuditPageDto']): AuditPage => ({
  entries: dto.entries.map(auditEntryFromWire),
  nextCursor: dto.nextCursor ?? null,
});

export const flagFromWire = (dto: S['FeatureFlagDto']): FeatureFlag => ({
  key: dto.key,
  description: dto.description,
  enabled: dto.enabled,
  rolloutPercent: dto.rolloutPercent,
  updatedAt: date(dto.updatedAt),
  updatedByName: dto.updatedByName ?? null,
});

/**
 * Dropped on an unknown status: `pending` means money may still be moving and
 * `failed` means it did not go. A fourth value under a borrowed label could
 * invite either mistake.
 */
export function refundFromWire(dto: S['RefundDto']): Refund | null {
  const status = parseRefundStatus(dto.status);
  if (status === null) return null;
  return {
    id: dto.id,
    invoiceId: dto.invoiceId,
    invoiceNumber: dto.invoiceNumber,
    amountCents: dto.amountCents,
    currency: dto.currency,
    reason: dto.reason,
    status,
    requestedByName: dto.requestedByName,
    createdAt: date(dto.createdAt),
    failureMessage: dto.failureMessage ?? null,
    settledAt: maybeDate(dto.settledAt),
  };
}

export const refundableFromWire = (
  dto: S['RefundableInvoiceDto'],
): RefundableInvoice => ({
  invoiceId: dto.invoiceId,
  invoiceNumber: dto.invoiceNumber,
  paymentId: dto.paymentId,
  paidCents: dto.paidCents,
  refundableCents: dto.refundableCents,
  refunds: dto.refunds.map(refundFromWire).filter((r): r is Refund => r !== null),
});

// ─── billing ────────────────────────────────────────────────────────────────

const lineFromWire = (
  dto: S['SubscriptionLineDto'] | S['InvoiceLineDto'],
): BillingLine => ({
  label: dto.label,
  quantity: dto.quantity,
  unitPriceCents: dto.unitPriceCents,
  amountCents: dto.amountCents,
});

export function quoteFromWire(
  dto: S['SubscriptionQuoteDto'] | null | undefined,
): BillingQuote | null {
  if (!dto) return null;
  const interval = parseInterval(dto.interval);
  if (interval === null) return null;
  return {
    planCode: dto.planCode,
    interval,
    seats: dto.seats,
    billableSeats: dto.billableSeats,
    lines: dto.lines.map(lineFromWire),
    totalCents: dto.totalCents,
  };
}

export function planFromWire(dto: S['SubscriptionPlanDto']): OperatorPlan | null {
  const interval = parseInterval(dto.interval);
  if (interval === null) return null;
  return {
    code: dto.code,
    version: dto.version,
    interval,
    name: dto.name,
    description: dto.description,
    basePriceCents: dto.basePriceCents,
    includedSeats: dto.includedSeats,
    seatTiers: dto.seatTiers.map((t) => ({
      upToSeats: t.upToSeats ?? null,
      unitPriceCents: t.unitPriceCents,
    })),
    entitlements: [...dto.entitlements],
    trialDays: dto.trialDays,
    graceDays: dto.graceDays,
  };
}

export function subscriptionFromWire(
  dto: S['SubscriptionDto'] | null | undefined,
): OperatorSubscription | null {
  if (!dto) return null;
  const status = parseSubscriptionStatus(dto.status);
  const interval = parseInterval(dto.interval);
  const renewalQuote = quoteFromWire(dto.renewalQuote);
  if (status === null || interval === null || renewalQuote === null) return null;
  return {
    id: dto.id,
    status,
    interval,
    planCode: dto.planCode,
    planName: dto.planName,
    seats: dto.seats,
    currentPeriodStart: date(dto.currentPeriodStart),
    currentPeriodEnd: date(dto.currentPeriodEnd),
    entitlements: [...dto.entitlements],
    renewalQuote,
    carriedCreditCents: dto.carriedCreditCents,
    trialEndsAt: maybeDate(dto.trialEndsAt),
    pastDueSince: maybeDate(dto.pastDueSince),
    cancelRequestedAt: maybeDate(dto.cancelRequestedAt),
  };
}

export function invoiceFromWire(dto: S['InvoiceDto']): Invoice | null {
  const reason = parseInvoiceReason(dto.reason);
  const status = parseInvoiceStatus(dto.status);
  if (reason === null || status === null) return null;
  return {
    id: dto.id,
    number: dto.number,
    reason,
    status,
    subtotalCents: dto.subtotalCents,
    creditAppliedCents: dto.creditAppliedCents,
    totalCents: dto.totalCents,
    amountPaidCents: dto.amountPaidCents,
    lines: dto.lines.map(lineFromWire),
    issuedAt: date(dto.issuedAt),
    attemptCount: dto.attemptCount,
    paidAt: maybeDate(dto.paidAt),
    nextAttemptAt: maybeDate(dto.nextAttemptAt),
    lastFailureCode: dto.lastFailureCode ?? null,
  };
}

export function paymentMethodFromWire(
  dto: S['PaymentMethodDto'] | null | undefined,
): PaymentMethod | null {
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

/**
 * A subscription this build cannot decode collapses to "no plan" — the safe
 * direction: it offers a subscribe control the server will accept or refuse
 * plainly, rather than showing a plan whose status the console cannot name.
 */
export const accountFromWire = (dto: S['BillingAccountDto']): BillingAccount => ({
  id: dto.id,
  billingEmail: dto.billingEmail,
  amountDueCents: dto.amountDueCents,
  organizationId: dto.organizationId ?? null,
  subscription: subscriptionFromWire(dto.subscription),
  paymentMethod: paymentMethodFromWire(dto.paymentMethod),
});
