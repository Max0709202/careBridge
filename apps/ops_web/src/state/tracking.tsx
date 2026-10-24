import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { TrackingSocket } from '../api/trackingSocket';
import { withPosition, type LiveBoard, type LiveRide } from '../domain/liveMap';

/**
 * The tracking socket, for the screens that show a moving car.
 *
 * Optional on purpose: without one the live map still works from the polled
 * snapshot, only slower — which is also exactly what it does while the socket
 * is reconnecting.
 */
const TrackingContext = createContext<TrackingSocket | null>(null);

export function TrackingProvider(props: { socket: TrackingSocket | null; children: ReactNode }) {
  return <TrackingContext.Provider value={props.socket}>{props.children}</TrackingContext.Provider>;
}

/**
 * The board's rides with pushed positions laid over the snapshot.
 *
 * One `watch` per ride on screen, and only while it is on screen. A ride the
 * server closes (finished, or no longer ours) keeps its last snapshot until the
 * next poll drops it — the server's answer, not a guess here.
 */
export function useLiveRides(board: LiveBoard | null): LiveRide[] {
  const socket = useContext(TrackingContext);
  const [pushed, setPushed] = useState<Record<string, Pick<LiveRide, 'position' | 'etaMinutes'>>>({});

  const rideIds = useMemo(() => (board ? board.rides.map((r) => r.rideId).sort() : []), [board]);
  const watchKey = rideIds.join(',');

  useEffect(() => {
    if (!socket || rideIds.length === 0) return;
    const stops = rideIds.map((rideId) =>
      socket.watch(rideId, (update) => {
        if (update.type !== 'position') return;
        setPushed((current) => ({
          ...current,
          [rideId]: { position: update.position, etaMinutes: update.etaMinutes },
        }));
      }),
    );
    return () => stops.forEach((stop) => stop());
    // `watchKey` stands for `rideIds`: re-subscribe when the set changes, not on every poll.
  }, [socket, watchKey]);

  return useMemo(
    () =>
      (board?.rides ?? []).map((ride) => {
        const live = pushed[ride.rideId];
        return live?.position ? withPosition(ride, live.position, live.etaMinutes) : ride;
      }),
    [board, pushed],
  );
}

/** The current time, re-read on an interval, so ages on screen keep counting between updates. */
export function useNow(everyMs = 5_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
