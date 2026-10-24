/**
 * The console's state. A port of apps/ops_console/lib/state/providers.dart.
 *
 * Two parts. The **session** — signed in or not, and which operator is being
 * dispatched for — is plain state the router reads. Everything fetched is a
 * **resource**: a keyed cache entry, loaded when a screen mounts it and
 * re-read when something invalidates it. That is Riverpod's
 * `FutureProvider.family` + `ref.invalidate`, and the keys mirror the family
 * arguments, so an organisation id is always part of the key for anything
 * scoped by one.
 */
import { Failure, validationFailure } from '../api/failures';
import type { OpsApi } from '../api/opsApi';

/** A value that is fetched: kept while it is re-fetched, so a poll never blanks a screen. */
export interface Loadable<T> {
  value: T | null;
  error: unknown;
  loading: boolean;
}

export const UNLOADED: Loadable<never> = Object.freeze({ value: null, error: null, loading: false });

export interface SessionState {
  /** Whether a session exists as far as this tab knows — never "is the token valid". */
  signedIn: boolean;
  /**
   * Which operator the console is showing. Null until chosen: defaulting to
   * the first would mean a queue that looks empty because it belongs to the
   * wrong operator, which reads as "no work" rather than "wrong screen".
   */
  organizationId: string | null;
}

/** Resource keys. Organisation-scoped ones carry the id, as the provider families do. */
export const keys = {
  organizations: 'organizations',
  platformAccess: 'platformAccess',
  platformStats: 'admin/stats',
  flags: 'admin/flags',
  plans: 'billing/plans',
  queue: (org: string) => `org/${org}/queue`,
  liveBoard: (org: string) => `org/${org}/live`,
  drivers: (org: string) => `org/${org}/drivers`,
  vehicles: (org: string) => `org/${org}/vehicles`,
  seats: (org: string) => `org/${org}/seats`,
  billing: (org: string) => `org/${org}/billing`,
  invoices: (org: string) => `org/${org}/invoices`,
  documents: (org: string, driver: string) => `org/${org}/drivers/${driver}/documents`,
};

/**
 * Kept per tab (sessionStorage), so a reload keeps the dispatcher on the queue
 * they chose. Not localStorage: a second tab is a second decision, and a
 * choice must never outlive the session that made it.
 */
const ORGANIZATION_KEY = 'carebridge.ops.organizationId';

type Fetcher = () => Promise<unknown>;

