/**
 * The console's HTTP client. A port of apps/ops_console/lib/data/ops_api.dart.
 *
 * One client, because it owns refresh: two clients each retrying a 401 will
 * eventually both present the same rotated refresh token, and reuse detection
 * signs a dispatcher out mid-shift.
 *
 * Everything operational is scoped by an organisation id in the path. That
 * scoping **is** the authorisation: an id belonging to another company answers
 * 404, indistinguishable from one that does not exist, and this client must
 * not invent a distinction it was not given.
 */
import type { AuditFilter, AuditPage, FeatureFlag, PlatformStats, RefundableInvoice } from '../domain/admin';
import type { BillingAccount, BillingInterval, Invoice, OperatorPlan, PaymentMethod } from '../domain/billing';
import type { DriverStatus } from '../domain/dispatch';
import type { DispatchQueue, Driver, Organization, SeatSummary, Vehicle } from '../domain/models';
import {
  accountFromWire,
  auditPageFromWire,
  driverFromWire,
  flagFromWire,
  invoiceFromWire,
  organizationFromWire,
  paymentMethodFromWire,
  planFromWire,
  queueFromWire,
  refundableFromWire,
  seatsFromWire,
  statsFromWire,
  vehicleFromWire,
  type DocumentViewUrl,
  type DriverAccountMatch,
  type DriverCompliance,
} from './codec';
import { Failure } from './failures';
import { newId } from './ids';
import type { components } from './schema';
import type { TokenStore } from './tokens';
import { ApiTransport } from './transport';

type S = components['schemas'];

const notNull = <T,>(value: T | null): value is T => value !== null;
const seg = encodeURIComponent;

export class OpsApi extends ApiTransport {
  constructor(tokens: TokenStore, baseUrl?: string, fetchImpl?: typeof fetch) {
    super(tokens, baseUrl, fetchImpl);
  }

  private org(organizationId: string, rest = '') {
    return `/organizations/${seg(organizationId)}${rest}`;
  }

  // ─── session ──────────────────────────────────────────────────────────────

  async signIn(input: { email: string; password: string; mfaCode?: string }): Promise<void> {
    const json = await this.send<{ accessToken?: unknown; refreshToken?: unknown }>('POST', '/auth/login', {
      body: {
        email: input.email.trim(),
        password: input.password,
        ...(input.mfaCode ? { mfaCode: input.mfaCode.trim() } : {}),
      },
      authenticated: false,
    });
    this.storeSession(json);
  }

  /**
   * Ends the session on the server and, whatever happens there, on this
   * machine. A dispatcher walking away from a shared terminal cannot be left
   * signed in because a request timed out.
   */
  async signOut(): Promise<void> {
    const stored = this.tokens.read();
    try {
      if (stored) await this.send('POST', '/auth/logout', { body: { refreshToken: stored.refreshToken } });
    } catch {
      // Already going; the local half below is the part that matters.
    } finally {
      this.tokens.clear();
    }
  }

  // ─── organisations ────────────────────────────────────────────────────────

  /** Somebody can dispatch for two operators, and picking one is a decision rather than a default. */
  async organizations(): Promise<Organization[]> {
    return (await this.sendList<S['OrganizationDto']>('GET', '/organizations')).map(organizationFromWire);
  }

  // ─── the queue ────────────────────────────────────────────────────────────

  async queue(organizationId: string): Promise<DispatchQueue> {
    return queueFromWire(await this.send<S['DispatchQueueDto']>('GET', this.org(organizationId, '/dispatch/queue')));
  }

