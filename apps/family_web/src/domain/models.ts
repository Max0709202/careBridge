/**
 * Domain entities. Mirrors lib/domain/models.dart.
 *
 * Two absences are deliberate and load-bearing: there is **no date of birth**
 * (AgeBand covers mobility planning without identifying anyone), and **no
 * clinical data** (AppointmentType is a coordination label, never a condition).
 */
import type { PriceEstimate } from './pricing';
import type { AppointmentStatus, RideStatus } from './statuses';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Address {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** "Gate code 4417", "use the rear door" — what stops a driver waiting at the wrong entrance. */
  accessNotes: string | null;
  coordinates: Coordinates | null;
}

export const addressSingleLine = (a: Address) =>
  [a.line1, ...(a.line2 ? [a.line2] : []), a.city, `${a.state} ${a.postalCode}`].join(
    ', ',
  );

export const addressShortLine = (a: Address) => `${a.line1}, ${a.city}`;

export const AGE_BANDS = ['under65', 'from65to74', 'from75to84', 'over85'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const ageBandLabel: Record<AgeBand, string> = {
  under65: 'Under 65',
  from65to74: '65–74',
  from75to84: '75–84',
  over85: '85 or older',
};

export const MOBILITY_NEEDS = [
  'walker',
  'wheelchair',
  'cane',
  'oxygen',
  'transferAssistance',
  'escortToDoor',
  'lowVision',
  'hardOfHearing',
  'memorySupport',
] as const;
export type MobilityNeed = (typeof MOBILITY_NEEDS)[number];
export const mobilityNeedLabel: Record<MobilityNeed, string> = {
  walker: 'Uses a walker',
  wheelchair: 'Uses a wheelchair',
  cane: 'Uses a cane',
  oxygen: 'Travels with oxygen',
  transferAssistance: 'Needs help transferring',
  escortToDoor: 'Needs escorting to the door',
  lowVision: 'Low vision',
  hardOfHearing: 'Hard of hearing',
  memorySupport: 'Needs memory support',
};

/** Needs that constrain which vehicle can be sent, as opposed to how to help. */
export const needConstrainsVehicle = (need: MobilityNeed) =>
  need === 'wheelchair' || need === 'oxygen';

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  /** Null until proven. Nothing is blocked on it, but invitations require it. */
  emailVerifiedAt: Date | null;
  timeZone: string;
}

