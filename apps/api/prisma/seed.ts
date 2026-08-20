/**
 * Development seed.
 *
 * Every person, address, telephone number and vehicle here is invented. Real
 * patient or health data must never appear in a seed, a fixture, a screenshot
 * or a test name — including "just for a demo", because demo data has a habit
 * of outliving the demo.
 *
 * Idempotent: safe to run against an already-seeded database. Times are
 * computed relative to the run, so the demo appointment is always two days out
 * rather than drifting into the past.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { distanceMiles, estimateDriveMinutes } from '../src/domain/geo';
import { Money } from '../src/domain/money';
import { estimateFare, settleFare } from '../src/domain/pricing';
import { periodEndFor, trialEndsAt, type BillingInterval } from '../src/domain/billing';
import {
  quoteSubscription,
  type SubscriptionPlan,
} from '../src/domain/subscription-pricing';

const prisma = new PrismaClient();

// Fixed ids so re-running the seed updates rather than duplicates.
const ID = {
  user: '00000000-0000-4000-8000-000000000001',
  eleanor: '00000000-0000-4000-8000-000000000010',
  frank: '00000000-0000-4000-8000-000000000011',
  riverbend: '00000000-0000-4000-8000-000000000020',
  northside: '00000000-0000-4000-8000-000000000021',
  marcus: '00000000-0000-4000-8000-000000000030',
  priya: '00000000-0000-4000-8000-000000000031',
  sienna: '00000000-0000-4000-8000-000000000040',
  transit: '00000000-0000-4000-8000-000000000041',
  followUp: '00000000-0000-4000-8000-000000000050',
  frankCheckup: '00000000-0000-4000-8000-000000000051',
  pastAppointment: '00000000-0000-4000-8000-000000000052',
  rideOutbound: '00000000-0000-4000-8000-000000000060',
  rideReturn: '00000000-0000-4000-8000-000000000061',
  ridePast: '00000000-0000-4000-8000-000000000062',
  roundTripGroup: '00000000-0000-4000-8000-000000000070',
  // Must match the id the two-sided-billing migration backfills onto existing
  // drivers, or a seeded database and a migrated one would disagree about
  // which company the fleet belongs to.
  meridian: '00000000-0000-4000-8000-0000000000a1',
  dispatcher: '00000000-0000-4000-8000-0000000000a2',
} as const;

const DISPATCHER_EMAIL = 'dispatch@meridiantransit.example';

const DEMO_PASSWORD = 'demo-password';

async function main(): Promise<void> {
  const now = new Date();

  await seedPricingRule();
  await seedPlanCatalogue();
  const operator = await seedOperator();
  await seedFleet();

  const user = await seedUser();
  await seedSubscriptions({ now, userId: user.id, organizationId: operator.id });
  const { riverbend, northside } = await seedClinics();
  const { eleanor, frank } = await seedPatients(user.id, now);
  await seedAppointmentsAndRides({
    now,
    eleanorId: eleanor,
    frankId: frank,
    riverbendId: riverbend,
    northsideId: northside,
    userId: user.id,
  });

  console.log(`Seeded. Sign in as ${user.email} / ${DEMO_PASSWORD}`);
}

async function seedPricingRule(): Promise<void> {
  await prisma.pricingRule.upsert({
    where: { version: 'v1-pilot' },
    update: {},
    create: {
      version: 'v1-pilot',
      baseFareCents: 1200,
      perMileCents: 225,
      perMinuteCents: 45,
      minimumFareCents: 1800,
      wheelchairSurchargeCents: 1500,
      assistanceSurchargeCents: 800,
      // Applies only to operators who are not on a per-driver subscription.
      // Meridian is, so every seeded ride settles at zero platform fee — which
      // is the point of the two-sided model rather than an accident of the
      // demo data.
      platformFeeBps: 1500,
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      active: true,
    },
  });
}

/**
 * The plan catalogue — the whole fee model, as data.
 *
 * Four rows, because there are two payers and two intervals. Annual is a
 * separate row rather than `monthly × 12 × 0.83` computed in code: the size of
 * the annual discount is a commercial decision that must not require a deploy,
 * and a multiplier hides where the rounding happened.
 *
 * The dispatch ladder is graduated — drivers 6–20 at $18, 21 and up at $14 —
 * so an operator's bill never *falls* when they hire.
 */
