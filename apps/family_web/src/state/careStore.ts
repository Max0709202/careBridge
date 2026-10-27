/**
 * The state everything reads. Mirrors CareNotifier in lib/state/providers.dart.
 *
 * Every method posts to the API and replaces the state with the snapshot the
 * server returns, so the server — not this class — decides what a status change
 * implies, which notifications it produces, and whether the caller was allowed
 * to ask.
 */
import type { CareApi, ClinicInput, PatientInput } from '../api/careApi';
import { networkFailure, validationFailure } from '../api/failures';
import type { AppointmentType, Clinic } from '../domain/models';
import type { FamilyPermission } from '../domain/permissions';
import {
  emptyCareState,
  isSignedIn,
  patientById,
  runningPreviewRideIds,
  type CareState,
} from './careState';

type Listener = () => void;

/**
 * Four seconds: the position arrives by push over the tracking socket, so what
 * is left for the poll is status changes, which happen seconds apart at most.
 */
const POLL_MS = 4_000;

/**
 * While a family is watching a real trip. The position arrives by push; this
 * is the backup for when the socket has dropped — a phone moving from Wi-Fi to
 * mobile data — so the screen catches up rather than freezing on the last
 * reading and calling it lost. The same interval as the ops console's map.
 */
const LIVE_POLL_MS = 15_000;

export class CareStore {
  private state: CareState = emptyCareState;
  private previews: Set<string> = new Set();
  private readonly listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollEveryMs: number | null = null;
  private liveWatchers = 0;

  constructor(readonly api: CareApi) {}

  // ─── subscription (useSyncExternalStore) ──────────────────────────────────

  getState = (): CareState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Ride ids the *server* is driving with the preview runner, from the snapshot. */
  isPreviewRunning(rideId: string): boolean {
    return this.previews.has(rideId);
  }

  // ─── session ──────────────────────────────────────────────────────────────

  /**
   * Restores a stored session before the first render, so a returning user
   * never sees the sign-in screen flash past. Never throws: the worst case is
   * starting signed out.
   */
  async restoreSession(): Promise<void> {
    try {
      const snapshot = await this.api.restore();
      if (snapshot) this.apply(snapshot);
    } catch {
      this.reset();
    }
  }

  async signIn(email: string, password: string, mfaCode?: string): Promise<void> {
    // A courtesy so the form can point at a field before a round trip; the
    // server validates independently.
    if (email.trim() === '' || !email.includes('@')) {
      throw validationFailure('Enter the email address you signed up with.', 'email');
    }
    if (password === '') throw validationFailure('Enter your password.', 'password');
    this.apply(await this.api.signIn({ email, password, mfaCode }));
  }

  async register(input: {
    fullName: string;
    email: string;
    password: string;
    acceptedTerms?: boolean;
  }): Promise<void> {
    if (input.fullName.trim() === '')
      throw validationFailure('Enter your name.', 'fullName');
    if (!input.email.includes('@')) {
      throw validationFailure('Enter a valid email address.', 'email');
    }
    if (input.password.length < 10) {
      throw validationFailure(
        'Use at least 10 characters. Length matters more than symbols.',
        'password',
      );
    }
    this.apply(
      await this.api.register({
        fullName: input.fullName,
        email: input.email,
        password: input.password,
        acceptedTerms: input.acceptedTerms ?? true,
      }),
    );
  }

  async signOut(): Promise<void> {
    this.stopPolling();
    await this.api.signOut();
    this.reset();
  }

  /**
   * Drops the local session without calling the server — for when the server
   * has already ended it (sign out everywhere, a password change, deletion).
   */
  forgetSession(): void {
    this.api.tokens.clear();
    this.reset();
  }

  async acceptInvitation(token: string): Promise<void> {
    this.apply(await this.api.acceptInvitation(token));
  }

  /** Re-reads the snapshot. */
  async refresh(): Promise<void> {
    if (!isSignedIn(this.state)) return;
    this.apply(await this.api.state());
  }

  // ─── patients ─────────────────────────────────────────────────────────────

  async selectPatient(patientId: string): Promise<void> {
    this.apply(await this.api.selectPatient(patientId));
  }

  /** An id already in state is an update; anything else is new. */
  async savePatient(patientId: string | null, patient: PatientInput): Promise<void> {
    const exists = patientId !== null && patientById(this.state, patientId) !== null;
    this.apply(
      exists
        ? await this.api.updatePatient(patientId, patient)
        : await this.api.createPatient(patient),
    );
  }

  async archivePatient(patientId: string): Promise<void> {
    this.apply(await this.api.archivePatient(patientId));
  }

  async setPermissions(
    patientId: string,
    permissions: FamilyPermission[],
  ): Promise<void> {
    this.apply(await this.api.setPermissions(patientId, permissions));
  }

