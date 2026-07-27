/**
 * Development seed. Loads CLEARLY FICTIONAL data only.
 *
 * Run with `pnpm db:seed` (or `pnpm db:reset`) after `pnpm supabase:start`.
 * Standalone script: it creates its own connections and does not import the
 * `server-only` app client. Auth users are created through the Supabase admin
 * API (so you can actually sign in as them); the signup trigger then creates
 * the matching public.users / family_account / caregiver_profile rows.
 *
 * Conventions that keep the data unmistakably fake:
 *   - emails at example.test / carebridge.test
 *   - phone numbers in the 555-01xx range (reserved for fiction)
 *   - invented names and addresses
 */
import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// A known, obviously-local password for every seeded account.
const DEV_PASSWORD = "CareBridgeDev!234";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  throw new Error(
    "Seeding needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL. Start the stack with `pnpm supabase:start` and check .env.local.",
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql, { schema, casing: "snake_case" });

type Role = "FAMILY" | "CAREGIVER" | "OPERATIONS_ADMIN";

/** Create an auth user, or return the existing one's id (idempotent). */
async function ensureAuthUser(input: {
  email: string;
  role: Role;
  displayName?: string;
  accountName?: string;
}): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: DEV_PASSWORD,
    email_confirm: true,
    app_metadata: { role: input.role },
    user_metadata: {
      ...(input.displayName ? { display_name: input.displayName } : {}),
      ...(input.accountName ? { account_name: input.accountName } : {}),
    },
  });

  if (data?.user) return data.user.id;

  // Already exists: find them by paging the user list.
  if (error) {
    for (let page = 1; page <= 20; page += 1) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const match = list.users.find((u) => u.email === input.email);
      if (match) return match.id;
      if (list.users.length < 200) break;
    }
  }
  throw new Error(`Could not create or find seed user ${input.email}: ${error?.message}`);
}

