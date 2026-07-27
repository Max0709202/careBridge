import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { appRole, caregiverStatus, familyMemberRole } from "./enums";
import { authUsers, primaryId, timestamps } from "./_shared";

/**
 * Identity and account structure.
 *
 * `users` mirrors the minimum of Supabase's `auth.users` that the application
 * needs to reason about a person: their single role and the email they sign in
 * with. It is populated by a trigger on `auth.users` (see the functions
 * migration), so a row here always corresponds to a real auth account.
 *
 * A FAMILY user's access is scoped through `family_members`, not a column here,
 * because one account can have several members (an adult child plus a sibling).
 */
export const users = pgTable("users", {
  // Shares the primary key of the auth user it represents.
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: appRole("role").notNull(),
  // The name the user chooses to show in the app. Optional and low-stakes;
  // the sensitive names live on senior profiles.
  displayName: text("display_name"),
  ...timestamps,
});

export const familyAccounts = pgTable(
  "family_accounts",
  {
    id: primaryId(),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [index("family_accounts_created_by_idx").on(t.createdBy)],
);

export const familyMembers = pgTable(
  "family_members",
  {
    id: primaryId(),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberRole: familyMemberRole("member_role").notNull().default("MEMBER"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A user belongs to a given family account at most once.
    uniqueIndex("family_members_account_user_uq").on(t.familyAccountId, t.userId),
    index("family_members_user_idx").on(t.userId),
    index("family_members_account_idx").on(t.familyAccountId),
  ],
);

export const caregiverProfiles = pgTable(
  "caregiver_profiles",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    phone: text("phone"),
    status: caregiverStatus("status").notNull().default("PENDING"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("caregiver_profiles_user_uq").on(t.userId),
    index("caregiver_profiles_status_idx").on(t.status),
  ],
);

export const caregiverAvailability = pgTable(
  "caregiver_availability",
  {
    id: primaryId(),
    caregiverProfileId: uuid("caregiver_profile_id")
      .notNull()
      .references(() => caregiverProfiles.id, { onDelete: "cascade" }),
    // 0 = Sunday .. 6 = Saturday. Recurring weekly windows; specific-date
    // overrides are out of scope for the MVP.
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    ...timestamps,
  },
  (t) => [
    index("caregiver_availability_profile_idx").on(t.caregiverProfileId),
    check("caregiver_availability_day_chk", sql`${t.dayOfWeek} between 0 and 6`),
    check("caregiver_availability_time_chk", sql`${t.endTime} > ${t.startTime}`),
  ],
);
