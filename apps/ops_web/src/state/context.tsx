import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { OpsApi } from '../api/opsApi';
import { canDispatch, type Organization } from '../domain/models';
import {
  keys,
  UNLOADED,
  type Loadable,
  type OpsStore,
  type SessionState,
} from './opsStore';

const StoreContext = createContext<OpsStore | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: OpsStore;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): OpsStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider is missing');
  return store;
}

export function useSession(): SessionState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSession, store.getSession);
}

export type Resource<T> = Loadable<T> & { reload: () => void };

/**
 * Reads one resource, loading it on mount. `key` null means "not yet
 * resolvable" (no operator chosen) and reads as unloaded.
 *
 * `pollMs` re-reads on an interval while mounted, and immediately whenever
 * the tab comes back on screen — a queue left open all day must show a ride a
 * family booked two minutes ago without anybody pressing anything.
 */
export function useResource<T>(
  key: string | null,
  fetcher: (api: OpsApi) => Promise<T>,
  options: { pollMs?: number } = {},
): Resource<T> {
  const store = useStore();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => (key ? store.read<T>(key) : UNLOADED),
    () => (key ? store.read<T>(key) : UNLOADED),
  );

  useEffect(() => {
    if (!key) return;
    return store.mount(key, () => fetcherRef.current(store.api));
  }, [store, key]);

  const { pollMs } = options;
  useEffect(() => {
    if (!key || !pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void store.reload(key);
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void store.reload(key);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, key, pollMs]);

  const reload = useCallback(() => {
    if (key) void store.reload(key);
  }, [store, key]);

  return { ...snapshot, reload };
}

export function useOrganizations(): Resource<Organization[]> {
  return useResource(keys.organizations, (api) => api.organizations());
}

/**
 * The organisation in force, resolved against the memberships. Null while the
 * list loads, and null when the chosen id is no longer in it — a membership
 * revoked while the tab was open.
 */
export function useSelectedOrganization(): Organization | null {
  const { organizationId } = useSession();
  const organizations = useOrganizations();
  if (!organizationId || !organizations.value) return null;
  return (
    organizations.value.find((o) => o.id === organizationId && canDispatch(o)) ?? null
  );
}

/** Whether to show the Administration door. Its own probe, so a slow dashboard cannot hide it. */
export function usePlatformAccess(): boolean {
  return (
    useResource(keys.platformAccess, (api) => api.hasPlatformAccess()).value ?? false
  );
}

/**
 * The operator in force, for a screen inside the console shell. The shell's
 * guard guarantees one is chosen; the id is what every scoped key is built from.
 */
export function useOperatorId(): string {
  const { organizationId } = useSession();
  if (!organizationId) throw new Error('useOperatorId outside the console shell');
  return organizationId;
}
