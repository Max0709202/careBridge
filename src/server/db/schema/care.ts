import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ageBand,
  consentRecordStatus,
  consentStatus,
  consentType,
  serviceRequestStatus,
  vehicleType,
} from "./enums";
import { familyAccounts, users } from "./identity";
import { primaryId, timestamps } from "./_shared";

/**
 * The most sensitive record in the system. Collects only what a coordinator
 * needs to arrange a ride and a companion — never clinical data, and never a
 * full date of birth (an optional coarse `age_band` instead). See
 * PRIVACY-DATA-MAP.md and docs/DECISIONS.md #1.
 *
 * The address is stored as structured US fields but the shape is intentionally
 * generic so a future country is an additive change, not a rewrite.
 */
export const seniorProfiles = pgTable(
  "senior_profiles",
  {
    id: primaryId(),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),

    preferredName: text("preferred_name").notNull(),
    legalName: text("legal_name"),
    ageBand: ageBand("age_band"),

    phone: text("phone"),

    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("US"),

    mobilityNeeds: text("mobility_needs"),
    requiresWheelchairVehicle: boolean("requires_wheelchair_vehicle").notNull().default(false),

    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),

    // Free text from the family, e.g. "ring the bell twice". Never logged.
    coordinationNotes: text("coordination_notes"),

    consentStatus: consentStatus("consent_status").notNull().default("PENDING"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    index("senior_profiles_family_idx").on(t.familyAccountId),
    check("senior_profiles_state_chk", sql`${t.state} is null or ${t.state} ~ '^[A-Z]{2}$'`),
  ],
);

/**
 * Explicit consent that the family has authority to share a senior's
 * information and arrange services. Kept separate from the denormalised
 * `senior_profiles.consent_status` flag so we retain the full history of grants
 * and revocations.
 */
export const consents = pgTable(
  "consents",
  {
    id: primaryId(),
    seniorProfileId: uuid("senior_profile_id")
      .notNull()
      .references(() => seniorProfiles.id, { onDelete: "cascade" }),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),
    consentType: consentType("consent_type").notNull(),
    status: consentRecordStatus("status").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("consents_senior_idx").on(t.seniorProfileId),
    index("consents_family_idx").on(t.familyAccountId),
  ],
);

/**
 * The coordination request itself: which senior, what help is needed, and the
 * lifecycle status. Appointment specifics live in `appointments`, transport
 * specifics in `ride_details`.
 */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: primaryId(),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),
    seniorProfileId: uuid("senior_profile_id")
      .notNull()
      .references(() => seniorProfiles.id, { onDelete: "restrict" }),

    status: serviceRequestStatus("status").notNull().default("DRAFT"),

    transportationRequired: boolean("transportation_required").notNull().default(true),
    wheelchairRequired: boolean("wheelchair_required").notNull().default(false),
    companionRequired: boolean("companion_required").notNull().default(false),

    // Permitted coordination notes from the family. Never logged.
    notes: text("notes"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    index("service_requests_family_idx").on(t.familyAccountId),
    index("service_requests_senior_idx").on(t.seniorProfileId),
    // The operations dashboard filters heavily by status.
    index("service_requests_status_idx").on(t.status),
  ],
);

/**
 * Appointment details, one-to-one with a service request.
 *
 * `appointmentAt` is a UTC instant; `timeZone` is the IANA zone of the service
 * location, so the time is always displayed where the appointment actually is.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),

    appointmentAt: timestamp("appointment_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull(),

    clinicName: text("clinic_name").notNull(),
    clinicAddressLine1: text("clinic_address_line1"),
    clinicAddressLine2: text("clinic_address_line2"),
    clinicCity: text("clinic_city"),
    clinicState: text("clinic_state"),
    clinicPostalCode: text("clinic_postal_code"),
    clinicCountry: text("clinic_country").notNull().default("US"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("appointments_request_uq").on(t.serviceRequestId),
    index("appointments_at_idx").on(t.appointmentAt),
    check(
      "appointments_clinic_state_chk",
      sql`${t.clinicState} is null or ${t.clinicState} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/**
 * Transportation details, entered manually by operations. One-to-one with a
 * service request. No live tracking is stored — only the arranged plan.
 */
export const rideDetails = pgTable(
  "ride_details",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),

    providerName: text("provider_name"),
    vehicleType: vehicleType("vehicle_type").notNull().default("STANDARD"),

    pickupAt: timestamp("pickup_at", { withTimezone: true }),
    pickupAddressLine1: text("pickup_address_line1"),
    pickupCity: text("pickup_city"),
    pickupState: text("pickup_state"),
    pickupPostalCode: text("pickup_postal_code"),

    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),

    estimatedCostCents: integer("estimated_cost_cents"),
    notes: text("notes"),

    ...timestamps,
  },
  (t) => [uniqueIndex("ride_details_request_uq").on(t.serviceRequestId)],
);