async function seedPlanCatalogue(): Promise<void> {
  const effectiveFrom = new Date(Date.UTC(2026, 0, 1));

  const plans = [
    {
      code: 'family-standard',
      interval: 'monthly' as const,
      name: 'Family plan',
      description:
        'Coordination for one household: appointments, transport requests, live tracking and reminders for everyone in the care circle.',
      basePriceCents: 2900,
      includedSeats: 0,
      seatTiers: [] as Array<{ upToSeats: number | null; unitPriceCents: number }>,
      entitlements: [
        'requestTransport',
        'liveTracking',
        'unlimitedCareCircle',
        'appointmentReminders',
      ],
      trialDays: 14,
      graceDays: 7,
    },
    {
      code: 'family-standard',
      interval: 'annual' as const,
      name: 'Family plan, annual',
      description:
        'The family plan, billed yearly — two months less than paying monthly.',
      basePriceCents: 29_000,
      includedSeats: 0,
      seatTiers: [],
      entitlements: [
        'requestTransport',
        'liveTracking',
        'unlimitedCareCircle',
        'appointmentReminders',
        'prioritySupport',
      ],
      trialDays: 14,
      graceDays: 7,
    },
    {
      code: 'dispatch-core',
      interval: 'monthly' as const,
      name: 'Dispatch core',
      description:
        'The operational product for a transport company: dispatch console, driver app and assignment. Priced by drivers on the road.',
      basePriceCents: 19_900,
      includedSeats: 5,
      seatTiers: [
        { upToSeats: 20, unitPriceCents: 1800 },
        { upToSeats: null, unitPriceCents: 1400 },
      ],
      entitlements: ['dispatchConsole', 'driverApp', 'bulkAssignment'],
      trialDays: 30,
      // Longer than a family's, because an operator losing the console mid-shift
      // strands passengers who are already booked, and an accounts department
      // does not turn a failed card around in seven days.
      graceDays: 14,
    },
    {
      code: 'dispatch-core',
      interval: 'annual' as const,
      name: 'Dispatch core, annual',
      description: 'Dispatch core, billed yearly, with per-driver rates to match.',
      basePriceCents: 199_000,
      includedSeats: 5,
      seatTiers: [
        { upToSeats: 20, unitPriceCents: 18_000 },
        { upToSeats: null, unitPriceCents: 14_000 },
      ],
      entitlements: [
        'dispatchConsole',
        'driverApp',
        'bulkAssignment',
        'operationsAnalytics',
      ],
      trialDays: 30,
      graceDays: 14,
    },
  ];

  for (const plan of plans) {
    const payer = plan.code.startsWith('family') ? 'family' : 'dispatchOrganization';

    const row = await prisma.subscriptionPlan.upsert({
      where: {
        code_interval_version: {
          code: plan.code,
          interval: plan.interval,
          version: 'v1-pilot',
        },
      },
      update: {},
      create: {
        code: plan.code,
        version: 'v1-pilot',
        payer,
        interval: plan.interval,
        name: plan.name,
        description: plan.description,
        basePriceCents: plan.basePriceCents,
        includedSeats: plan.includedSeats,
        entitlements: plan.entitlements,
        trialDays: plan.trialDays,
        graceDays: plan.graceDays,
        effectiveFrom,
      },
    });

    await prisma.subscriptionPlanSeatTier.deleteMany({ where: { planId: row.id } });
    await prisma.subscriptionPlanSeatTier.createMany({
      data: plan.seatTiers.map((tier, position) => ({
        planId: row.id,
        position,
        upToSeats: tier.upToSeats,
        unitPriceCents: tier.unitPriceCents,
      })),
    });
  }
}

/**
 * The pilot transport operator, and a dispatcher who can sign in as one.
 *
 * Fictional, like everyone else in this file. It exists because a dispatch
 * company that pays for seats cannot be an implicit thing outside the system:
 * somebody has to be billed, and somebody has to be able to look at the
 * invoice.
 */
async function seedOperator(): Promise<{ id: string }> {
  const organization = await prisma.organization.upsert({
    where: { id: ID.meridian },
    update: {},
    create: {
      id: ID.meridian,
      kind: 'dispatchCompany',
      name: 'Meridian Transit Partners',
      slug: 'meridian-transit',
      contactEmail: DISPATCHER_EMAIL,
      phone: '+1-555-0142',
      timeZone: 'America/New_York',
    },
  });

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const dispatcher = await prisma.user.upsert({
    where: { email: DISPATCHER_EMAIL },
    update: {},
    create: {
      id: ID.dispatcher,
      email: DISPATCHER_EMAIL,
      passwordHash,
      fullName: 'Dana Reyes',
      phone: '+1-555-0143',
      emailVerifiedAt: new Date(),
      timeZone: 'America/New_York',
    },
  });

  await prisma.organizationMembership.upsert({
    where: {
      userId_organizationId: { userId: dispatcher.id, organizationId: organization.id },
    },
    update: {},
    create: { userId: dispatcher.id, organizationId: organization.id, role: 'owner' },
  });

  return { id: organization.id };
}