export class OpsStore {
  private session: SessionState = { signedIn: false, organizationId: null };
  private readonly entries = new Map<string, Loadable<unknown>>();
  private readonly fetchers = new Map<string, Fetcher>();
  private readonly mounts = new Map<string, number>();
  private readonly sequence = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly api: OpsApi,
    private readonly storage: Storage | undefined = safeSessionStorage(),
  ) {}

  getSession = (): SessionState => this.session;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ─── session ──────────────────────────────────────────────────────────────

  /** Before the first render, so a returning dispatcher never sees sign-in flash past. */
  restoreSession(): void {
    if (!this.api.tokens.read()) return;
    this.session = { signedIn: true, organizationId: this.readStoredOrganization() };
    this.emit();
  }

  async signIn(email: string, password: string, mfaCode?: string): Promise<void> {
    if (email.trim() === '') throw validationFailure('Enter your email address.', 'email');
    if (password === '') throw validationFailure('Enter your password.', 'password');
    await this.api.signIn({ email, password, mfaCode });
    this.resetCache();
    this.session = { signedIn: true, organizationId: null };
    this.emit();
  }

  /**
   * The next person at this terminal is a different person. Everything cached
   * goes — platform standing most of all: leaving it would show them an
   * Administration door that then 404s.
   */
  async signOut(): Promise<void> {
    await this.api.signOut();
    this.forgetSession();
  }

  /** Ends the session locally after the server has refused a token. */
  forgetSession(): void {
    this.api.tokens.clear();
    this.writeStoredOrganization(null);
    this.resetCache();
    this.session = { signedIn: false, organizationId: null };
    this.emit();
  }

  selectOrganization(organizationId: string | null): void {
    if (this.session.organizationId === organizationId) return;
    this.writeStoredOrganization(organizationId);
    this.session = { ...this.session, organizationId };
    this.emit();
  }

  // ─── resources ────────────────────────────────────────────────────────────

  read<T>(key: string): Loadable<T> {
    return (this.entries.get(key) as Loadable<T> | undefined) ?? UNLOADED;
  }

  /**
   * A screen starts using `key`. Loads it if nothing is cached — including
   * after an invalidation while nobody was looking. Returns the release.
   */
  mount(key: string, fetcher: Fetcher): () => void {
    this.fetchers.set(key, fetcher);
    this.mounts.set(key, (this.mounts.get(key) ?? 0) + 1);
    if (!this.entries.has(key)) void this.reload(key);
    return () => {
      const left = (this.mounts.get(key) ?? 1) - 1;
      if (left <= 0) this.mounts.delete(key);
      else this.mounts.set(key, left);
    };
  }

  /** Re-reads one resource, keeping what it held so the screen does not blank. */
  async reload(key: string): Promise<void> {
    const fetcher = this.fetchers.get(key);
    if (!fetcher || !this.session.signedIn) return;

    const ticket = (this.sequence.get(key) ?? 0) + 1;
    this.sequence.set(key, ticket);
    this.setEntry(key, { ...this.read(key), loading: true });

    try {
      const value = await fetcher();
      if (this.sequence.get(key) !== ticket || !this.session.signedIn) return;
      this.setEntry(key, { value, error: null, loading: false });
    } catch (error) {
      if (this.sessionEnded(error)) return;
      if (this.sequence.get(key) !== ticket) return;
      this.setEntry(key, { ...this.read(key), error, loading: false });
    }
  }

  /**
   * `ref.invalidate` for each key: re-read now if a screen is showing it,
   * otherwise drop it so the next screen to mount it reads it fresh.
   */
  invalidate(...keyList: string[]): void {
    for (const key of keyList) {
      if ((this.mounts.get(key) ?? 0) > 0) void this.reload(key);
      else if (this.entries.delete(key)) this.emit();
    }
  }

  /**
   * Everything a dispatch decision can change. Assigning a ride moves a driver
   * out of the free pool and off the queue at once: refreshing only the queue
   * would leave the roster showing them as free.
   */
  invalidateOperational(organizationId: string): void {
    this.invalidate(keys.queue(organizationId), keys.drivers(organizationId));
  }

  /**
   * Everything one billing action can change. Approving a driver changes the
   * seat count, which changes the renewal quote, which is on another screen.
   */
  invalidateBilling(organizationId: string): void {
    this.invalidate(keys.billing(organizationId), keys.invoices(organizationId), keys.seats(organizationId));
  }

  /** Runs a write and follows a dead session to sign-in, rethrowing everything for the caller to show. */
  async guard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.sessionEnded(error);
      throw error;
    }
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  /** A refresh that failed has already cleared the tokens; follow it to sign-in. */
  private sessionEnded(error: unknown): boolean {
    if (error instanceof Failure && error.kind === 'authentication' && !this.api.tokens.read()) {
      if (this.session.signedIn) this.forgetSession();
      return true;
    }
    return false;
  }

  private resetCache(): void {
    this.entries.clear();
    // Bumping every ticket discards any response still in flight for the old session.
    for (const [key, ticket] of this.sequence) this.sequence.set(key, ticket + 1);
  }

  private setEntry(key: string, entry: Loadable<unknown>): void {
    this.entries.set(key, entry);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private readStoredOrganization(): string | null {
    try {
      return this.storage?.getItem(ORGANIZATION_KEY) || null;
    } catch {
      return null;
    }
  }

  private writeStoredOrganization(id: string | null): void {
    try {
      if (id === null) this.storage?.removeItem(ORGANIZATION_KEY);
      else this.storage?.setItem(ORGANIZATION_KEY, id);
    } catch {
      // The choice still holds for this page; it just will not survive a reload.
    }
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * How often the queue re-reads itself while on screen. Ten seconds is short
 * enough that the screen is never meaningfully wrong and long enough that a
 * room of six dispatchers is not a load test.
 */
export const QUEUE_POLL_MS = 10_000;

/**
 * The live map's snapshot. Slower than the queue because the socket moves the
 * cars in between; the poll is what adds and drops rides, and what keeps the
 * map honest when the socket is down.
 */
export const LIVE_POLL_MS = 15_000;
