/**
 * Appointment and ride lifecycles. Mirrors lib/domain/appointment_status.dart
 * and lib/domain/ride_status.dart. The server's state machine is the one that
 * decides; this copy exists for labels and for hiding controls that would be
 * refused.
 */

// ─── appointments ────────────────────────────────────────────────────────────

export const APPOINTMENT_STATUSES = [
  'draft',
  'scheduled',
  'confirmed',
  'patientPreparing',
  'transportationScheduled',
  'patientEnRoute',
  'patientArrived',
  'completed',
  'canceled',
  'missed',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  patientPreparing: 'Getting ready',
  transportationScheduled: 'Transport booked',
  patientEnRoute: 'On the way',
  patientArrived: 'Arrived at the clinic',
  completed: 'Completed',
  canceled: 'Canceled',
  missed: 'Missed',
};

export const appointmentIsTerminal = (status: AppointmentStatus) =>
  status === 'completed' || status === 'canceled' || status === 'missed';

/** Appointments a family can still act on — reschedule, book transport, cancel. */
export const appointmentIsUpcoming = (status: AppointmentStatus) =>
  !appointmentIsTerminal(status);

// ─── rides ───────────────────────────────────────────────────────────────────

/**
 * `delayed` is deliberately *not* a status: a driver stuck in traffic on the way
 * to pickup is still `driverEnRoute`. Delay is a flag on the ride.
 */
export const RIDE_STATUSES = [
  'draft',
  'requested',
  'awaitingAssignment',
  'assigned',
  'driverAccepted',
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
  'completed',
  'canceled',
  'noShow',
  'reassignmentRequired',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Written for a worried adult child reading it on a phone, not for an operations console. */
export const rideStatusLabel: Record<RideStatus, string> = {
  draft: 'Draft',
  requested: 'Requested',
  awaitingAssignment: 'Finding a driver',
  assigned: 'Driver assigned',
  driverAccepted: 'Driver confirmed',
  driverEnRoute: 'Driver on the way',
  driverArrived: 'Driver has arrived',
  passengerOnboard: 'Picked up',
  inProgress: 'On the way to the clinic',
  arrivedAtDestination: 'Arrived at the clinic',
  completed: 'Completed',
  canceled: 'Canceled',
  noShow: 'No show',
  reassignmentRequired: 'Needs a new driver',
};

export const rideIsTerminal = (status: RideStatus) =>
  status === 'completed' || status === 'canceled' || status === 'noShow';

const locationSharing: ReadonlySet<RideStatus> = new Set([
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
]);

/**
 * The single definition of "tracking is legal right now". Tracking begins when
 * the driver sets off and ends the moment the ride reaches a terminal state.
 */
export const rideAllowsLocationSharing = (status: RideStatus) => locationSharing.has(status);

/** Whether the patient is physically in the vehicle. */
export const ridePassengerIsOnboard = (status: RideStatus) =>
  status === 'passengerOnboard' || status === 'inProgress';
