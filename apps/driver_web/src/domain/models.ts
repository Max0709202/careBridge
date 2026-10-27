/** Domain types. A port of lib/domain/models.dart. */
import { toServerTime } from '../core/serverClock';
import { sharesLocation } from './driverAuthority';
import type { RideStatus } from './rideStatus';

/** A position taken by this device. */
export interface Fix {
  latitude: number;
  longitude: number;
  /**
   * When the **device** took the reading. Everything the family sees is aged
   * against this rather than arrival time, which is what makes a backlog
   * flushed after a tunnel safe to send.
   */
  capturedAt: Date;
  accuracyMeters: number;
  /** Used locally for cadence, and deliberately not sent. */
  speedMetersPerSecond: number | null;
}

/**
 * What goes on the wire. Note the absence of an ETA: the server computes that,
 * because a device that could set it could hold a family at "two minutes"
 * indefinitely.
 */
export function fixToJson(fix: Fix) {
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters,
    // Restated on the server's clock, which is what judges it.
    capturedAt: toServerTime(fix.capturedAt).toISOString(),
  };
}

export interface Vehicle {
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
}

export const vehicleDescription = (v: Vehicle) => `${v.color} ${v.make} ${v.model}`;

export interface DriverProfile {
  driverId: string;
  /** The operator. Messaging is scoped by it — colleagues are this company's drivers. */
  organizationId: string;
  organizationName: string;
  displayName: string;
  status: string;
  onShift: boolean;
  /** Approved to carry a passenger at all — distinct from being on shift. */
  canWork: boolean;
  vehicle: Vehicle;
  suspensionReason: string | null;
}

export interface Place {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** What stops a driver waiting at the wrong entrance. */
  accessNotes: string | null;
}

export function placeOneLine(place: Place): string {
  return [
    place.line1,
    place.line2 || null,
    `${place.city}, ${place.state} ${place.postalCode}`,
  ]
    .filter(Boolean)
    .join(', ');
}

export interface Job {
  id: string;
  status: RideStatus;
  scheduledPickupAt: Date;
  passengerName: string;
  passengerPhone: string | null;
  pickup: Place;
  destination: Place;
  wheelchairRequired: boolean;
  assistanceRequired: boolean;
  notesForDriver: string | null;
  isDelayed: boolean;
  /** What the server says this driver may do next. Advisory; it decides which button appears. */
  availableTransitions: RideStatus[];
  /** Seconds left on the kerbside wait, or null when a no-show is not on offer. */
  noShowAvailableInSeconds: number | null;
}

export const jobSharesLocation = (job: Job) => sharesLocation(job.status);

/**
 * The single move a driver is normally offered. `driverArrived` is the one
 * state with two, and the no-show is deliberately never the primary button.
 */
export const primaryMove = (job: Job): RideStatus | null =>
  job.availableTransitions.find((move) => move !== 'noShow') ?? null;

export const offersNoShow = (job: Job) => job.availableTransitions.includes('noShow');

/**
 * The one job the driver is actually on — at most one, because a driver is
 * only ever assigned one passenger at a time.
 */
export const activeJob = (jobs: readonly Job[]): Job | null =>
  jobs.find(jobSharesLocation) ?? null;

/** The one under way if there is one; otherwise the next thing to accept. */
export const currentJob = (jobs: readonly Job[]): Job | null =>
  activeJob(jobs) ?? jobs[0] ?? null;
