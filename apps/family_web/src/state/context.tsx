import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { CareApi } from '../api/careApi';
import type { TrackingSocket, TrackingUpdate } from '../api/trackingSocket';
import type { CareState } from './careState';
import type { CareStore } from './careStore';
import { serverNow } from '../core/serverClock';

interface Services {
  store: CareStore;
  api: CareApi;
  tracking: TrackingSocket;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return (
    <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
  );
}

function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider is missing');
  return services;
}

export const useStore = () => useServices().store;
export const useApi = () => useServices().api;

/** The current snapshot; re-renders whenever the server hands back a new one. */
export function useCare(): CareState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * The current time, ticking once a second when `live` — so freshness ages
 * ("updated 12 seconds ago") stay honest without every component owning a
 * timer. Mirrors `tickerProvider`.
 */
export function useNow(live = false): Date {
  // The server's clock, not this device's: a reading's age is measured against
  // the clock that judged it. See core/serverClock.ts.
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(serverNow()), 1_000);
    return () => clearInterval(timer);
  }, [live]);
  return live ? now : serverNow();
}

/**
 * The latest live update for one ride, while the calling screen is mounted.
 * `null` subscribes to nothing — for a screen that has not yet established it
 * may show this ride. Unmounting unsubscribes, and the last unsubscribe drops the socket — a
 * subscription that outlived its screen would keep a patient's position
 * flowing to a page nobody is looking at.
 */
export function useLiveTracking(rideId: string | null): TrackingUpdate | null {
  const { tracking } = useServices();
  const [latest, setLatest] = useState<TrackingUpdate | null>(null);
  useEffect(() => {
    setLatest(null);
    if (rideId === null) return;
    return tracking.watch(rideId, setLatest);
  }, [tracking, rideId]);
  return latest;
}
