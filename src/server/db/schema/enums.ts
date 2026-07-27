import { pgEnum } from "drizzle-orm/pg-core";

import { ASSIGNMENT_STATUSES } from "@/modules/assignments/domain/status";
import { ROLES } from "@/modules/auth/domain/roles";
import { SERVICE_REQUEST_STATUSES } from "@/modules/service-requests/domain/status";

import { enumValues } from "./_shared";

/**
 * Postgres enums.
 *
 * The three lifecycle/role enums reuse the canonical arrays from the domain
 * layer so the database and the business rules cannot disagree about what a
 * valid value is. The rest are declared here because they have no behaviour
 * attached — they are just closed value sets.
 */

export const appRole = pgEnum("app_role", enumValues(ROLES));

export const serviceRequestStatus = pgEnum(
  "service_request_status",
  enumValues(SERVICE_REQUEST_STATUSES),
);

export const assignmentStatus = pgEnum("assignment_status", enumValues(ASSIGNMENT_STATUSES));

export const familyMemberRole = pgEnum("family_member_role", ["OWNER", "MEMBER"]);

/** Data-minimisation: a coarse age band, never a full date of birth.
 *  See docs/DECISIONS.md #1. */
export const ageBand = pgEnum("age_band", ["UNDER_65", "AGE_65_74", "AGE_75_84", "AGE_85_PLUS"]);

export const consentStatus = pgEnum("consent_status", ["PENDING", "GRANTED", "REVOKED"]);

export const consentType = pgEnum("consent_type", ["SHARE_INFO", "COORDINATE_SERVICES"]);

export const consentRecordStatus = pgEnum("consent_record_status", ["GRANTED", "REVOKED"]);

export const caregiverStatus = pgEnum("caregiver_status", ["PENDING", "ACTIVE", "INACTIVE"]);

export const vehicleType = pgEnum("vehicle_type", ["STANDARD", "WHEELCHAIR"]);

export const checkEventType = pgEnum("check_event_type", ["CHECK_IN", "CHECK_OUT"]);

export const incidentSeverity = pgEnum("incident_severity", ["LOW", "MEDIUM", "HIGH"]);

export const incidentStatus = pgEnum("incident_status", ["OPEN", "UNDER_REVIEW", "RESOLVED"]);

export const notificationChannel = pgEnum("notification_channel", ["EMAIL", "SMS"]);

export const notificationStatus = pgEnum("notification_status", ["PENDING", "SENT", "FAILED"]);

export const paymentProvider = pgEnum("payment_provider", ["STRIPE", "MOCK"]);

export const paymentStatus = pgEnum("payment_status", ["PENDING", "PAID", "FAILED", "REFUNDED"]);
