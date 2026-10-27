/**
 * The whole of what one signed-in user can see, as one immutable value, with
 * the lookups screens use. Mirrors lib/data/care_state.dart.
 */
import {
  appointmentEndsAt,
  type AppNotification,
  type AppUser,
  type Appointment,
  type Clinic,
  type Patient,
  type Ride,
} from '../domain/models';
import {
  accessCan,
  type FamilyPermission,
  type PatientAccess,
} from '../domain/permissions';
import {
  appointmentIsUpcoming,
  rideAllowsLocationSharing,
  rideIsTerminal,
} from '../domain/statuses';

export interface CareState {
  user: AppUser | null;
  patients: Patient[];
  /** Keyed by patient id — the authorisation edge. */
  access: Record<string, PatientAccess>;
  clinics: Clinic[];
  appointments: Appointment[];
  rides: Ride[];
  notifications: AppNotification[];
  selectedPatientId: string | null;
  /** Larger type throughout. */
  simplifiedMode: boolean;
}

export const emptyCareState: CareState = {
  user: null,
  patients: [],
  access: {},
  clinics: [],
  appointments: [],
  rides: [],
  notifications: [],
  selectedPatientId: null,
  simplifiedMode: false,
};

export const isSignedIn = (s: CareState) => s.user !== null;

export const can = (s: CareState, patientId: string, permission: FamilyPermission) => {
  const access = s.access[patientId];
  return access ? accessCan(access, permission) : false;
};

/**
 * Whether this account may see anything at all about a person. The lookups
 * below are plain searches over memory, not authorisation — anything that puts
 * a person on screen resolves through here first, so a revoked grant closes
 * every surface at once.
 */
export const canView = (s: CareState, patientId: string) =>
  can(s, patientId, 'viewProfile');

export const patientById = (s: CareState, id: string) =>
  s.patients.find((p) => p.id === id) ?? null;
export const clinicById = (s: CareState, id: string) =>
  s.clinics.find((c) => c.id === id) ?? null;
export const appointmentById = (s: CareState, id: string) =>
  s.appointments.find((a) => a.id === id) ?? null;
export const rideById = (s: CareState, id: string) =>
  s.rides.find((r) => r.id === id) ?? null;

export const activePatients = (s: CareState) =>
  s.patients.filter((p) => p.archivedAt === null && canView(s, p.id));

export function selectedPatient(s: CareState): Patient | null {
  const id = s.selectedPatientId;
  if (id === null || !canView(s, id)) return null;
  return patientById(s, id);
}

/** Soonest first. */
export const appointmentsFor = (s: CareState, patientId: string) =>
  s.appointments
    .filter((a) => a.patientId === patientId)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

export const upcomingFor = (s: CareState, patientId: string, now: Date) =>
  appointmentsFor(s, patientId).filter(
    (a) =>
      appointmentIsUpcoming(a.status) && appointmentEndsAt(a).getTime() > now.getTime(),
  );

/** Newest first. */
export const pastFor = (s: CareState, patientId: string, now: Date) =>
  appointmentsFor(s, patientId)
    .filter(
      (a) =>
        !appointmentIsUpcoming(a.status) ||
        appointmentEndsAt(a).getTime() < now.getTime(),
    )
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

export const nextAppointmentFor = (s: CareState, patientId: string, now: Date) =>
  upcomingFor(s, patientId, now)[0] ?? null;

export const ridesFor = (s: CareState, patientId: string) =>
  s.rides
    .filter((r) => r.patientId === patientId)
    .sort((a, b) => a.scheduledPickupAt.getTime() - b.scheduledPickupAt.getTime());

export const ridesForAppointment = (s: CareState, appointmentId: string) =>
  s.rides
    .filter((r) => r.appointmentId === appointmentId)
    .sort((a, b) => a.scheduledPickupAt.getTime() - b.scheduledPickupAt.getTime());

export const rideIsActive = (r: Ride) => !rideIsTerminal(r.status);
export const rideIsTrackable = (r: Ride) => rideAllowsLocationSharing(r.status);

/**
 * The rides that deserve the top of the dashboard: every one being tracked
 * right now, earliest pickup first — two can overlap, and the one a family is
 * not shown is the one they cannot follow — or, when none is moving, the next
 * one requested.
 */
export function activeRidesFor(s: CareState, patientId: string): Ride[] {
  const candidates = ridesFor(s, patientId).filter(rideIsActive);
  const moving = candidates.filter((r) => rideAllowsLocationSharing(r.status));
  if (moving.length > 0) return moving;
  return candidates.slice(0, 1);
}

/** The first of `activeRidesFor`, for places with room for one. */
export function activeRideFor(s: CareState, patientId: string): Ride | null {
  return activeRidesFor(s, patientId)[0] ?? null;
}

export const unreadNotificationCount = (s: CareState) =>
  s.notifications.filter((n) => n.readAt === null).length;

export const notificationsNewestFirst = (s: CareState) =>
  [...s.notifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

/** Ride ids the server's preview runner is driving, read off the snapshot. */
export const runningPreviewRideIds = (s: CareState) =>
  new Set(s.rides.filter((r) => r.simulationActive).map((r) => r.id));