/**
 * Both sides of the fee model, live.
 *
 * The family is on the annual plan and the operator on the monthly one, which
 * is deliberate: the demo should show the two intervals side by side, because
 * "who pays, how often, and for what" is the question this data exists to make
 * legible.
 *
 * Each subscription's first period is written by quoting the plan through the
 * same domain function a real subscribe call uses — a seeded period whose total
 * cannot be explained by its own plan version would be worse than no seed.
 */
async function seedSubscriptions(input: {
  now: Date;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const { now, userId, organizationId } = input;

  // Two different start dates, and the difference matters.
  //
  // The family is on the annual plan, so a period that began forty days ago
  // still has ten months to run. The operator is on the monthly one — begin
  // that forty days ago and its period ended ten days back, so the billing
  // sweep would renew and re-charge it within an hour of the demo starting.
  // A demo whose state changes underneath the person reading it is a demo
  // nobody trusts. Each subscription starts far enough back to look
  // established and recently enough to still be inside the period it paid for.
  const familyStartedAt = daysBefore(now, 40);
  const operatorStartedAt = daysBefore(now, 10);

  const familyAccount = await prisma.billingAccount.upsert({
    where: { ownerUserId: userId },
    update: {},
    create: {
      payer: 'family',
      ownerUserId: userId,
      billingEmail: 'sarah@example.com',
    },
  });

  const operatorAccount = await prisma.billingAccount.upsert({
    where: { organizationId },
    update: {},
    create: {
      payer: 'dispatchOrganization',
      organizationId,
      billingEmail: DISPATCHER_EMAIL,
    },
  });

  await seedCard(familyAccount.id, 'family');

  await openSubscription({
    billingAccountId: familyAccount.id,
    code: 'family-standard',
    interval: 'annual',
    seats: 0,
    startedAt: familyStartedAt,
  });

  const seats = await prisma.driver.count({
    where: { organizationId, status: 'approved' },
  });

  await seedCard(operatorAccount.id, 'operator');

  const operatorSubscription = await openSubscription({
    billingAccountId: operatorAccount.id,
    code: 'dispatch-core',
    interval: 'monthly',
    seats,
    startedAt: operatorStartedAt,
  });

  // The ledger behind the operator's seat count. Without it, "why were we
  // billed for two drivers" is answerable only from a driver table that will
  // have changed by the time anybody asks.
  if (operatorSubscription) {
    const drivers = await prisma.driver.findMany({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });

    for (const [index, driver] of drivers.entries()) {
      const existing = await prisma.seatLedgerEntry.findFirst({
        where: { subscriptionId: operatorSubscription.id, driverId: driver.id },
      });
      if (existing) continue;

      await prisma.seatLedgerEntry.create({
        data: {
          subscriptionId: operatorSubscription.id,
          driverId: driver.id,
          change: 'granted',
          at: operatorStartedAt,
          seatsAfter: index + 1,
          // Granted at the start of the period, so there is nothing to prorate.
          prorationCents: 0,
        },
      });
    }
  }
}

/**
 * A card on file, in the shape the local payments adapter mints.
 *
 * `4242` is Stripe's test card that settles, and the local adapter reads the
 * same four digits — so the demo's renewals go through here exactly as they
 * would against a Stripe test account. Nothing resembling a card number is
 * stored: the reference is a token, the four digits are what a person needs to
 * recognise which card is being charged, and there is no third thing.
 *
 * The seed is refused in production by `SEED_ON_START` and by config
 * validation refusing the local payments adapter there, so a token this
 * process invented can never be presented to a real processor.
 */
async function seedCard(billingAccountId: string, label: string): Promise<void> {
  const externalId = `pm_local_4242_seed-${label}`;

  await prisma.paymentMethod.upsert({
    where: { externalId },
    update: {},
    create: {
      billingAccountId,
      externalId,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      // Far enough out that a demo run in two years does not open on an
      // "this card has expired" warning that has nothing to do with the point.
      expYear: new Date().getUTCFullYear() + 4,
      isDefault: true,
    },
  });
}

/**
 * The invoice a seeded period was paid by.
 *
 * Without it the demo shows a subscription that has been running for weeks and
 * has never been billed — which is precisely the state the billing sweep now
 * exists to make impossible, so seeding it would be seeding a bug. The payment
 * row is written too, because an invoice marked paid with nothing that paid it
 * cannot be reconciled against anything.
 */
/** Writes the missing invoice for every period of an already-seeded subscription. */
async function backfillInvoices(
  billingAccountId: string,
  subscriptionId: string,
): Promise<void> {
  const periods = await prisma.subscriptionPeriod.findMany({
    where: { subscriptionId, invoice: null },
    orderBy: { sequence: 'asc' },
  });

  for (const period of periods) {
    await seedPaidInvoice({
      billingAccountId,
      subscriptionId,
      periodId: period.id,
      totalCents: period.totalCents,
      lines: period.lines as Prisma.InputJsonValue,
      paidAt: period.startsAt,
    });
  }
}

async function seedPaidInvoice(input: {
  billingAccountId: string;
  subscriptionId: string;
  periodId: string;
  totalCents: number;
  lines: Prisma.InputJsonValue;
  paidAt: Date;
}): Promise<void> {
  const existing = await prisma.invoice.findUnique({
    where: { periodId: input.periodId },
  });
  if (existing) return;

  const invoice = await prisma.invoice.create({
    data: {
      billingAccountId: input.billingAccountId,
      subscriptionId: input.subscriptionId,
      periodId: input.periodId,
      reason: 'subscriptionPeriod',
      status: 'paid',
      subtotalCents: input.totalCents,
      totalCents: input.totalCents,
      amountPaidCents: input.totalCents,
      lines: input.lines,
      issuedAt: input.paidAt,
      dueAt: input.paidAt,
      paidAt: input.paidAt,
      attemptCount: 1,
    },
  });

  const card = await prisma.paymentMethod.findFirst({
    where: { billingAccountId: input.billingAccountId, isDefault: true },
  });

  await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      billingAccountId: input.billingAccountId,
      paymentMethodId: card?.id ?? null,
      attempt: 1,
      amountCents: input.totalCents,
      status: 'succeeded',
      externalPaymentId: `pi_local_seed-${invoice.id}`,
      idempotencyKey: `inv:${invoice.id}:attempt:1`,
      settledAt: input.paidAt,
    },
  });
}