  /**
   * Gives a ride to a driver, or moves it to another one. `reason` is required
   * by the server when taking a ride off a driver who already had it.
   * Idempotency-keyed: at the HTTP level a retry is indistinguishable from a
   * second decision.
   */
  async assign(input: {
    organizationId: string;
    rideId: string;
    driverId: string;
    reason?: string;
  }): Promise<DispatchQueue> {
    return queueFromWire(
      await this.send<S['DispatchQueueDto']>(
        'POST',
        this.org(input.organizationId, `/dispatch/rides/${seg(input.rideId)}/assign`),
        {
          idempotencyKey: newId(),
          body: { driverId: input.driverId, ...(input.reason ? { reason: input.reason } : {}) },
        },
      ),
    );
  }

  // ─── roster and fleet ─────────────────────────────────────────────────────

  async drivers(organizationId: string): Promise<Driver[]> {
    return (await this.sendList<S['DriverDto']>('GET', this.org(organizationId, '/drivers')))
      .map(driverFromWire)
      .filter(notNull);
  }

  async setDriverStatus(input: {
    organizationId: string;
    driverId: string;
    to: DriverStatus;
    reason?: string;
  }): Promise<Driver | null> {
    return driverFromWire(
      await this.send<S['DriverDto']>('POST', this.org(input.organizationId, `/drivers/${seg(input.driverId)}/status`), {
        body: { to: input.to, ...(input.reason ? { reason: input.reason } : {}) },
      }),
    );
  }

  async setShift(input: { organizationId: string; driverId: string; onShift: boolean }): Promise<Driver | null> {
    return driverFromWire(
      await this.send<S['DriverDto']>('PUT', this.org(input.organizationId, `/drivers/${seg(input.driverId)}/shift`), {
        body: { onShift: input.onShift },
      }),
    );
  }

  /**
   * The account somebody signed up with, by its exact address. Anything that
   * cannot be added — no account, unverified, already a driver — is one
   * validation failure, deliberately: the server will not say which.
   */
  lookupDriverAccount(input: { organizationId: string; email: string }): Promise<DriverAccountMatch> {
    return this.send<DriverAccountMatch>('POST', this.org(input.organizationId, '/drivers/account-lookup'), {
      body: { email: input.email.trim() },
    });
  }

