/**
 * The live map: where the operator works, and where its cars are.
 *
 * Positions are aged against when the **device** took the reading, never when
 * the console received it, with the same two thresholds the server enforces
 * (apps/api/src/domain/tracking.ts `TrackingFreshness`). Past `staleMs` the
 * marker says it may be out of date; past `lostMs` it is not drawn at all — a
 * confident pin over a position nobody has heard from is the one thing this
 * screen must not show.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type ServiceArea =
  | { kind: 'radius'; center: Coordinates; radiusMiles: number }
  | { kind: 'polygon'; points: Coordinates[] };

export interface LivePosition extends Coordinates {
  accuracyMeters: number;
  capturedAt: Date;
}

export interface LiveRide {
  rideId: string;
  status: string;
  driverId: string;
  driverName: string;
  patientName: string;
  scheduledPickupAt: Date;
  pickup: Coordinates | null;
  destination: Coordinates | null;
  position: LivePosition | null;
  etaMinutes: number | null;
  isDelayed: boolean;
  /**
   * The road the ETA was last computed along, to the stop the car is heading
   * for now. Null means draw no route: the map falls back to a guide line.
   */
  route: LiveRoute | null;
}

export interface LiveRoute {
  target: 'pickup' | 'destination';
  path: Coordinates[];
}

export interface LiveBoard {
  organizationId: string;
  serviceArea: ServiceArea | null;
  rides: LiveRide[];
}

export const TrackingFreshness = {
  staleMs: 45 * 1000,
  lostMs: 2 * 60 * 1000,
} as const;

export type Freshness = 'fresh' | 'stale' | 'lost';

export function freshnessOf(position: LivePosition | null, now: Date): Freshness {
  if (!position) return 'lost';
  const age = now.getTime() - position.capturedAt.getTime();
  if (age > TrackingFreshness.lostMs) return 'lost';
  if (age > TrackingFreshness.staleMs) return 'stale';
  return 'fresh';
}

/**
 * A pushed position replaces the snapshot's only if it is newer. Socket
 * messages and the polled snapshot race, and an older reading arriving second
 * must not move the car backwards.
 */
export function withPosition(
  ride: LiveRide,
  position: LivePosition,
  etaMinutes: number | null,
): LiveRide {
  if (ride.position && ride.position.capturedAt >= position.capturedAt) return ride;
  return { ...ride, position, etaMinutes };
}

/** What the dispatcher reads next to a car. */
export function rideStatusLabel(status: string): string {
  switch (status) {
    case 'assigned':
      return 'Assigned';
    case 'driverAccepted':
      return 'Accepted';
    case 'driverEnRoute':
      return 'On the way to pickup';
    case 'driverArrived':
      return 'At pickup';
    case 'passengerOnboard':
    case 'inProgress':
      return 'Passenger on board';
    case 'arrivedAtDestination':
      return 'At destination';
    default:
      return status;
  }
}

export const MILES_TO_METERS = 1609.344;