async function openSubscription(input: {
  billingAccountId: string;
  code: string;
  interval: BillingInterval;
  seats: number;
  startedAt: Date;
}): Promise<{ id: string } | null> {
  const { billingAccountId, code, interval, seats, startedAt } = input;

  const existing = await prisma.subscription.findFirst({
    where: {
      billingAccountId,
      status: { in: ['trialing', 'active', 'pastDue', 'pendingCancellation'] },
    },
  });

  // Already seeded. Still back-fill the invoices for its periods rather than
  // returning straight away: a subscription with periods and no invoices is
  // exactly the state the billing sweep exists to make impossible, and a
  // database seeded before invoices existed is sitting in it. Keyed on the
  // period, so running this a second time writes nothing.
  if (existing) {
    await backfillInvoices(billingAccountId, existing.id);
    return existing;
  }

  const plan = await prisma.subscriptionPlan.findFirstOrThrow({
    where: { code, interval, active: true },
    include: { seatTiers: { orderBy: { position: 'asc' } } },
  });

  const domainPlan: SubscriptionPlan = {
    code: plan.code,
    version: plan.version,
    payer: plan.payer,
    interval: plan.interval,
    name: plan.name,
    basePrice: new Money(plan.basePriceCents),
    includedSeats: plan.includedSeats,
    seatTiers: plan.seatTiers.map((tier) => ({
      upToSeats: tier.upToSeats,
      unitPrice: new Money(tier.unitPriceCents),
    })),
    entitlements: [],
    trialDays: plan.trialDays,
    graceDays: plan.graceDays,
  };

  const quote = quoteSubscription({ plan: domainPlan, seats });
  const endsAt = periodEndFor(startedAt, interval);

  const subscription = await prisma.subscription.create({
    data: {
      billingAccountId,
      planId: plan.id,
      // Past its trial: the demo family should land on a running subscription,
      // not on a countdown.
      status: 'active',
      interval,
      seats,
      seatsPaidFor: seats,
      currentPeriodStart: startedAt,
      currentPeriodEnd: endsAt,
      trialEndsAt: trialEndsAt(startedAt, plan.trialDays),
    },
  });

  const base = quote.lines[0]?.amount.cents ?? 0;

  const lines = quote.lines.map((line) => ({
    label: line.label,
    quantity: line.quantity,
    unitPriceCents: line.unitPrice.cents,
    amountCents: line.amount.cents,
  }));

  const period = await prisma.subscriptionPeriod.create({
    data: {
      subscriptionId: subscription.id,
      sequence: 0,
      startsAt: startedAt,
      endsAt,
      planCode: quote.planCode,
      planVersion: quote.planVersion,
      interval,
      seatsBilled: quote.seats,
      basePriceCents: base,
      seatChargeCents: quote.total.cents - base,
      totalCents: quote.total.cents,
      lines,
    },
  });

  await seedPaidInvoice({
    billingAccountId,
    subscriptionId: subscription.id,
    periodId: period.id,
    totalCents: quote.total.cents,
    lines,
    paidAt: startedAt,
  });

  return subscription;
}

