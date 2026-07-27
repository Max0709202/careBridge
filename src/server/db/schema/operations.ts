import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { assignmentStatus, checkEventType, incidentSeverity, incidentStatus } from "./enums";
import { caregiverProfiles, users } from "./identity";
import { serviceRequests } from "./care";
import { primaryId, timestamps } from "./_shared";

/**
 * A caregiver's side of a service request: the offer, their response, and the
 * check-in/out record. Assignment is always created by operations (manual, no
 * auto-matching). At most one non-terminal assignment may exist per request,
 * enforced by a partial unique index below.
 */
export const caregiverAssignments = pgTable(
  "caregiver_assignments",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    caregiverProfileId: uuid("caregiver_profile_id")
      .notNull()
      .references(() => caregiverProfiles.id, { onDelete: "restrict" }),

    status: assignmentStatus("status").notNull().default("OFFERED"),

    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),

    // The operations admin who made the assignment.
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    index("caregiver_assignments_request_idx").on(t.serviceRequestId),
    index("caregiver_assignments_caregiver_idx").on(t.caregiverProfileId),
    index("caregiver_assignments_status_idx").on(t.status),
    // Only one live (non-terminal) assignment per request. Terminal states
    // (REJECTED/COMPLETED/CANCELLED) may accumulate as history.
    uniqueIndex("caregiver_assignments_one_active_uq")
      .on(t.serviceRequestId)
      .where(sql`status not in ('REJECTED', 'COMPLETED', 'CANCELLED')`),
  ],
);

/** Check-in and check-out events for an assignment. Append-only. */
export const assignmentCheckEvents = pgTable(
  "assignment_check_events",
  {
    id: primaryId(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => caregiverAssignments.id, { onDelete: "cascade" }),
    eventType: checkEventType("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assignment_check_events_assignment_idx").on(t.assignmentId)],
);

/** Simple task list a caregiver works through during a visit. */
export const taskChecklists = pgTable(
  "task_checklists",
  {
    id: primaryId(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => caregiverAssignments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isComplete: boolean("is_complete").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("task_checklists_assignment_idx").on(t.assignmentId)],
);

/**
 * Safety incidents filed by a caregiver. Visible to operations and to the
 * caregiver who filed the report — never to families in the MVP.
 */
export const incidentReports = pgTable(
  "incident_reports",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => caregiverAssignments.id, {
      onDelete: "set null",
    }),
    reportedBy: uuid("reported_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    severity: incidentSeverity("severity").notNull().default("LOW"),
    description: text("description").notNull(),
    status: incidentStatus("status").notNull().default("OPEN"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("incident_reports_request_idx").on(t.serviceRequestId),
    index("incident_reports_reporter_idx").on(t.reportedBy),
    index("incident_reports_status_idx").on(t.status),
  ],
);

/**
 * Internal coordination notes between operations staff.
 *
 * OPERATIONS ONLY. Never visible to families or caregivers. Kept in its own
 * table (rather than a column on service_requests) so a single restrictive RLS
 * policy governs all of it and a stray join cannot leak it.
 */
export const internalNotes = pgTable(
  "internal_notes",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("internal_notes_request_idx").on(t.serviceRequestId)],
);