async function main() {
  console.log("Seeding fictional development data…");

  // --- People -------------------------------------------------------------
  const opsId = await ensureAuthUser({
    email: "ops@carebridge.test",
    role: "OPERATIONS_ADMIN",
    displayName: "Robin Coordinator",
  });

  const familyId = await ensureAuthUser({
    email: "rivera.family@example.test",
    role: "FAMILY",
    displayName: "Marisol Rivera",
    accountName: "The Rivera family",
  });

  const caregiverUserId = await ensureAuthUser({
    email: "sam.companion@example.test",
    role: "CAREGIVER",
    displayName: "Sam Okafor",
  });

  // The signup trigger created these; read the ids back.
  const familyAccount = await db.query.familyAccounts.findFirst({
    where: eq(schema.familyAccounts.createdBy, familyId),
  });
  const caregiverProfile = await db.query.caregiverProfiles.findFirst({
    where: eq(schema.caregiverProfiles.userId, caregiverUserId),
  });
  if (!familyAccount || !caregiverProfile) {
    throw new Error("Signup trigger did not create the expected account/profile rows.");
  }

  // Activate the caregiver (an ops action in the real flow).
  await db
    .update(schema.caregiverProfiles)
    .set({ status: "ACTIVE", phone: "555-0142", verifiedAt: new Date() })
    .where(eq(schema.caregiverProfiles.id, caregiverProfile.id));

  // --- Senior profile -----------------------------------------------------
  const existingSenior = await db.query.seniorProfiles.findFirst({
    where: and(
      eq(schema.seniorProfiles.familyAccountId, familyAccount.id),
      eq(schema.seniorProfiles.preferredName, "Eleanor"),
    ),
  });

  const senior =
    existingSenior ??
    (
      await db
        .insert(schema.seniorProfiles)
        .values({
          familyAccountId: familyAccount.id,
          preferredName: "Eleanor",
          legalName: "Eleanor Rivera",
          ageBand: "AGE_75_84",
          phone: "555-0173",
          addressLine1: "42 Maple Court",
          city: "Springfield",
          state: "IL",
          postalCode: "62704",
          mobilityNeeds: "Uses a walker; needs a little time getting into the car.",
          requiresWheelchairVehicle: false,
          emergencyContactName: "Marisol Rivera",
          emergencyContactPhone: "555-0155",
          coordinationNotes: "Please ring the doorbell twice — hard of hearing.",
          consentStatus: "GRANTED",
          createdBy: familyId,
        })
        .returning()
    )[0]!;

  await db
    .insert(schema.consents)
    .values({
      seniorProfileId: senior.id,
      familyAccountId: familyAccount.id,
      consentType: "COORDINATE_SERVICES",
      status: "GRANTED",
      grantedBy: familyId,
      grantedAt: new Date(),
    })
    .onConflictDoNothing();

  // --- Request 1: submitted, awaiting review ------------------------------
  const submitted =
    (await db.query.serviceRequests.findFirst({
      where: and(
        eq(schema.serviceRequests.seniorProfileId, senior.id),
        eq(schema.serviceRequests.status, "SUBMITTED"),
      ),
    })) ??
    (
      await db
        .insert(schema.serviceRequests)
        .values({
          familyAccountId: familyAccount.id,
          seniorProfileId: senior.id,
          status: "SUBMITTED",
          transportationRequired: true,
          wheelchairRequired: false,
          companionRequired: true,
          notes: "First visit with a new cardiologist; a companion would help.",
          createdBy: familyId,
        })
        .returning()
    )[0]!;

  await db
    .insert(schema.appointments)
    .values({
      serviceRequestId: submitted.id,
      appointmentAt: daysFromNow(7, 9, 30),
      timeZone: "America/Chicago",
      clinicName: "Springfield Cardiology Associates",
      clinicAddressLine1: "1200 Wellness Way",
      clinicCity: "Springfield",
      clinicState: "IL",
      clinicPostalCode: "62701",
    })
    .onConflictDoNothing();

  // --- Request 2: confirmed and assigned to the caregiver -----------------
  const assignedReq =
    (await db.query.serviceRequests.findFirst({
      where: and(
        eq(schema.serviceRequests.seniorProfileId, senior.id),
        eq(schema.serviceRequests.status, "CAREGIVER_ASSIGNED"),
      ),
    })) ??
    (
      await db
        .insert(schema.serviceRequests)
        .values({
          familyAccountId: familyAccount.id,
          seniorProfileId: senior.id,
          status: "CAREGIVER_ASSIGNED",
          transportationRequired: true,
          wheelchairRequired: false,
          companionRequired: true,
          notes: "Routine follow-up.",
          createdBy: familyId,
        })
        .returning()
    )[0]!;

  await db
    .insert(schema.appointments)
    .values({
      serviceRequestId: assignedReq.id,
      appointmentAt: daysFromNow(3, 14, 0),
      timeZone: "America/Chicago",
      clinicName: "Oak Street Family Medicine",
      clinicAddressLine1: "88 Oak Street",
      clinicCity: "Springfield",
      clinicState: "IL",
      clinicPostalCode: "62702",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.rideDetails)
    .values({
      serviceRequestId: assignedReq.id,
      providerName: "Springfield Accessible Rides",
      vehicleType: "STANDARD",
      pickupAt: daysFromNow(3, 13, 15),
      pickupAddressLine1: "42 Maple Court",
      pickupCity: "Springfield",
      pickupState: "IL",
      pickupPostalCode: "62704",
      estimatedCostCents: 3200,
    })
    .onConflictDoNothing();

  const existingAssignment = await db.query.caregiverAssignments.findFirst({
    where: eq(schema.caregiverAssignments.serviceRequestId, assignedReq.id),
  });
  if (!existingAssignment) {
    await db.insert(schema.caregiverAssignments).values({
      serviceRequestId: assignedReq.id,
      caregiverProfileId: caregiverProfile.id,
      status: "OFFERED",
      assignedBy: opsId,
    });
  }

  await db.insert(schema.internalNotes).values({
    serviceRequestId: assignedReq.id,
    authorId: opsId,
    body: "Confirmed accessible pickup window with the ride provider.",
  });

  // --- A couple of audit events -------------------------------------------
  await db.insert(schema.auditEvents).values([
    {
      actorId: familyId,
      action: "service_request.created",
      entityType: "service_request",
      entityId: submitted.id,
      metadata: { status: "SUBMITTED" },
    },
    {
      actorId: opsId,
      action: "assignment.created",
      entityType: "caregiver_assignment",
      entityId: assignedReq.id,
      metadata: { status: "OFFERED" },
    },
  ]);

  console.log("Seed complete.");
  console.log("  Operations: ops@carebridge.test");
  console.log("  Family:     rivera.family@example.test");
  console.log("  Caregiver:  sam.companion@example.test");
  console.log(`  Password (all): ${DEV_PASSWORD}`);
}

function daysFromNow(days: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

main()
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