async function seedFleet(): Promise<void> {
  await prisma.vehicle.upsert({
    where: { id: ID.sienna },
    update: {},
    create: {
      id: ID.sienna,
      organizationId: ID.meridian,
      make: 'Toyota',
      model: 'Sienna',
      color: 'Silver',
      licensePlate: 'OH·4KJ 219',
      isWheelchairAccessible: false,
    },
  });

  await prisma.vehicle.upsert({
    where: { id: ID.transit },
    update: {},
    create: {
      id: ID.transit,
      organizationId: ID.meridian,
      make: 'Ford',
      model: 'Transit',
      color: 'White',
      licensePlate: 'OH·8RT 660',
      isWheelchairAccessible: true,
    },
  });

  // First name and last initial only — the family needs to recognise the person
  // at the kerb, not to be able to look them up.
  await prisma.driver.upsert({
    where: { id: ID.marcus },
    update: {},
    create: {
      id: ID.marcus,
      organizationId: ID.meridian,
      displayName: 'Marcus T.',
      rating: 4.9,
      yearsDriving: 6,
      vehicleId: ID.sienna,
      // Approved and on shift, so the dispatch queue has somebody to offer.
      // Approval is what takes the billable seat — see `occupiesSeat`.
      status: 'approved',
      onShift: true,
      approvedAt: new Date(),
    },
  });

  await prisma.driver.upsert({
    where: { id: ID.priya },
    update: {},
    create: {
      id: ID.priya,
      organizationId: ID.meridian,
      displayName: 'Priya N.',
      rating: 4.9,
      yearsDriving: 8,
      vehicleId: ID.transit,
      status: 'approved',
      onShift: true,
      approvedAt: new Date(),
    },
  });
}

async function seedUser(): Promise<{ id: string; email: string }> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email: 'sarah@example.com' },
    update: { passwordHash },
    create: {
      id: ID.user,
      email: 'sarah@example.com',
      passwordHash,
      fullName: 'Sarah Whitfield',
      phone: '+1 614 555 0148',
      selectedPatientId: ID.eleanor,
    },
  });

  return { id: user.id, email: user.email };
}

async function seedClinics(): Promise<{ riverbend: string; northside: string }> {
  const riverbend = await upsertClinic(ID.riverbend, {
    name: 'Riverbend Cardiology',
    phone: '+1 614 555 0110',
    entranceNotes:
      'Drop-off is at the North entrance, not the main lobby. The multi-storey ' +
      'car park entrance looks similar — it is not it.',
    operatingNotes: 'Mon–Fri, 8am–5pm. Ask for the cardiology desk on floor 3.',
    address: {
      label: 'Riverbend Cardiology',
      line1: '2200 Olentangy River Road',
      line2: 'Suite 300',
      city: 'Columbus',
      state: 'OH',
      postalCode: '43210',
      latitude: 39.9612,
      longitude: -82.9988,
    },
  });

  const northside = await upsertClinic(ID.northside, {
    name: 'Northside Family Medicine',
    phone: '+1 614 555 0129',
    entranceNotes: 'Step-free entrance on the east side of the building.',
    operatingNotes: 'Mon–Sat, 7:30am–6pm.',
    address: {
      label: 'Northside Family Medicine',
      line1: '41 Kenny Road',
      city: 'Columbus',
      state: 'OH',
      postalCode: '43220',
      latitude: 40.0341,
      longitude: -83.0512,
    },
  });

  return { riverbend, northside };
}

async function upsertClinic(
  id: string,
  data: {
    name: string;
    phone: string;
    entranceNotes: string;
    operatingNotes: string;
    address: Prisma.AddressCreateInput;
  },
): Promise<string> {
  const existing = await prisma.clinic.findUnique({ where: { id } });
  if (existing) return existing.id;

  const clinic = await prisma.clinic.create({
    data: {
      id,
      name: data.name,
      phone: data.phone,
      entranceNotes: data.entranceNotes,
      operatingNotes: data.operatingNotes,
      address: { create: data.address },
    },
  });
  return clinic.id;
}