  /**
   * Puts a driver on the roster. With `userId` (from `lookupDriverAccount`)
   * the account is linked at once and the driver starts pending approval;
   * with only `email`, they claim the place when they first open the app.
   */
  async addDriver(input: {
    organizationId: string;
    displayName: string;
    vehicleId: string;
    yearsDriving?: number;
    userId?: string;
    email?: string;
  }): Promise<Driver | null> {
    return driverFromWire(
      await this.send<S['DriverDto']>('POST', this.org(input.organizationId, '/drivers'), {
        idempotencyKey: newId(),
        body: {
          displayName: input.displayName.trim(),
          vehicleId: input.vehicleId,
          ...(input.yearsDriving !== undefined ? { yearsDriving: input.yearsDriving } : {}),
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.email ? { email: input.email.trim() } : {}),
        },
      }),
    );
  }

  async vehicles(organizationId: string): Promise<Vehicle[]> {
    return (await this.sendList<S['VehicleDto']>('GET', this.org(organizationId, '/vehicles'))).map(vehicleFromWire);
  }

  async addVehicle(input: {
    organizationId: string;
    make: string;
    model: string;
    color: string;
    licensePlate: string;
    isWheelchairAccessible: boolean;
  }): Promise<Vehicle> {
    return vehicleFromWire(
      await this.send<S['VehicleDto']>('POST', this.org(input.organizationId, '/vehicles'), {
        idempotencyKey: newId(),
        body: {
          make: input.make.trim(),
          model: input.model.trim(),
          color: input.color.trim(),
          licensePlate: input.licensePlate.trim(),
          isWheelchairAccessible: input.isWheelchairAccessible,
        },
      }),
    );
  }

  // ─── paperwork ────────────────────────────────────────────────────────────

  documentsFor(organizationId: string, driverId: string): Promise<DriverCompliance> {
    return this.send<DriverCompliance>('GET', this.org(organizationId, `/drivers/${seg(driverId)}/documents`));
  }

  /**
   * A short-lived link to one document. A POST rather than a GET because it
   * is not a read: it mints a credential and writes an audit row saying that a
   * named person looked at a named driver's licence.
   */
  viewDocument(organizationId: string, driverId: string, documentId: string): Promise<DocumentViewUrl> {
    return this.send<DocumentViewUrl>(
      'POST',
      this.org(organizationId, `/drivers/${seg(driverId)}/documents/${seg(documentId)}/view`),
    );
  }

  reviewDocument(input: {
    organizationId: string;
    driverId: string;
    documentId: string;
    approve: boolean;
    note?: string;
  }): Promise<DriverCompliance> {
    return this.send<DriverCompliance>(
      'POST',
      this.org(input.organizationId, `/drivers/${seg(input.driverId)}/documents/${seg(input.documentId)}/review`),
      {
        body: {
          decision: input.approve ? 'approved' : 'rejected',
          ...(input.note ? { note: input.note } : {}),
        },
      },
    );
  }

  // ─── seats ────────────────────────────────────────────────────────────────

  async seats(organizationId: string): Promise<SeatSummary> {
    return seatsFromWire(await this.send<S['OrganizationSeatsDto']>('GET', this.org(organizationId, '/seats')));
  }

  // ─── the operator's subscription ──────────────────────────────────────────
  //
  // The second payer (ADR-0011). A role that may work the queue is not
  // necessarily one that may change what the company is billed; the server
  // decides that.

  async billing(organizationId: string): Promise<BillingAccount> {
    return accountFromWire(await this.send<S['BillingAccountDto']>('GET', this.org(organizationId, '/billing')));
  }

  /**
   * The operator side of the catalogue, filtered by the server through
   * `?payer=` — a console that filtered client-side would be one release away
   * from offering a household plan to a transport company.
   */
  async plans(): Promise<OperatorPlan[]> {
    return (await this.sendList<S['SubscriptionPlanDto']>('GET', '/billing/plans?payer=dispatchOrganization'))
      .map(planFromWire)
      .filter(notNull);
  }

  async invoices(organizationId: string): Promise<Invoice[]> {
    return (await this.sendList<S['InvoiceDto']>('GET', this.org(organizationId, '/billing/invoices')))
      .map(invoiceFromWire)
      .filter(notNull);
  }

  async subscribe(input: {
    organizationId: string;
    planCode: string;
    interval: BillingInterval;
  }): Promise<BillingAccount> {
    return accountFromWire(
      await this.send<S['BillingAccountDto']>('POST', this.org(input.organizationId, '/billing/subscribe'), {
        // A double-click on a slow connection must not start two subscriptions.
        idempotencyKey: newId(),
        body: { planCode: input.planCode, interval: input.interval },
      }),
    );
  }

  async changeInterval(organizationId: string, interval: BillingInterval): Promise<BillingAccount> {
    return accountFromWire(
      await this.send<S['BillingAccountDto']>('POST', this.org(organizationId, '/billing/change-interval'), {
        body: { interval },
      }),
    );
  }

  async cancelSubscription(organizationId: string): Promise<BillingAccount> {
    return accountFromWire(await this.send<S['BillingAccountDto']>('POST', this.org(organizationId, '/billing/cancel')));
  }

  /**
   * Puts a card on the account. `token` comes **directly from the payment
   * processor** — no endpoint accepts a card number and this method cannot be
   * given one (ADR-0006).
   */
  async attachPaymentMethod(organizationId: string, token: string): Promise<PaymentMethod | null> {
    return paymentMethodFromWire(
      await this.send<S['PaymentMethodDto']>('POST', this.org(organizationId, '/billing/payment-method'), {
        idempotencyKey: newId(),
        body: { token },
      }),
    );
  }

  async detachPaymentMethod(organizationId: string, paymentMethodId: string): Promise<void> {
    await this.send('DELETE', this.org(organizationId, `/billing/payment-method/${seg(paymentMethodId)}`));
  }

  /** Charges an open invoice now — for the moment after a declined card is replaced. */
  async payInvoice(organizationId: string, invoiceId: string): Promise<Invoice | null> {
    return invoiceFromWire(
      await this.send<S['InvoiceDto']>('POST', this.org(organizationId, `/billing/invoices/${seg(invoiceId)}/pay`)),
    );
  }

  // ─── administration ───────────────────────────────────────────────────────
  //
  // Not scoped by organisation. `PlatformRoleGuard` decides per request and
  // refuses with the same 404 every other lookup uses. Support reads and admin
  // writes; the console cannot tell which it holds, so it offers the write
  // controls and renders a refusal plainly.

  /**
   * Whether this account can see the administration surface at all — a probe
   * rather than a claim: the server deliberately does not say what platform
   * standing a caller holds. Any failure answers false; an item briefly
   * missing during an outage is a smaller wrong than one that then 404s.
   */
  async hasPlatformAccess(): Promise<boolean> {
    try {
      await this.stats();
      return true;
    } catch (error) {
      if (error instanceof Failure) return false;
      throw error;
    }
  }

  async stats(): Promise<PlatformStats> {
    return statsFromWire(await this.send<S['PlatformStatsDto']>('GET', '/admin/stats'));
  }

  /**
   * One keyset page of the audit log. `cursor` comes from the previous page
   * and nothing else — a hand-built one silently omits rows appended while
   * somebody was reading.
   */
  async auditLog(filter: AuditFilter = {}, cursor?: string | null): Promise<AuditPage> {
    const query = new URLSearchParams();
    if (filter.action) query.set('action', filter.action);
    if (filter.entityType) query.set('entityType', filter.entityType);
    if (filter.entityId) query.set('entityId', filter.entityId);
    if (cursor) query.set('cursor', cursor);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return auditPageFromWire(await this.send<S['AuditPageDto']>('GET', `/admin/audit${suffix}`));
  }

  async flags(): Promise<FeatureFlag[]> {
    return (await this.sendList<S['FeatureFlagDto']>('GET', '/admin/flags')).map(flagFromWire);
  }

  /**
   * Creates or updates a flag. `confirmNarrowing` is sent only when the
   * console has actually asked — always sending it would turn a deliberate
   * speed bump into a field nobody reads.
   */
  async setFlag(input: {
    key: string;
    description: string;
    enabled: boolean;
    rolloutPercent: number;
    confirmNarrowing?: boolean;
  }): Promise<FeatureFlag[]> {
    return (
      await this.sendList<S['FeatureFlagDto']>('PUT', `/admin/flags/${seg(input.key)}`, {
        body: {
          description: input.description.trim(),
          enabled: input.enabled,
          rolloutPercent: input.rolloutPercent,
          ...(input.confirmNarrowing ? { confirmNarrowing: true } : {}),
        },
      })
    ).map(flagFromWire);
  }

  async refundable(invoiceId: string): Promise<RefundableInvoice> {
    return refundableFromWire(
      await this.send<S['RefundableInvoiceDto']>('GET', `/admin/invoices/${seg(invoiceId)}/refunds`),
    );
  }

  /**
   * Sends money back. `paymentId` is carried from the lookup, so a refund
   * cannot land on a payment the reader was not looking at.
   */
  async issueRefund(input: {
    invoiceId: string;
    paymentId: string;
    amountCents: number;
    reason: string;
  }): Promise<RefundableInvoice> {
    return refundableFromWire(
      await this.send<S['RefundableInvoiceDto']>('POST', `/admin/invoices/${seg(input.invoiceId)}/refunds`, {
        // A retried refund must not be a second one.
        idempotencyKey: newId(),
        body: { paymentId: input.paymentId, amountCents: input.amountCents, reason: input.reason.trim() },
      }),
    );
  }
}
