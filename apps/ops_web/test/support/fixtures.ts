import type { components } from '../../src/api/schema';

type S = components['schemas'];

export const organization = (overrides: Partial<S['OrganizationDto']> = {}): S['OrganizationDto'] => ({
  id: 'org-1',
  name: 'Meridian Transit',
  slug: 'meridian',
  kind: 'transport',
  timeZone: 'America/New_York',
  role: 'owner',
  ...overrides,
});

export const vehicle = (overrides: Partial<S['VehicleDto']> = {}): S['VehicleDto'] => ({
  id: 'vehicle-1',
  make: 'Toyota',
  model: 'Sienna',
  color: 'Silver',
  licensePlate: 'KXT 4410',
  isWheelchairAccessible: true,
  ...overrides,
});

export const driver = (overrides: Partial<S['DriverDto']> = {}): S['DriverDto'] => ({
  id: 'driver-1',
  displayName: 'Marcus T.',
  status: 'approved',
  onShift: true,
  rating: 4.9,
  yearsDriving: 12,
  vehicle: vehicle(),
  approvedAt: '2026-01-01T00:00:00Z',
  suspensionReason: null,
  occupiesSeat: true,
  activeRideCount: 0,
  invitedEmail: null,
  hasAppAccount: true,
  ...overrides,
});

export const candidate = (overrides: Partial<S['DispatchCandidateDto']> = {}): S['DispatchCandidateDto'] => ({
  driverId: 'driver-1',
  displayName: 'Marcus T.',
  eligible: true,
  reasons: [],
  ...overrides,
});

export const queueItem = (overrides: Partial<S['DispatchQueueItemDto']> = {}): S['DispatchQueueItemDto'] => ({
  rideId: 'ride-1',
  status: 'requested',
  patientName: 'Margaret H.',
  pickupLine: '400 Parkside Ave',
  destinationLine: '451 Clarkson Ave',
  scheduledPickupAt: '2026-06-15T14:00:00Z',
  wheelchairRequired: false,
  assistanceRequired: false,
  urgency: 'soon',
  pickupInServiceArea: null,
  candidates: [candidate()],
  ...overrides,
});

export const queue = (items: S['DispatchQueueItemDto'][] = [queueItem()], availableDrivers = 1): S['DispatchQueueDto'] => ({
  organizationId: 'org-1',
  items,
  availableDrivers,
});

export const quote = (overrides: Partial<S['SubscriptionQuoteDto']> = {}): S['SubscriptionQuoteDto'] => ({
  planCode: 'operator-standard',
  planVersion: '1',
  interval: 'monthly',
  seats: 12,
  billableSeats: 2,
  lines: [
    { label: 'Base plan', quantity: 1, unitPriceCents: 24900, amountCents: 24900 },
    { label: 'Drivers above 10', quantity: 2, unitPriceCents: 1500, amountCents: 3000 },
  ],
  totalCents: 27900,
  ...overrides,
});

export const subscription = (overrides: Partial<S['SubscriptionDto']> = {}): S['SubscriptionDto'] => ({
  id: 'sub-1',
  payer: 'dispatchOrganization',
  status: 'active',
  interval: 'monthly',
  planCode: 'operator-standard',
  planName: 'Operator standard',
  planVersion: '1',
  seats: 12,
  currentPeriodStart: '2026-06-01T00:00:00Z',
  currentPeriodEnd: '2026-07-01T00:00:00Z',
  trialEndsAt: null,
  pastDueSince: null,
  cancelRequestedAt: null,
  entitlements: ['dispatch'],
  carriedCreditCents: 0,
  renewalQuote: quote(),
  ...overrides,
});

export const account = (overrides: Partial<S['BillingAccountDto']> = {}): S['BillingAccountDto'] => ({
  id: 'acct-1',
  payer: 'dispatchOrganization',
  billingEmail: 'billing@meridian.example',
  organizationId: 'org-1',
  subscription: subscription(),
  paymentMethod: { id: 'pm-1', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2099, isDefault: true },
  amountDueCents: 0,
  ...overrides,
});

export const invoice = (overrides: Partial<S['InvoiceDto']> = {}): S['InvoiceDto'] => ({
  id: 'inv-1',
  number: 'CB-0001',
  reason: 'subscriptionPeriod',
  status: 'paid',
  currency: 'usd',
  subtotalCents: 27900,
  creditAppliedCents: 0,
  totalCents: 27900,
  amountPaidCents: 27900,
  lines: [{ label: 'Base plan', quantity: 1, unitPriceCents: 27900, amountCents: 27900 }],
  issuedAt: '2026-06-01T00:00:00Z',
  paidAt: '2026-06-01T00:00:00Z',
  attemptCount: 1,
  nextAttemptAt: null,
  lastFailureCode: null,
  ...overrides,
});

export const plan = (overrides: Partial<S['SubscriptionPlanDto']> = {}): S['SubscriptionPlanDto'] => ({
  id: 'plan-1',
  code: 'operator-standard',
  version: '1',
  payer: 'dispatchOrganization',
  interval: 'monthly',
  name: 'Operator standard',
  description: 'The console, the driver app and assignment.',
  basePriceCents: 24900,
  includedSeats: 10,
  seatTiers: [
    { upToSeats: 25, unitPriceCents: 1500 },
    { upToSeats: null, unitPriceCents: 1200 },
  ],
  entitlements: ['dispatch'],
  trialDays: 14,
  graceDays: 7,
  ...overrides,
});

export const stats = (overrides: Partial<S['PlatformStatsDto']> = {}): S['PlatformStatsDto'] => ({
  ridesLast7Days: 40,
  ridesCompletedLast7Days: 30,
  ridesNoShowLast7Days: 0,
  ridesCancelledLast7Days: 0,
  activeRidesNow: 3,
  staleTrackingNow: 0,
  familiesSubscribed: 12,
  operatorsSubscribed: 2,
  driversApproved: 9,
  driversWithExpiringDocuments: 0,
  documentsAwaitingReview: 0,
  invoicesPastDue: 0,
  revenueCentsLast30Days: 100000,
  refundedCentsLast30Days: 2500,
  ...overrides,
});

export const flag = (overrides: Partial<S['FeatureFlagDto']> = {}): S['FeatureFlagDto'] => ({
  key: 'marketplace',
  description: 'Lets families pick from several operators.',
  enabled: true,
  rolloutPercent: 50,
  updatedAt: '2026-06-01T10:00:00Z',
  updatedByName: 'Priya',
  ...overrides,
});

export const auditEntry = (overrides: Partial<S['AuditEntryDto']> = {}): S['AuditEntryDto'] => ({
  id: 'audit-1',
  at: '2026-06-01T10:00:00Z',
  actorUserId: 'user-1',
  actorName: 'Priya',
  action: 'driver.approved',
  entityType: 'Driver',
  entityId: 'driver-1',
  changedFields: ['status'],
  correlationId: 'corr-1',
  ip: null,
  ...overrides,
});

export const refundable = (overrides: Partial<S['RefundableInvoiceDto']> = {}): S['RefundableInvoiceDto'] => ({
  invoiceId: 'inv-1',
  invoiceNumber: 'CB-0001',
  paymentId: 'pay-1',
  paidCents: 27900,
  refundableCents: 27900,
  refunds: [],
  ...overrides,
});