async function seedPatients(
  userId: string,
  now: Date,
): Promise<{ eleanor: string; frank: string }> {
  const grantedAt = daysBefore(now, 96);

  await upsertPatient({
    id: ID.eleanor,
    userId,
    grantedAt,
    data: {
      preferredName: 'Eleanor',
      legalName: 'Eleanor M. Whitfield',
      phone: '+1 614 555 0193',
      ageBand: 'from75to84',
      mobilityNeeds: ['walker', 'escortToDoor'],
      mobilityNotes:
        'Steady on level ground with the walker, but needs an arm on kerbs and ' +
        'steps. Hard of hearing on the left side.',
      preferredClinicId: ID.riverbend,
    },
    address: {
      label: 'Home',
      line1: '184 Maplewood Drive',
      city: 'Grandview Heights',
      state: 'OH',
      postalCode: '43212',
      accessNotes:
        'Blue front door. Please ring the bell and wait — it takes Eleanor a ' +
        'couple of minutes to reach the door.',
      latitude: 39.9925,
      longitude: -83.0281,
    },
    contacts: [
      {
        name: 'Sarah Whitfield',
        relationship: 'Daughter',
        phone: '+1 614 555 0148',
        isPrimary: true,
      },
      {
        name: 'Dennis Whitfield',
        relationship: 'Son',
        phone: '+1 614 555 0176',
        isPrimary: false,
      },
    ],
  });

  await upsertPatient({
    id: ID.frank,
    userId,
    grantedAt,
    data: {
      preferredName: 'Frank',
      phone: '+1 614 555 0157',
      ageBand: 'over85',
      mobilityNeeds: ['wheelchair', 'transferAssistance'],
      mobilityNotes:
        'Uses a manual wheelchair and needs help transferring. A ' +
        'wheelchair-accessible vehicle is required for every trip.',
      preferredClinicId: ID.northside,
    },
    address: {
      label: 'Home',
      line1: '9 Cedarbrook Court, Apt 2B',
      city: 'Upper Arlington',
      state: 'OH',
      postalCode: '43221',
      accessNotes: 'Ground-floor flat, ramp at the side entrance. Gate code 4417.',
      latitude: 40.0192,
      longitude: -83.0624,
    },
    contacts: [
      {
        name: 'Sarah Whitfield',
        relationship: 'Daughter',
        phone: '+1 614 555 0148',
        isPrimary: true,
      },
    ],
  });

  return { eleanor: ID.eleanor, frank: ID.frank };
}

async function upsertPatient(input: {
  id: string;
  userId: string;
  grantedAt: Date;
  data: {
    preferredName: string;
    legalName?: string;
    phone: string;
    ageBand: 'under65' | 'from65to74' | 'from75to84' | 'over85';
    mobilityNeeds: (
      | 'walker'
      | 'wheelchair'
      | 'cane'
      | 'oxygen'
      | 'transferAssistance'
      | 'escortToDoor'
      | 'lowVision'
      | 'hardOfHearing'
      | 'memorySupport'
    )[];
    mobilityNotes: string;
    preferredClinicId: string;
  };
  address: Prisma.AddressCreateInput;
  contacts: {
    name: string;
    relationship: string;
    phone: string;
    isPrimary: boolean;
  }[];
}): Promise<void> {
  const existing = await prisma.patient.findUnique({ where: { id: input.id } });
  if (existing) return;

  await prisma.patient.create({
    data: {
      id: input.id,
      ...input.data,
      legalName: input.data.legalName ?? null,
      homeAddress: { create: input.address },
      emergencyContacts: { create: input.contacts },
      // grantedByUserId omitted → null → the organiser grant, which cannot have
      // manageAccess removed.
      access: {
        create: {
          userId: input.userId,
          relationship: 'daughter',
          permissions: [
            'viewProfile',
            'scheduleAppointments',
            'requestTransport',
            'makePayments',
            'manageAccess',
          ],
          grantedAt: input.grantedAt,
        },
      },
    },
  });
}

