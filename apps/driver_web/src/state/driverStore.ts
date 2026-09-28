/**
 * The state every screen reads. A port of lib/state/providers.dart.
 *
 * The work list re-reads itself here rather than on a screen, and following
 * the active job is a consequence of reading it: a driver who has navigated
 * away is still driving, and the family's map must not stop because a
 * component unmounted.
 */
import type { DriverDocuments, DocumentKind } from '../api/codec';
import type { DriverApi } from '../api/driverApi';
import { Failure, validationFailure } from '../api/failures';
import { activeJob, type DriverProfile, type Job } from '../domain/models';
import type { RideStatus } from '../domain/rideStatus';
import { prepareDocument } from '../services/documentFile';
import type { LocationService } from '../services/locationService';

/** A value that is fetched: kept while it is re-fetched, so a poll never blanks a screen. */
export interface Loadable<T> {
  value: T | null;
  error: unknown;
  loading: boolean;
}

const unloaded = { value: null, error: null, loading: false } as const;

export interface DriverState {
  /** Whether a session exists as far as this device knows — never "is the token valid". */
  signedIn: boolean;
  profile: Loadable<DriverProfile>;
  jobs: Loadable<Job[]>;
  documents: Loadable<DriverDocuments>;
}

const signedOut: DriverState = {
  signedIn: false,
  profile: unloaded,
  jobs: unloaded,
  documents: unloaded,
};

/**
 * Twenty seconds, as in the app: a dispatcher can assign a ride at any moment,
 * and this runs on cellular data all day. The position stream — the part that
 * has to be prompt — is pushed, not polled.
 */
export const JOBS_POLL_MS = 20_000;

type Key = 'profile' | 'jobs' | 'documents';

export class DriverStore {
  private state: DriverState = signedOut;
  private readonly listeners = new Set<() => void>();
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly api: DriverApi,
    readonly location: LocationService,
  ) {}

  getState = (): DriverState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ─── session ──────────────────────────────────────────────────────────────

  /** Before the first render, so a returning driver never sees sign-in flash past. */
  async restoreSession(): Promise<void> {
    if (!this.api.tokens.read()) return;
    this.set({ signedIn: true });
    this.startPolling();
    // Not awaited: the screens show their own progress, and a slow network
    // should not hold the whole app on a splash.
    void this.refreshAll();
  }

  async signIn(email: string, password: string, mfaCode?: string): Promise<void> {
    if (email.trim() === '') throw validationFailure('Enter your email address.', 'email');
    if (password === '') throw validationFailure('Enter your password.', 'password');
    await this.api.signIn({ email, password, mfaCode });
    this.set({ ...signedOut, signedIn: true });
    this.startPolling();
    void this.refreshProfile();
    void this.refreshJobs();
  }

  /**
   * Sampling stops before the session does: a service still holding a queue
   * after sign-out would try to flush it with a token that no longer exists.
   */
  async signOut(): Promise<void> {
    this.stopPolling();
    this.location.stop();
    await this.api.signOut();
    this.state = signedOut;
    this.emit();
  }

  /** Drops the local session when the server has already ended it. */
  forgetSession(): void {
    this.stopPolling();
    this.location.stop();
    this.api.tokens.clear();
    this.state = signedOut;
    this.emit();
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  refreshProfile(): Promise<void> {
    return this.load('profile', () => this.api.profile());
  }

  refreshDocuments(): Promise<void> {
    return this.load('documents', () => this.api.documents());
  }

  async refreshJobs(): Promise<void> {
    await this.load('jobs', () => this.api.jobs());
    const jobs = this.state.jobs.value;
    if (this.state.signedIn && jobs) void this.location.follow(activeJob(jobs));
  }

  refreshAll(): Promise<unknown> {
    return Promise.all([this.refreshProfile(), this.refreshJobs()]);
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  /** Moves a ride along and refreshes everything the move can change. */
  async advance(rideId: string, to: RideStatus): Promise<void> {
    await this.guard(() => this.api.advance(rideId, to));
    await Promise.all([this.refreshJobs(), this.refreshProfile()]);
  }

  /** The server refuses an end-of-shift with a passenger in the car, and says why. */
  async setShift(onShift: boolean): Promise<void> {
    const profile = await this.guard(() => this.api.setShift(onShift));
    this.set({ profile: { value: profile, error: null, loading: false } });
    await this.refreshJobs();
  }

  /**
   * Authorise, upload, confirm. The bytes never pass through the API: the
   * server signs a URL for exactly this file, the browser PUTs straight to
   * storage, and the server then checks storage rather than believing us.
   */
  async uploadDocument(kind: DocumentKind, file: File): Promise<void> {
    const { body, contentType } = await prepareDocument(file);
    const documents = await this.guard(async () => {
      const slot = await this.api.authoriseUpload({ kind, contentType });
      await this.api.uploadBytes(slot, body);
      return this.api.confirmUpload(slot.documentId);
    });
    this.set({ documents: { value: documents, error: null, loading: false } });
    void this.refreshProfile();
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    this.poll = setInterval(() => {
      if (this.state.signedIn) void this.refreshJobs();
    }, JOBS_POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }

  private async load<K extends Key>(key: K, fetch: () => Promise<NonNullable<DriverState[K]['value']>>) {
    if (!this.state.signedIn) return;
    this.set({ [key]: { ...this.state[key], loading: true } } as Partial<DriverState>);
    try {
      const value = await fetch();
      if (!this.state.signedIn) return;
      this.set({ [key]: { value, error: null, loading: false } } as Partial<DriverState>);
    } catch (error) {
      if (this.sessionEnded(error)) return;
      this.set({ [key]: { ...this.state[key], error, loading: false } } as Partial<DriverState>);
    }
  }

  private async guard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.sessionEnded(error);
      throw error;
    }
  }

  /** A refresh that failed has already cleared the tokens; follow it to sign-in. */
  private sessionEnded(error: unknown): boolean {
    if (error instanceof Failure && error.kind === 'authentication' && !this.api.tokens.read()) {
      this.forgetSession();
      return true;
    }
    return false;
  }

  private set(patch: Partial<DriverState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
