/**
 * What the console renders, independent of the wire. A port of
 * apps/ops_console/lib/domain/models.dart.
 *
 * A dispatcher **is** supposed to see a patient's name, pickup address and
 * pickup time — they are arranging the car. What they never see is anything
 * clinical, because nothing clinical is stored.
 */
import {
  isAssignable,
  reasonLabel,
  type DispatchUrgency,
  type DriverStatus,
  type IneligibilityReason,
} from './dispatch';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
}

/** The way a dispatcher would say it: "Silver Toyota Sienna". */
export const vehicleLabel = (v: Pick<Vehicle, 'color' | 'make' | 'model'>) => `${v.color} ${v.make} ${v.model}`;

export interface Driver {
  id: string;
  /** First name and last initial — no full legal name exists to display. */
  displayName: string;
  status: DriverStatus;
  /** Working right now. Separate from `status`, the company's standing decision. */
  onShift: boolean;
  rating: number;
  yearsDriving: number;
  vehicle: Vehicle;
  occupiesSeat: boolean;
  activeRideCount: number;
  approvedAt: Date | null;
  suspensionReason: string | null;
}

export const isFree = (d: Driver) => d.activeRideCount === 0;

/** Whether this driver could take a trip needing no special vehicle. */
export const isAvailableNow = (d: Driver) => isAssignable(d.status) && d.onShift && isFree(d);

/** A driver considered for one specific ride, with every reason they cannot take it. */
export interface Candidate {
  driverId: string;
  displayName: string;
  eligible: boolean;
  reasons: IneligibilityReason[];
  /**
   * Reasons this build does not know the name of. Carried rather than dropped:
   * an unrecognised reason still means the driver cannot take the trip.
   */
  unrecognisedReasons: string[];
}

export const reasonLabels = (c: Candidate): string[] => [
  ...c.reasons.map((r) => reasonLabel[r]),
  ...c.unrecognisedReasons,
];

export interface QueueItem {
  rideId: string;
  status: string;
  patientName: string;
  pickupLine: string;
  destinationLine: string;
  scheduledPickupAt: Date;
  wheelchairRequired: boolean;
  assistanceRequired: boolean;
  urgency: DispatchUrgency;
  /**
   * Whether the pickup is inside the operator's service area. Null when no
   * area is set or the address was never located — unknown, not inside.
   * Advisory: the server does not refuse assignment on it.
   */
  pickupInServiceArea: boolean | null;
  candidates: Candidate[];
}

export const eligibleCandidates = (item: QueueItem) => item.candidates.filter((c) => c.eligible);

export const hasAnyoneAvailable = (item: QueueItem) => item.candidates.some((c) => c.eligible);

/**
 * Whether this ride is being taken off a driver who already had it. It needs a
 * reason, and the family's timeline records that the first driver dropped it.
 */
export const isReassignment = (item: QueueItem) => item.status === 'reassignmentRequired';

export interface DispatchQueue {
  organizationId: string;
  items: QueueItem[];
  /** Drivers on shift and free right now, across the whole roster. */
  availableDrivers: number;
}

/**
 * Rides nobody on the roster can currently take — the number a dispatcher acts
 * on first: trips that will not happen unless somebody makes a phone call.
 */
export const strandedCount = (q: DispatchQueue) => q.items.filter((i) => !hasAnyoneAvailable(i)).length;

export const overdueCount = (q: DispatchQueue) => q.items.filter((i) => i.urgency === 'overdue').length;

/** An organisation the signed-in user holds a role in. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  /** `owner`, `admin`, `dispatcher` or `member`. */
  role: string;
}

/**
 * Whether this role may change a driver's standing or add a vehicle. Approving
 * a driver moves a billable seat, which is an owner's or an admin's decision.
 * Mirrored from `requireMembership`; the server is what enforces it.
 */
export const canAdminister = (o: Organization) => o.role === 'owner' || o.role === 'admin';

export const canDispatch = (o: Organization) => canAdminister(o) || o.role === 'dispatcher';

export interface SeatLedgerEntry {
  id: string;
  driverDisplayName: string;
  /** `granted` or `released`. */
  change: string;
  at: Date;
  seatsAfter: number;
  /** Charged immediately on a grant. Zero on a release — a released seat is not refunded. */
  prorationCents: number;
}

export const isGrant = (e: SeatLedgerEntry) => e.change === 'granted';

export interface SeatSummary {
  organizationId: string;
  /** Drivers on the road right now. */
  activeDrivers: number;
  /** Drivers the current subscription is billing for. */
  billedSeats: number;
  renewalTotalCents: number | null;
  ledger: SeatLedgerEntry[];
}

/**
 * Drivers approved since the last renewal and not yet billed at renewal. Not a
 * discrepancy: a seat granted mid-period is charged by proration now and folded
 * into the recurring amount at renewal.
 */
export const pendingAtRenewal = (s: SeatSummary) => s.activeDrivers - s.billedSeats;
