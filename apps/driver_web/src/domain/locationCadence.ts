/**
 * How often a position is taken. A port of lib/domain/location_cadence.dart.
 *
 * Cadence tracks how fast the answer is changing, not how much anyone cares
 * about it: a car stopped at a red light reports the same coordinate however
 * often it is asked. Every ordinary cadence stays inside [staleAfterMs]; only a
 * critical battery is allowed past it, to leave the driver a phone that can
 * still make a call.
 */
import { sharesLocation } from './driverAuthority';
import type { RideStatus } from './rideStatus';

/** The freshness bound the family's screen uses (apps/api/src/domain/tracking.ts). */
export const staleAfterMs = 45_000;

/**
 * Below this (m/s) the vehicle is not moving in any way the map can show. A
 * stationary fix wanders by a few metres a second, so zero would call a parked
 * car moving.
 */
export const stationarySpeed = 1.0;

export const Cadence = {
  approaching: 4_000,
  driving: 10_000,
  stopped: 25_000,
  lowBattery: 30_000,
  criticalBattery: 90_000,
} as const;

export type BatteryPressure = 'none' | 'low' | 'critical';

/**
 * Charging outranks the reading: a phone at 4% on a car charger will be at 40%
 * in half an hour. An unknown level is not a reason to back off.
 */
export function batteryPressure(
  percent: number | null,
  charging: boolean,
): BatteryPressure {
  if (charging || percent === null) return 'none';
  if (percent <= 5) return 'critical';
  if (percent <= 15) return 'low';
  return 'none';
}

export interface CadenceInputs {
  status: RideStatus;
  /** From the last fix. Null when nothing has been measured — treated as moving. */
  speedMetersPerSecond?: number | null;
  battery?: BatteryPressure;
}

function isStationary(inputs: CadenceInputs): boolean {
  const speed = inputs.speedMetersPerSecond;
  return speed !== null && speed !== undefined && speed < stationarySpeed;
}

/** Milliseconds until the next fix, or null to stop sampling entirely. */
export function cadenceFor(inputs: CadenceInputs): number | null {
  if (!sharesLocation(inputs.status)) return null;

  // Battery first, and unconditionally: this one is about whether the driver
  // still has a phone at four o'clock.
  switch (inputs.battery ?? 'none') {
    case 'critical':
      return Cadence.criticalBattery;
    case 'low':
      return Cadence.lowBattery;
    case 'none':
      break;
  }

  // Being stopped two hundred metres from the pickup is still being stopped.
  if (isStationary(inputs)) return Cadence.stopped;

  switch (inputs.status) {
    case 'driverEnRoute':
      return Cadence.approaching;
    // Parked at the kerb with the engine running: the phase says what a noisy
    // speed cannot.
    case 'driverArrived':
    case 'arrivedAtDestination':
      return Cadence.stopped;
    default:
      return Cadence.driving;
  }
}
