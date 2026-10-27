/**
 * Where positions and battery readings come from. Ports, as in
 * lib/services/position_source.dart, so the cadence rules and the queue are
 * testable without a satellite; the app runs the browser implementations.
 */
import type { Fix } from '../domain/models';

/**
 * Whether the browser will give this page positions.
 *
 * `blocked` covers every "no" a page cannot undo: a browser does not re-prompt
 * after a refusal, so the only way out is the site settings, and the screen
 * has to say so rather than show a button that silently fails.
 */
export type LocationAccess =
  | 'granted'
  | 'prompt'
  | 'blocked'
  | 'unavailable'
  | 'unsupported';

export interface PositionSource {
  ensureAccess(): Promise<LocationAccess>;
  /**
   * Starts delivering fixes; returns the function that stops them. A browser
   * cannot be asked for a rate — it delivers when the position changes — so
   * the cadence rule is applied by the caller, to what is kept and sent.
   */
  watch(
    onFix: (fix: Fix) => void,
    onAccess: (access: LocationAccess) => void,
  ): () => void;
}

export class BrowserPositionSource implements PositionSource {
  async ensureAccess(): Promise<LocationAccess> {
    // Geolocation exists only in a secure context: HTTPS, or localhost.
    if (
      typeof navigator === 'undefined' ||
      !('geolocation' in navigator) ||
      !window.isSecureContext
    ) {
      return 'unsupported';
    }
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (status?.state === 'denied') return 'blocked';
      if (status?.state === 'granted') return 'granted';
    } catch {
      // Some browsers do not answer the query for geolocation; asking is the
      // only way to find out.
    }
    return 'prompt';
  }

  watch(
    onFix: (fix: Fix) => void,
    onAccess: (access: LocationAccess) => void,
  ): () => void {
    const id = navigator.geolocation.watchPosition(
      (position) => {
        onAccess('granted');
        onFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          // The device's own clock — see Fix.capturedAt.
          capturedAt: new Date(position.timestamp),
          accuracyMeters: position.coords.accuracy,
          speedMetersPerSecond: position.coords.speed ?? null,
        });
      },
      (error) => {
        // A timeout is not an access problem: the next fix may simply be late.
        if (error.code === error.PERMISSION_DENIED) onAccess('blocked');
        else if (error.code === error.POSITION_UNAVAILABLE) onAccess('unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }
}

/** One look at the battery. `percent` is null when the browser will not say. */
export interface BatteryReading {
  percent: number | null;
  charging: boolean;
}

export interface BatterySource {
  read(): Promise<BatteryReading>;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
}

/**
 * The Battery Status API, where the browser has one (Chromium). Elsewhere the
 * answer is "unknown", which the cadence rule treats as "no pressure" — a
 * browser that will not say is not a reason to slow every driver's map.
 */
export class BrowserBatterySource implements BatterySource {
  async read(): Promise<BatteryReading> {
    try {
      const getBattery = (
        navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }
      ).getBattery;
      if (!getBattery) return { percent: null, charging: false };
      const battery = await getBattery.call(navigator);
      return { percent: Math.round(battery.level * 100), charging: battery.charging };
    } catch {
      return { percent: null, charging: false };
    }
  }
}

/**
 * Keeps the screen on while a ride is being shared.
 *
 * The web's stand-in for the Android foreground service, and a weaker one: a
 * browser stops delivering positions when the page is hidden or the phone
 * locks, so the best a page can do is stop the screen from locking on its own.
 */
export interface ScreenKeeper {
  acquire(): Promise<boolean>;
  release(): void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

export class BrowserScreenKeeper implements ScreenKeeper {
  private sentinel: WakeLockSentinelLike | null = null;

  async acquire(): Promise<boolean> {
    if (this.sentinel && !this.sentinel.released) return true;
    try {
      const wakeLock = (
        navigator as Navigator & {
          wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
        }
      ).wakeLock;
      if (!wakeLock || document.visibilityState !== 'visible') return false;
      this.sentinel = await wakeLock.request('screen');
      return true;
    } catch {
      // Refused (battery saver, an iframe) — the page still works, it just
      // relies on the driver keeping the screen on.
      return false;
    }
  }

  release(): void {
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }
}
