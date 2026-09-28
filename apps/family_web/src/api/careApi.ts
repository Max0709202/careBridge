/**
 * The HTTP client for the CareBridge API. Mirrors lib/data/care_api.dart.
 *
 * Every mutating care call returns a **whole** snapshot rather than a delta:
 * one status change can touch a ride, its appointment and the notification list
 * at once, and reassembling partial responses on the client is how a UI drifts
 * out of step with the server that is supposed to be authoritative.
 */
import type { AgeBand, AppointmentType, MobilityNeed } from '../domain/models';
import type { FamilyPermission, RelationshipType } from '../domain/permissions';
import type { CareState } from '../state/careState';
import { careStateFromJson } from './codec';
import { Failure, networkFailure } from './failures';
import { newId } from './ids';
import type { components } from './schema';
import type { TokenStore } from './tokens';
import { ApiTransport } from './transport';

type S = components['schemas'];

export type SessionSummary = S['SessionSummaryDto'];
export type MfaStatus = S['MfaStatusDto'];
export type MfaEnrolment = S['MfaEnrolmentDto'];
export type DeletionStatus = S['DeletionStatusDto'];
export type DeletionReceipt = S['DeletionReceiptDto'];
export type NotificationPreference = S['NotificationPreferenceDto'];
export type Invitation = S['InvitationDto'];
export type BillingAccount = S['BillingAccountDto'];
export type SubscriptionPlanDto = S['SubscriptionPlanDto'];
export type InvoiceDto = S['InvoiceDto'];
export type PaymentMethodDto = S['PaymentMethodDto'];

/** What the patient form submits. The server mints ids and geocodes. */
export interface PatientInput {
  preferredName: string;
  legalName: string | null;
  phone: string;
  homeAddress: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    accessNotes: string | null;
    /** Carried over on edit; never invented. */
    latitude?: number;
    longitude?: number;
  };
  ageBand: AgeBand | null;
  preferredLanguage: string;
  mobilityNeeds: MobilityNeed[];
  mobilityNotes: string | null;
  emergencyContacts: { name: string; relationship: string; phone: string; isPrimary: boolean }[];
  preferredClinicId: string | null;
}

export interface ClinicInput {
  name: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  entranceNotes: string | null;
}

export class CareApi extends ApiTransport {
  constructor(tokens: TokenStore, baseUrl?: string, fetchImpl?: typeof fetch) {
    super(tokens, baseUrl, fetchImpl);
  }

  // ─── session ──────────────────────────────────────────────────────────────

  register(input: {
    fullName: string;
    email: string;
    password: string;
    acceptedTerms: boolean;
  }): Promise<CareState> {
    return this.session('/auth/register', {
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
      acceptedTerms: input.acceptedTerms,
    });
  }

  signIn(input: { email: string; password: string; mfaCode?: string }): Promise<CareState> {
    return this.session('/auth/login', {
      email: input.email.trim(),
      password: input.password,
      ...(input.mfaCode ? { mfaCode: input.mfaCode.trim() } : {}),
    });
  }

  private async session(path: string, body: unknown): Promise<CareState> {
    const json = await this.send<S['SessionResponseDto']>('POST', path, {
      body,
      authenticated: false,
    });
    this.storeSession(json);
    return careStateFromJson(json.state);
  }

  /**
   * Signing out locally succeeds even when the server cannot be reached: the
   * refresh token is discarded either way, and the access token expires on its
   * own within minutes.
   */
  async signOut(): Promise<void> {
    const stored = this.tokens.read();
    try {
      if (stored) {
        await this.send('POST', '/auth/logout', { body: { refreshToken: stored.refreshToken } });
      }
    } catch {
      // Deliberately ignored — see above.
    } finally {
      this.tokens.clear();
    }
  }

