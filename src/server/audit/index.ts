import "server-only";

import { logger } from "@/lib/logger";
import { redactMetadata } from "@/lib/logger/redact";
import { db } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

/**
 * Append-only audit trail writer.
 *
 * Records who did what to which entity, with small structured metadata — never
 * the contents of the record itself (see PRIVACY-DATA-MAP.md). Metadata is
 * additionally passed through redaction as a backstop, so an accidental email
 * or phone number never lands in the audit log.
 *
 * Writes go through the trusted connection and therefore bypass RLS: an audit
 * event must always be recordable regardless of the actor's own permissions.
 */

/** Canonical action names. Keep these stable — dashboards and alerts key on them. */
export const AuditAction = {
  // Account / auth-relevant
  USER_REGISTERED: "user.registered",
  USER_SIGNED_IN: "user.signed_in",
  USER_SIGNED_OUT: "user.signed_out",
  // Seniors
  SENIOR_CREATED: "senior.created",
  SENIOR_UPDATED: "senior.updated",
  // Requests
  REQUEST_CREATED: "service_request.created",
  REQUEST_STATUS_CHANGED: "service_request.status_changed",
  // Assignments
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_STATUS_CHANGED: "assignment.status_changed",
  ASSIGNMENT_REASSIGNED: "assignment.reassigned",
  CHECK_IN: "assignment.check_in",
  CHECK_OUT: "assignment.check_out",
  // Incidents
  INCIDENT_CREATED: "incident.created",
  INCIDENT_STATUS_CHANGED: "incident.status_changed",
  // Payments
  PAYMENT_STATUS_CHANGED: "payment.status_changed",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditInput {
  actorId?: string | null;
  action: AuditActionValue | string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ? redactMetadata(input.metadata) : {},
    });
  } catch (error) {
    // Auditing must never break the operation it describes, but a failure to
    // record one is serious and must surface loudly in the logs.
    logger.error("Failed to write audit event", {
      action: input.action,
      entityType: input.entityType,
      error,
    });
  }
}
