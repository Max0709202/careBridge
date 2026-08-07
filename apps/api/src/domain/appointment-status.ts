import { InvalidTransitionError } from '../common/errors';
import type { RideStatus } from './ride-status';

/**
 * The lifecycle of an appointment. Mirrors lib/domain/appointment_status.dart.
 *
 * CareBridge *records* appointments; it does not book them into a clinic
 * system. `confirmed` therefore means "a human confirmed this with the clinic",
 * not "an integration returned success".
 */
export type AppointmentStatus =
  | 'draft'
  | 'scheduled'
  | 'confirmed'
  | 'patientPreparing'
  | 'transportationScheduled'
  | 'patientEnRoute'
  | 'patientArrived'
  | 'completed'
  | 'canceled'
  | 'missed';

const TERMINAL = new Set<AppointmentStatus>(['completed', 'canceled', 'missed']);

export function isTerminalAppointmentStatus(status: AppointmentStatus): boolean {
  return TERMINAL.has(status);
}

const ALLOWED: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  draft: ['scheduled', 'canceled'],
  scheduled: [
    'confirmed',
    'transportationScheduled',
    'patientPreparing',
    'canceled',
    'missed',
  ],
  confirmed: [
    'transportationScheduled',
    'patientPreparing',
    'canceled',
    'missed',
  ],
  transportationScheduled: [
    'patientPreparing',
    'patientEnRoute',
    'canceled',
    'missed',
  ],
  patientPreparing: ['patientEnRoute', 'canceled', 'missed'],
  patientEnRoute: ['patientArrived', 'canceled', 'missed'],
  patientArrived: ['completed', 'canceled'],
  completed: [],
  canceled: [],
  missed: [],
};

export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (!canTransitionAppointment(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * The appointment status implied by a ride reaching `rideStatus`.
 *
 * Ride progress drives appointment progress — the family should not have to
 * keep two things in their head. Returns null when the ride change implies
 * nothing about the appointment.
 */
export function appointmentStatusForRide(
  rideStatus: RideStatus,
): AppointmentStatus | null {
  switch (rideStatus) {
    case 'assigned':
      return 'transportationScheduled';
    case 'driverArrived':
      return 'patientPreparing';
    case 'passengerOnboard':
      return 'patientEnRoute';
    case 'arrivedAtDestination':
      return 'patientArrived';
    default:
      return null;
  }
}