  /** Restores a session from stored tokens, or null if there is none. */
  async restore(): Promise<CareState | null> {
    if (!this.tokens.read()) return null;
    try {
      return await this.state();
    } catch (error) {
      if (error instanceof Failure && error.kind === 'authentication') {
        this.tokens.clear();
        return null;
      }
      throw error;
    }
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  async state(): Promise<CareState> {
    return this.snapshot(this.send('GET', '/care/state'));
  }

  // ─── preferences ──────────────────────────────────────────────────────────

  setSimplifiedMode(enabled: boolean): Promise<CareState> {
    return this.snapshot(
      this.send('PATCH', '/me/preferences', { body: { simplifiedMode: enabled } }),
    );
  }

  selectPatient(patientId: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/patients/${patientId}/select`));
  }

  // ─── patients ─────────────────────────────────────────────────────────────

  /**
   * The key is generated per call rather than per retry: one tap is one key,
   * and every attempt to deliver that tap carries it.
   */
  createPatient(patient: PatientInput): Promise<CareState> {
    return this.snapshot(
      this.send('POST', '/patients', { body: patientToJson(patient), idempotencyKey: newId() }),
    );
  }

  updatePatient(patientId: string, patient: PatientInput): Promise<CareState> {
    return this.snapshot(this.send('PUT', `/patients/${patientId}`, { body: patientToJson(patient) }));
  }

  archivePatient(patientId: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/patients/${patientId}/archive`));
  }

  setPermissions(patientId: string, permissions: FamilyPermission[]): Promise<CareState> {
    return this.snapshot(
      this.send('PUT', `/patients/${patientId}/permissions`, { body: { permissions } }),
    );
  }

  // ─── the account ──────────────────────────────────────────────────────────

  sessions(): Promise<SessionSummary[]> {
    return this.sendList<SessionSummary>('GET', '/auth/sessions');
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.send('DELETE', `/auth/sessions/${sessionId}`);
  }

  /**
   * Signs out everywhere, this browser included. Local tokens are cleared
   * whatever the server said: the access token is dead on its next use anyway.
   */
  async signOutEverywhere(): Promise<void> {
    try {
      await this.send('POST', '/auth/logout-all');
    } finally {
      this.tokens.clear();
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.send('POST', '/auth/password', { body: { currentPassword, newPassword } });
  }

  deletionStatus(): Promise<DeletionStatus> {
    return this.send<DeletionStatus>('GET', '/auth/account/deletion');
  }

  exportAccount(): Promise<Record<string, unknown>> {
    return this.send('GET', '/auth/account/export');
  }

  /**
   * Schedules the deletion and returns the export. Tokens are cleared on
   * success — the server has already raised the token version — and kept on a
   * refusal, so the screen can show why.
   */
  async deleteAccount(): Promise<DeletionReceipt> {
    const receipt = await this.send<DeletionReceipt>('DELETE', '/auth/account');
    this.tokens.clear();
    return receipt;
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.send('POST', '/auth/password-reset', {
      body: { email: email.trim() },
      authenticated: false,
    });
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    await this.send('POST', '/auth/password-reset/confirm', {
      body: { token, newPassword },
      authenticated: false,
    });
  }

  async resendVerification(email: string): Promise<void> {
    await this.send('POST', '/auth/resend-verification', {
      body: { email: email.trim() },
      authenticated: false,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.send('POST', '/auth/verify-email', { body: { token }, authenticated: false });
  }

  // ─── two-factor authentication ────────────────────────────────────────────

  mfaStatus(): Promise<MfaStatus> {
    return this.send<MfaStatus>('GET', '/auth/mfa');
  }

  beginMfaEnrolment(): Promise<MfaEnrolment> {
    return this.send<MfaEnrolment>('POST', '/auth/mfa/enrol');
  }

  async confirmMfa(code: string): Promise<void> {
    await this.send('POST', '/auth/mfa/confirm', { body: { code } });
  }

  async disableMfa(): Promise<void> {
    await this.send('DELETE', '/auth/mfa');
  }

  // ─── notification preferences ─────────────────────────────────────────────

  notificationPreferences(): Promise<NotificationPreference[]> {
    return this.sendList<NotificationPreference>('GET', '/notifications/preferences');
  }

  setNotificationPreference(kind: string, channel: string, enabled: boolean) {
    return this.sendList<NotificationPreference>('PUT', '/notifications/preferences', {
      body: { kind, channel, enabled },
    });
  }

  // ─── billing ──────────────────────────────────────────────────────────────

  /**
   * The household's own subscription account, or null if it has none. Null is
   * a real state — an account from before two-sided billing has none — and
   * "choose a plan" is the honest answer to it, not "something went wrong".
   */
  async billingAccount(): Promise<BillingAccount | null> {
    const json = await this.send<BillingAccount | Record<string, never>>('GET', '/billing/account');
    return Object.keys(json).length === 0 ? null : (json as BillingAccount);
  }

  /** The catalogue. Nothing about a price or an entitlement is compiled into this app. */
  billingPlans(payer = 'family'): Promise<SubscriptionPlanDto[]> {
    return this.sendList<SubscriptionPlanDto>('GET', `/billing/plans?payer=${payer}`);
  }

  subscribe(planCode: string, interval: string): Promise<BillingAccount> {
    return this.send<BillingAccount>('POST', '/billing/subscribe', {
      body: { planCode, interval },
      // A second tap on a slow connection must not open a second subscription.
      idempotencyKey: newId(),
    });
  }

  changeBillingInterval(interval: string): Promise<BillingAccount> {
    return this.send<BillingAccount>('POST', '/billing/change-interval', { body: { interval } });
  }

  cancelSubscription(): Promise<BillingAccount> {
    return this.send<BillingAccount>('POST', '/billing/cancel');
  }

  invoices(): Promise<InvoiceDto[]> {
    return this.sendList<InvoiceDto>('GET', '/billing/invoices');
  }

  /**
   * Puts a card on file. `token` is a reference from the payment processor —
   * this app never holds a card number, and this method cannot be given one
   * (ADR-0006).
   */
  attachPaymentMethod(token: string): Promise<PaymentMethodDto> {
    return this.send<PaymentMethodDto>('POST', '/billing/payment-method', {
      body: { token },
      idempotencyKey: newId(),
    });
  }

  async detachPaymentMethod(id: string): Promise<void> {
    await this.send('DELETE', `/billing/payment-method/${id}`);
  }

  /** Charges an open invoice now — for the moment after a declined card is replaced. */
  payInvoice(id: string): Promise<InvoiceDto> {
    return this.send<InvoiceDto>('POST', `/billing/invoices/${id}/pay`);
  }

  // ─── the care circle ──────────────────────────────────────────────────────

  invitations(patientId: string): Promise<Invitation[]> {
    return this.sendList<Invitation>('GET', `/patients/${patientId}/invitations`);
  }

  invite(input: {
    patientId: string;
    email: string;
    relationship: RelationshipType;
    permissions: FamilyPermission[];
  }): Promise<Invitation> {
    return this.send<Invitation>('POST', `/patients/${input.patientId}/invitations`, {
      // A retried invitation is a second email to someone already deciding.
      idempotencyKey: newId(),
      body: {
        email: input.email.trim(),
        relationship: input.relationship,
        permissions: input.permissions,
      },
    });
  }

  async revokeInvitation(patientId: string, invitationId: string): Promise<void> {
    await this.send('DELETE', `/patients/${patientId}/invitations/${invitationId}`);
  }

  /** Returns the whole snapshot — it now includes a patient the caller could not see a moment ago. */
  acceptInvitation(token: string): Promise<CareState> {
    return this.snapshot(this.send('POST', '/invitations/accept', { body: { token } }));
  }

  // ─── clinics ──────────────────────────────────────────────────────────────

  addClinic(clinic: ClinicInput): Promise<CareState> {
    return this.snapshot(
      this.send('POST', '/clinics', { body: clinicToJson(clinic), idempotencyKey: newId() }),
    );
  }

  // ─── appointments ─────────────────────────────────────────────────────────

  createAppointment(input: {
    patientId: string;
    clinicId: string;
    startsAt: Date;
    expectedDurationMinutes: number;
    type: AppointmentType;
    coordinationNotes: string | null;
    transportRequired: boolean;
  }): Promise<CareState> {
    return this.snapshot(
      this.send('POST', '/appointments', {
        idempotencyKey: newId(),
        body: {
          patientId: input.patientId,
          clinicId: input.clinicId,
          startsAt: input.startsAt.toISOString(),
          expectedDurationMinutes: input.expectedDurationMinutes,
          type: input.type,
          ...(input.coordinationNotes ? { coordinationNotes: input.coordinationNotes } : {}),
          transportRequired: input.transportRequired,
        },
      }),
    );
  }

  rescheduleAppointment(appointmentId: string, startsAt: Date): Promise<CareState> {
    return this.snapshot(
      this.send('POST', `/appointments/${appointmentId}/reschedule`, {
        body: { startsAt: startsAt.toISOString() },
      }),
    );
  }

  cancelAppointment(appointmentId: string, reason?: string): Promise<CareState> {
    return this.snapshot(
      this.send('POST', `/appointments/${appointmentId}/cancel`, {
        body: reason ? { reason } : {},
      }),
    );
  }

  // ─── transportation ───────────────────────────────────────────────────────

  requestTransport(input: {
    appointmentId: string;
    pickupAt: Date;
    roundTrip: boolean;
    notesForDriver: string | null;
  }): Promise<CareState> {
    return this.snapshot(
      this.send('POST', '/rides', {
        // A dropped response is the case this exists for: retrying without a
        // key books a second car for the same appointment, and bills for it.
        idempotencyKey: newId(),
        body: {
          appointmentId: input.appointmentId,
          pickupAt: input.pickupAt.toISOString(),
          roundTrip: input.roundTrip,
          ...(input.notesForDriver ? { notesForDriver: input.notesForDriver } : {}),
        },
      }),
    );
  }

  cancelRide(rideId: string, reason: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/rides/${rideId}/cancel`, { body: { reason } }));
  }

  setDelay(rideId: string, delayed: boolean, reason?: string): Promise<CareState> {
    return this.snapshot(
      this.send('POST', `/rides/${rideId}/delay`, {
        body: { delayed, ...(reason ? { reason } : {}) },
      }),
    );
  }

  /** Starts the server-side preview trip — the stand-in for the driver app. */
  startPreviewTrip(rideId: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/rides/${rideId}/preview/start`));
  }

  stopPreviewTrip(rideId: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/rides/${rideId}/preview/stop`));
  }

  // ─── notifications ────────────────────────────────────────────────────────

  markNotificationRead(id: string): Promise<CareState> {
    return this.snapshot(this.send('POST', `/notifications/${id}/read`));
  }

  markAllNotificationsRead(): Promise<CareState> {
    return this.snapshot(this.send('POST', '/notifications/read-all'));
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async snapshot(pending: Promise<Record<string, unknown>>): Promise<CareState> {
    const json = await pending;
    if (!json || typeof json !== 'object' || !('user' in json)) {
      // A 2xx without a snapshot is a contract break, not "an empty family".
      throw networkFailure();
    }
    return careStateFromJson(json as unknown as S['CareStateDto']);
  }
}

// ─── encoding ───────────────────────────────────────────────────────────────

function patientToJson(p: PatientInput): S['SavePatientDto'] {
  const a = p.homeAddress;
  return {
    preferredName: p.preferredName,
    ...(p.legalName ? { legalName: p.legalName } : {}),
    phone: p.phone,
    homeAddress: {
      label: 'Home',
      line1: a.line1,
      ...(a.line2 ? { line2: a.line2 } : {}),
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      ...(a.accessNotes ? { accessNotes: a.accessNotes } : {}),
      ...(a.latitude !== undefined && a.longitude !== undefined
        ? { latitude: a.latitude, longitude: a.longitude }
        : {}),
    },
    ...(p.ageBand ? { ageBand: p.ageBand } : {}),
    preferredLanguage: p.preferredLanguage,
    mobilityNeeds: p.mobilityNeeds,
    ...(p.mobilityNotes ? { mobilityNotes: p.mobilityNotes } : {}),
    emergencyContacts: p.emergencyContacts,
    ...(p.preferredClinicId ? { preferredClinicId: p.preferredClinicId } : {}),
  } as S['SavePatientDto'];
}

/**
 * `entranceNotes` is sent exactly as the Flutter app sends it. The API's
 * SaveClinicDto accepts it, but it is missing from the OpenAPI contract (no
 * Swagger decorator), which is why this is not typed as `SaveClinicDto`.
 */
function clinicToJson(c: ClinicInput): Record<string, unknown> {
  return {
    name: c.name,
    phone: c.phone,
    address: {
      label: c.name,
      line1: c.line1,
      city: c.city,
      state: c.state,
      postalCode: c.postalCode,
    },
    ...(c.entranceNotes ? { entranceNotes: c.entranceNotes } : {}),
  };
}

