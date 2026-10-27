import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { LocationService, SharingState } from '../services/locationService';
import type { DriverState, DriverStore } from './driverStore';

const StoreContext = createContext<DriverStore | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: DriverStore;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): DriverStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider is missing');
  return store;
}

export function useDriver(): DriverState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useSharing(): SharingState {
  const location: LocationService = useStore().location;
  return useSyncExternalStore(location.subscribe, location.getState, location.getState);
}

/** Whether the page is on screen. A browser stops delivering positions when it is not. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
