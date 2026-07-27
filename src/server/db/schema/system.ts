import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { notificationChannel, notificationStatus, paymentProvider, paymentStatus } from "./enums";
import { serviceRequests } from "./care";
import { familyAccounts, users } from "./identity";
import { primaryId, timestamps } from "./_shared";

/**
 * Record that a notification was sent — never its contents.
 *
 * Notification bodies are deliberately contentless (they say "something
 * changed, sign in to see it"), so there is nothing sensitive to store here.
 * We keep only which template went to whom, on which channel, and whether it
 * was delivered. See PRIVACY-DATA-MAP.md.
 */
export const notificationEvents = pgTable(
  "notification_events",
  {
    id: primaryId(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull(),
    templateKey: text("template_key").notNull(),
    // Loose reference so a notification can point at any entity without a hard
    // foreign key per type.
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    status: notificationStatus("status").notNull().default("PENDING"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_events_recipient_idx").on(t.recipientUserId),
    index("notification_events_status_idx").on(t.status),
  ],
);

/**
 * Payment state and processor identifiers. No card data is ever stored — that
 * lives only with the processor (Stripe). Amounts are integer minor units.
 */
export const paymentRecords = pgTable(
  "payment_records",
  {
    id: primaryId(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),

    provider: paymentProvider("provider").notNull().default("MOCK"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),

    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatus("status").notNull().default("PENDING"),

    ...timestamps,
  },
  (t) => [
    index("payment_records_request_idx").on(t.serviceRequestId),
    index("payment_records_family_idx").on(t.familyAccountId),
    index("payment_records_session_idx").on(t.stripeCheckoutSessionId),
  ],
);

/**
 * Append-only audit trail.
 *
 * Stores references and safe structured metadata only — actor, action, which
 * entity, and small facts like a status transition. NEVER the contents of the
 * record it describes, or the audit log becomes a second, less-protected copy
 * of the sensitive data. Enforced append-only by RLS (no update/delete policy).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: primaryId(),
    // Null when the actor is the system (e.g. a webhook) rather than a user.
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    index("audit_events_actor_idx").on(t.actorId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);