  /**
   * Adds a clinic and returns it **as the server stored it**: the appointment
   * form selects it straight away, and a locally invented id would fail the
   * next request. Identified by diffing ids, then confirming on the submitted
   * fields — clinics are shared, so another family could add one at the same
   * moment.
   */
  async addClinic(clinic: ClinicInput): Promise<Clinic> {
    const before = new Set(this.state.clinics.map((c) => c.id));
    this.apply(await this.api.addClinic(clinic));

    const added = this.state.clinics.filter((c) => !before.has(c.id));
    const match = added.find(
      (c) =>
        c.name === clinic.name.trim() &&
        c.address.line1 === clinic.line1.trim() &&
        c.address.postalCode === clinic.postalCode.trim(),
    );
    const found = match ?? added[0];
    if (found) return found;

    throw networkFailure(
      'The clinic was saved but could not be loaded. Pull to refresh.',
    );
  }

  // ─── appointments ─────────────────────────────────────────────────────────

  async createAppointment(input: {
    patientId: string;
    clinicId: string;
    startsAt: Date;
    expectedDurationMinutes: number;
    type: AppointmentType;
    coordinationNotes: string | null;
    transportRequired: boolean;
  }): Promise<void> {
    this.apply(await this.api.createAppointment(input));
  }

  async rescheduleAppointment(appointmentId: string, startsAt: Date): Promise<void> {
    this.apply(await this.api.rescheduleAppointment(appointmentId, startsAt));
  }

  async cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
    this.apply(await this.api.cancelAppointment(appointmentId, reason));
  }

  // ─── transportation ───────────────────────────────────────────────────────

  async requestTransport(input: {
    appointmentId: string;
    pickupAt: Date;
    roundTrip: boolean;
    notesForDriver: string | null;
  }): Promise<void> {
    this.apply(await this.api.requestTransport(input));
  }

  async cancelRide(rideId: string, reason: string): Promise<void> {
    this.apply(await this.api.cancelRide(rideId, reason));
  }

  async setDelay(rideId: string, delayed: boolean, reason?: string): Promise<void> {
    this.apply(await this.api.setDelay(rideId, delayed, reason));
  }

  // ─── notifications & preferences ──────────────────────────────────────────

  async markNotificationRead(id: string): Promise<void> {
    this.apply(await this.api.markNotificationRead(id));
  }

  async markAllNotificationsRead(): Promise<void> {
    this.apply(await this.api.markAllNotificationsRead());
  }

  async setSimplifiedMode(enabled: boolean): Promise<void> {
    this.apply(await this.api.setSimplifiedMode(enabled));
  }

  // ─── preview trip ─────────────────────────────────────────────────────────

  /**
   * Asks the **server** to drive a ride through its lifecycle, standing in for
   * the driver app. It runs server-side, so closing the tab does not stop it
   * and every family member watching sees the same thing.
   */
  async startPreviewTrip(rideId: string): Promise<void> {
    this.apply(await this.api.startPreviewTrip(rideId));
  }

  async stopPreviewTrip(rideId: string): Promise<void> {
    this.apply(await this.api.stopPreviewTrip(rideId));
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private apply(snapshot: CareState): void {
    this.state = snapshot;
    this.previews = runningPreviewRideIds(snapshot);
    this.syncPolling();
    this.notify();
  }

  private reset(): void {
    this.stopPolling();
    this.previews = new Set();
    this.state = emptyCareState;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Polls only while the server is running a trip. A permanent poll would keep
   * a device awake and a database busy for the 99% of the time nothing moves.
   */
  /**
   * Polls as a backup while a screen shows a live trip, until the returned
   * function is called. Counted, so two screens watching do not stop each
   * other's poll.
   */
  watchLiveTrip(): () => void {
    this.liveWatchers += 1;
    this.syncPolling();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.liveWatchers -= 1;
      this.syncPolling();
    };
  }

  private syncPolling(): void {
    const every =
      this.previews.size > 0 ? POLL_MS : this.liveWatchers > 0 ? LIVE_POLL_MS : null;
    if (every === this.pollEveryMs) return;
    this.stopPolling();
    if (every === null) return;
    this.pollTimer = setInterval(() => void this.poll(), every);
    this.pollEveryMs = every;
  }

  private async poll(): Promise<void> {
    // A hidden tab has nobody looking at the car; it catches up when shown.
    if (this.previews.size === 0 && document.visibilityState === 'hidden') return;
    try {
      this.apply(await this.api.state());
    } catch {
      // A dropped poll is not worth interrupting the screen for. The next tick
      // tries again, and the freshness label already says the position is ageing.
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.pollEveryMs = null;
  }
}
