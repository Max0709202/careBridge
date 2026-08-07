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
import { estimateFare } from '../src/domain/pricing';

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
} as const;

const DEMO_PASSWORD = 'demo-password';

async function main(): Promise<void> {
  const now = new Date();

  await seedPricingRule();
  await seedFleet();

  const user = await seedUser();
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
      effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
      active: true,
    },
  });
}

async function seedFleet(): Promise<void> {
  await prisma.vehicle.upsert({
    where: { id: ID.sienna },
    update: {},
    create: {
      id: ID.sienna,
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
      displayName: 'Marcus T.',
      rating: 4.9,
      yearsDriving: 6,
      vehicleId: ID.sienna,
    },
  });

  await prisma.driver.upsert({
    where: { id: ID.priya },
    update: {},
    create: {
      id: ID.priya,
      displayName: 'Priya N.',
      rating: 4.9,
      yearsDriving: 8,
      vehicleId: ID.transit,
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
      accessNotes:
        'Ground-floor flat, ramp at the side entrance. Gate code 4417.',
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
      coordinationNotes:
        'Annual check. Wheelchair-accessible vehicle needed.',
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
          detail:
            'Pickup time is flexible — we will send a car when the visit ends.',
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