export const userIsEmailVerified = (user: AppUser) => user.emailVerifiedAt !== null;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (first === '') return '?';
  if (parts.length === 1) return first[0]!.toUpperCase();
  return (first[0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export interface Patient {
  id: string;
  /** Required. Someone must be greeted by the name they actually use. */
  preferredName: string;
  legalName: string | null;
  phone: string;
  homeAddress: Address;
  ageBand: AgeBand | null;
  preferredLanguage: string;
  /** Insertion-ordered, as the server sent them. */
  mobilityNeeds: MobilityNeed[];
  mobilityNotes: string | null;
  emergencyContacts: EmergencyContact[];
  preferredClinicId: string | null;
  archivedAt: Date | null;
}

export const patientRequiresWheelchair = (p: Patient) =>
  p.mobilityNeeds.includes('wheelchair');
export const patientRequiresAssistance = (p: Patient) =>
  p.mobilityNeeds.includes('escortToDoor') ||
  p.mobilityNeeds.includes('transferAssistance');
export const patientFirstInitial = (p: Patient) =>
  p.preferredName === '' ? '?' : p.preferredName[0]!.toUpperCase();

export interface Clinic {
  id: string;
  name: string;
  phone: string;
  address: Address;
  /** Where the car should actually stop. */
  entranceNotes: string | null;
  operatingNotes: string | null;
}

export const APPOINTMENT_TYPES = [
  'primaryCare',
  'specialist',
  'imaging',
  'labWork',
  'therapy',
  'dental',
  'vision',
  'followUp',
  'other',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
/** Coarse on purpose: the specialty itself is clinical information we do not need. */
export const appointmentTypeLabel: Record<AppointmentType, string> = {
  primaryCare: 'Primary care',
  specialist: 'Specialist visit',
  imaging: 'Imaging',
  labWork: 'Lab work',
  therapy: 'Therapy',
  dental: 'Dental',
  vision: 'Vision',
  followUp: 'Follow-up',
  other: 'Other',
};

export interface StatusChange {
  at: Date;
  from: string;
  to: string;
  actor: string;
  reason: string | null;
}

export interface Appointment {
  id: string;
  patientId: string;
  clinicId: string;
  startsAt: Date;
  expectedDurationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  /** Logistics only. Never symptoms, diagnoses or medication. */
  coordinationNotes: string | null;
  transportRequired: boolean;
  timeZoneLabel: string;
  history: StatusChange[];
  createdAt: Date | null;
}

export const appointmentEndsAt = (a: Appointment) =>
  new Date(a.startsAt.getTime() + a.expectedDurationMinutes * 60_000);

export interface Vehicle {
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
}

export const vehicleDescription = (v: Vehicle) => `${v.color} ${v.make} ${v.model}`;

export interface Driver {
  id: string;
  /** First name and last initial: enough to recognise at the kerb, not to look up. */
  displayName: string;
  vehicle: Vehicle;
  rating: number;
  yearsDriving: number;
}

export type RideDirection = 'outbound' | 'returnTrip';
export const rideDirectionLabel: Record<RideDirection, string> = {
  outbound: 'To the clinic',
  returnTrip: 'Home again',
};

export interface RideEvent {
  at: Date;
  title: string;
  detail: string | null;
  /** Delays, no-shows and reassignments — rendered as something to read. */
  isException: boolean;
}

/**
 * The bounds a position report is judged against, shared with the write path so
 * what the server refuses to store and what this app refuses to show agree.
 */
export const TrackingFreshness = {
  staleMs: 45_000,
  lostMs: 120_000,
} as const;

export interface TrackingPoint {
  coordinates: Coordinates;
  /** When the *device* took the reading. Everything is aged against this. */
  capturedAt: Date;
  accuracyMeters: number;
}

/**
 * The more recent of two readings, compared on when the device took them —
 * never on which arrived first.
 */
export function newerPoint(
  a: TrackingPoint | null | undefined,
  b: TrackingPoint | null | undefined,
): TrackingPoint | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.capturedAt.getTime() > a.capturedAt.getTime() ? b : a;
}

export interface Ride {
  id: string;
  patientId: string;
  appointmentId: string | null;
  roundTripGroupId: string | null;
  direction: RideDirection;
  pickup: Address;
  destination: Address;
  scheduledPickupAt: Date;
  /** The return leg is dispatched when the visit ends, not at a guessed time. */
  flexibleReturn: boolean;
  status: RideStatus;
  wheelchairRequired: boolean;
  assistanceRequired: boolean;
  notesForDriver: string | null;
  driver: Driver | null;
  estimate: PriceEstimate;
  isDelayed: boolean;
  delayReason: string | null;
  cancellationReason: string | null;
  events: RideEvent[];
  history: StatusChange[];
  lastKnownPosition: TrackingPoint | null;
  etaMinutes: number | null;
  /**
   * The road to the stop the car is heading for, while it is being tracked.
   * Null means draw no route — the map shows a guide line instead.
   */
  route: Coordinates[] | null;
  createdAt: Date | null;
  /** Whether the server's preview runner is driving this ride. */
  simulationActive: boolean;
}

export const NOTIFICATION_KINDS = [
  'appointmentCreated',
  'appointmentReminder',
  'appointmentChanged',
  'appointmentCanceled',
  'rideRequested',
  'driverAssigned',
  'driverEnRoute',
  'driverArrivingSoon',
  'driverArrived',
  'patientPickedUp',
  'patientArrived',
  'rideDelayed',
  'rideCompleted',
  'rideCanceled',
  'accessGranted',
  'messageReceived',
  'callMissed',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationIsUrgent = (kind: NotificationKind) =>
  kind === 'driverArrived' || kind === 'rideDelayed' || kind === 'rideCanceled';

/**
 * Bodies are deliberately contentless — no clinic, address, time or name. A
 * phone on a kitchen table is readable by whoever is in the room.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  rideId: string | null;
  appointmentId: string | null;
  /** A message or missed call: the thread it opens. */
  conversationId: string | null;
}