async function seedAppointmentsAndRides(input: {
  now: Date;
  eleanorId: string;
  frankId: string;
  riverbendId: string;
  northsideId: string;
  userId: string;
}): Promise<void> {
  const { now, eleanorId, frankId, riverbendId, northsideId } = input;

  if (await prisma.appointment.findUnique({ where: { id: ID.followUp } })) {
    return;
  }

  // The appointment the demo is built around: a cardiology follow-up two days
  // out, with transport already booked and awaiting a driver.
  const followUpStart = atTime(addDays(now, 2), 10, 40);
  const followUpEnd = new Date(followUpStart.getTime() + 45 * 60_000);

  await prisma.appointment.create({
    data: {
      id: ID.followUp,
      patientId: eleanorId,
      clinicId: riverbendId,
      startsAt: followUpStart,
      expectedDurationMinutes: 45,
      type: 'followUp',
      status: 'transportationScheduled',
      coordinationNotes:
        'Bring the walker. Dr Osei asked for the blood-pressure diary — it is ' +
        'on the kitchen counter.',
      transportRequired: true,
      createdAt: daysBefore(now, 6),
      history: {
        create: [
          {
            at: daysBefore(now, 6),
            fromStatus: 'draft',
            toStatus: 'scheduled',
            actor: 'Sarah Whitfield',
          },
          {
            at: daysBefore(now, 5),
            fromStatus: 'scheduled',
            toStatus: 'transportationScheduled',
            actor: 'CareBridge',
          },
        ],
      },
    },
  });

  await prisma.appointment.create({
    data: {
      id: ID.frankCheckup,
      patientId: frankId,
      clinicId: northsideId,
      startsAt: atTime(addDays(now, 9), 14, 15),
      expectedDurationMinutes: 30,
      type: 'primaryCare',
      status: 'scheduled',
      coordinationNotes: 'Annual check. Wheelchair-accessible vehicle needed.',
      createdAt: daysBefore(now, 2),
      history: {
        create: {
          at: daysBefore(now, 2),
          fromStatus: 'draft',
          toStatus: 'scheduled',
          actor: 'Sarah Whitfield',
        },
      },
    },
  });

  const pastStart = atTime(daysBefore(now, 21), 9, 15);
  await prisma.appointment.create({
    data: {
      id: ID.pastAppointment,
      patientId: eleanorId,
      clinicId: riverbendId,
      startsAt: pastStart,
      expectedDurationMinutes: 60,
      type: 'specialist',
      status: 'completed',
      transportRequired: true,
      createdAt: daysBefore(now, 30),
      history: {
        create: [
          {
            at: daysBefore(now, 30),
            fromStatus: 'draft',
            toStatus: 'scheduled',
            actor: 'Sarah Whitfield',
          },
          {
            at: new Date(pastStart.getTime() + 70 * 60_000),
            fromStatus: 'patientArrived',
            toStatus: 'completed',
            actor: 'CareBridge',
          },
        ],
      },
    },
  });

  const eleanor = await prisma.patient.findUniqueOrThrow({
    where: { id: eleanorId },
    include: { homeAddress: true },
  });
  const riverbend = await prisma.clinic.findUniqueOrThrow({
    where: { id: riverbendId },
    include: { address: true },
  });

  // Priced by the same code that prices a real request, from the same
  // coordinates and the same rule — not by hand. A hardcoded fare drifts from
  // the engine the moment either changes, and a seeded ride whose total cannot
  // be explained by its own rule version is worse than no seed at all.
  const rule = await prisma.pricingRule.findUniqueOrThrow({
    where: { version: 'v1-pilot' },
  });

  const miles = Number(
    distanceMiles(
      {
        latitude: eleanor.homeAddress.latitude!,
        longitude: eleanor.homeAddress.longitude!,
      },
      {
        latitude: riverbend.address.latitude!,
        longitude: riverbend.address.longitude!,
      },
    ).toFixed(1),
  );

  const quote = estimateFare({
    rule: {
      version: rule.version,
      baseFare: new Money(rule.baseFareCents),
      perMile: new Money(rule.perMileCents),
      perMinute: new Money(rule.perMinuteCents),
      minimumFare: new Money(rule.minimumFareCents),
      wheelchairSurcharge: new Money(rule.wheelchairSurchargeCents),
      assistanceSurcharge: new Money(rule.assistanceSurchargeCents),
      platformFeeBps: rule.platformFeeBps,
      effectiveFrom: rule.effectiveFrom,
    },
    distanceMiles: miles,
    durationMinutes: estimateDriveMinutes(miles),
    // Eleanor needs escorting to the door; she does not need a wheelchair
    // vehicle. Both flags come from her mobility needs, as they would for a
    // real request.
    assistanceRequired: true,
  });

  const estimate = {
    priceRuleVersion: quote.ruleVersion,
    distanceMiles: quote.distanceMiles,
    durationMinutes: quote.durationMinutes,
    baseCents: quote.base.cents,
    distanceChargeCents: quote.distanceCharge.cents,
    timeChargeCents: quote.timeCharge.cents,
    totalCents: quote.total.cents,
    minimumApplied: quote.minimumApplied,
  };

  const surcharges = {
    create: quote.surcharges.map((s, index) => ({
      label: s.label,
      amountCents: s.amount.cents,
      position: index,
    })),
  };

  // How the completed ride below was settled — by the same function the
  // transition path calls. Meridian holds a per-driver subscription, so the
  // whole fare is theirs and the platform fee is zero: our margin on that trip
  // was their seats, taken a month earlier.
  const settlement = settleFare({
    rule: {
      version: rule.version,
      baseFare: new Money(rule.baseFareCents),
      perMile: new Money(rule.perMileCents),
      perMinute: new Money(rule.perMinuteCents),
      minimumFare: new Money(rule.minimumFareCents),
      wheelchairSurcharge: new Money(rule.wheelchairSurchargeCents),
      assistanceSurcharge: new Money(rule.assistanceSurchargeCents),
      platformFeeBps: rule.platformFeeBps,
      effectiveFrom: rule.effectiveFrom,
    },
    total: quote.total,
    operatorSubscribed: true,
  });

  const settled = {
    platformFunding: settlement.funding,
    platformFeeCents: settlement.platformFee.cents,
    operatorPayoutCents: settlement.operatorPayout.cents,
    settledOrganizationId: ID.meridian,
  } as const;

  // Each leg snapshots its own copies of the two addresses, exactly as
  // `RidesService.requestTransport` does — so a seeded ride and a requested one
  // are indistinguishable in the database.
  const snapshot = () =>
    Promise.all([
      prisma.address.create({ data: copyOf(eleanor.homeAddress) }),
      prisma.address.create({ data: copyOf(riverbend.address) }),
    ]);

  const [outboundHome, outboundClinic] = await snapshot();

  await prisma.ride.create({
    data: {
      id: ID.rideOutbound,
      patientId: eleanorId,
      appointmentId: ID.followUp,
      roundTripGroupId: ID.roundTripGroup,
      direction: 'outbound',
      pickupAddressId: outboundHome.id,
      destinationAddressId: outboundClinic.id,
      scheduledPickupAt: new Date(followUpStart.getTime() - 40 * 60_000),
      status: 'awaitingAssignment',
      assistanceRequired: true,
      notesForDriver:
        'Please ring the bell and allow a couple of minutes. Eleanor is hard ' +
        'of hearing on the left side.',
      createdAt: daysBefore(now, 5),
      ...estimate,
      surcharges,
      history: {
        create: [
          {
            at: daysBefore(now, 5),
            fromStatus: 'draft',
            toStatus: 'requested',
            actor: 'Sarah Whitfield',
          },
          {
            at: daysBefore(now, 5),
            fromStatus: 'requested',
            toStatus: 'awaitingAssignment',
            actor: 'CareBridge',
          },
        ],
      },
      events: {
        create: [
          { at: daysBefore(now, 5), title: 'Ride requested' },
          { at: daysBefore(now, 5), title: 'Looking for a driver' },
        ],
      },
    },
  });

  const [returnHome, returnClinic] = await snapshot();

  await prisma.ride.create({
    data: {
      id: ID.rideReturn,
      patientId: eleanorId,
      appointmentId: ID.followUp,
      roundTripGroupId: ID.roundTripGroup,
      direction: 'returnTrip',
      pickupAddressId: returnClinic.id,
      destinationAddressId: returnHome.id,
      scheduledPickupAt: followUpEnd,
      flexibleReturn: true,
      status: 'requested',
      assistanceRequired: true,
      createdAt: daysBefore(now, 5),
      ...estimate,
      surcharges,
      history: {
        create: {
          at: daysBefore(now, 5),
          fromStatus: 'draft',
          toStatus: 'requested',
          actor: 'Sarah Whitfield',
        },
      },
      events: {
        create: {
          at: daysBefore(now, 5),
          title: 'Return ride requested',
          detail: 'Pickup time is flexible — we will send a car when the visit ends.',
        },
      },
    },
  });

  const [pastHome, pastClinic] = await snapshot();

  await prisma.ride.create({
    data: {
      id: ID.ridePast,
      patientId: eleanorId,
      appointmentId: ID.pastAppointment,
      direction: 'outbound',
      pickupAddressId: pastHome.id,
      destinationAddressId: pastClinic.id,
      scheduledPickupAt: new Date(pastStart.getTime() - 40 * 60_000),
      status: 'completed',
      assistanceRequired: true,
      driverId: ID.marcus,
      createdAt: daysBefore(now, 30),
      ...estimate,
      ...settled,
      surcharges,
      events: {
        create: [
          {
            at: new Date(pastStart.getTime() - 42 * 60_000),
            title: 'Driver arrived at pickup',
          },
          {
            at: new Date(pastStart.getTime() - 36 * 60_000),
            title: 'Picked up safely',
          },
          {
            at: new Date(pastStart.getTime() - 12 * 60_000),
            title: 'Arrived at the clinic',
          },
          {
            at: new Date(pastStart.getTime() - 10 * 60_000),
            title: 'Ride completed',
          },
        ],
      },
    },
  });

  // Contentless by policy: no name, clinic, address or time in either body.
  await prisma.notification.createMany({
    data: [
      {
        userId: input.userId,
        kind: 'rideRequested',
        title: 'Round trip requested',
        body: 'We are finding a driver. You will be notified when one is assigned.',
        createdAt: daysBefore(now, 5),
        readAt: daysBefore(now, 5),
        rideId: ID.rideOutbound,
      },
      {
        userId: input.userId,
        kind: 'appointmentReminder',
        title: 'Appointment in two days',
        body: 'A reminder about an upcoming appointment. Open CareBridge for details.',
        createdAt: new Date(now.getTime() - 4 * 60 * 60_000),
        appointmentId: ID.followUp,
      },
    ],
  });
}

function copyOf(address: {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  accessNotes: string | null;
  latitude: number | null;
  longitude: number | null;
}): Prisma.AddressCreateInput {
  return {
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    accessNotes: address.accessNotes,
    latitude: address.latitude,
    longitude: address.longitude,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60_000);
}

function atTime(day: Date, hour: number, minute: number): Date {
  const result = new Date(day);
  result.setHours(hour, minute, 0, 0);
  return result;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
