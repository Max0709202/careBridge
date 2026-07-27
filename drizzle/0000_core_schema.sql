CREATE TYPE "public"."age_band" AS ENUM('UNDER_65', 'AGE_65_74', 'AGE_75_84', 'AGE_85_PLUS');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('FAMILY', 'CAREGIVER', 'OPERATIONS_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('OFFERED', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."caregiver_status" AS ENUM('PENDING', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."check_event_type" AS ENUM('CHECK_IN', 'CHECK_OUT');--> statement-breakpoint
CREATE TYPE "public"."consent_record_status" AS ENUM('GRANTED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('PENDING', 'GRANTED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('SHARE_INFO', 'COORDINATE_SERVICES');--> statement-breakpoint
CREATE TYPE "public"."family_member_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('STRIPE', 'MOCK');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'CAREGIVER_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('STANDARD', 'WHEELCHAIR');--> statement-breakpoint
-- `auth.users` is owned by Supabase (GoTrue) and already exists in any real
-- deployment. These guarded statements are no-ops there; on a bare Postgres or
-- the pglite test harness they create a minimal stub so the foreign key below
-- resolves. We NEVER alter the real auth.users structure.
CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth"."users" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregiver_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caregiver_profile_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_availability_day_chk" CHECK ("caregiver_availability"."day_of_week" between 0 and 6),
	CONSTRAINT "caregiver_availability_time_chk" CHECK ("caregiver_availability"."end_time" > "caregiver_availability"."start_time")
);
--> statement-breakpoint
CREATE TABLE "caregiver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"status" "caregiver_status" DEFAULT 'PENDING' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_role" "family_member_role" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "app_role" NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"appointment_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"clinic_name" text NOT NULL,
	"clinic_address_line1" text,
	"clinic_address_line2" text,
	"clinic_city" text,
	"clinic_state" text,
	"clinic_postal_code" text,
	"clinic_country" text DEFAULT 'US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_clinic_state_chk" CHECK ("appointments"."clinic_state" is null or "appointments"."clinic_state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"senior_profile_id" uuid NOT NULL,
	"family_account_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"status" "consent_record_status" NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"provider_name" text,
	"vehicle_type" "vehicle_type" DEFAULT 'STANDARD' NOT NULL,
	"pickup_at" timestamp with time zone,
	"pickup_address_line1" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_postal_code" text,
	"driver_name" text,
	"driver_phone" text,
	"estimated_cost_cents" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senior_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_account_id" uuid NOT NULL,
	"preferred_name" text NOT NULL,
	"legal_name" text,
	"age_band" "age_band",
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"mobility_needs" text,
	"requires_wheelchair_vehicle" boolean DEFAULT false NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"coordination_notes" text,
	"consent_status" "consent_status" DEFAULT 'PENDING' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "senior_profiles_state_chk" CHECK ("senior_profiles"."state" is null or "senior_profiles"."state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_account_id" uuid NOT NULL,
	"senior_profile_id" uuid NOT NULL,
	"status" "service_request_status" DEFAULT 'DRAFT' NOT NULL,
	"transportation_required" boolean DEFAULT true NOT NULL,
	"wheelchair_required" boolean DEFAULT false NOT NULL,
	"companion_required" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_check_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"event_type" "check_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregiver_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"caregiver_profile_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'OFFERED' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"assigned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"assignment_id" uuid,
	"reported_by" uuid NOT NULL,
	"severity" "incident_severity" DEFAULT 'LOW' NOT NULL,
	"description" text NOT NULL,
	"status" "incident_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template_key" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"family_account_id" uuid NOT NULL,
	"provider" "payment_provider" DEFAULT 'MOCK' NOT NULL,
	"stripe_customer_id" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_caregiver_profile_id_caregiver_profiles_id_fk" FOREIGN KEY ("caregiver_profile_id") REFERENCES "public"."caregiver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_accounts" ADD CONSTRAINT "family_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_senior_profile_id_senior_profiles_id_fk" FOREIGN KEY ("senior_profile_id") REFERENCES "public"."senior_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_details" ADD CONSTRAINT "ride_details_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_profiles" ADD CONSTRAINT "senior_profiles_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senior_profiles" ADD CONSTRAINT "senior_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_senior_profile_id_senior_profiles_id_fk" FOREIGN KEY ("senior_profile_id") REFERENCES "public"."senior_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_check_events" ADD CONSTRAINT "assignment_check_events_assignment_id_caregiver_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."caregiver_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_check_events" ADD CONSTRAINT "assignment_check_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_assignments" ADD CONSTRAINT "caregiver_assignments_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_assignments" ADD CONSTRAINT "caregiver_assignments_caregiver_profile_id_caregiver_profiles_id_fk" FOREIGN KEY ("caregiver_profile_id") REFERENCES "public"."caregiver_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_assignments" ADD CONSTRAINT "caregiver_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_assignment_id_caregiver_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."caregiver_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_assignment_id_caregiver_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."caregiver_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caregiver_availability_profile_idx" ON "caregiver_availability" USING btree ("caregiver_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "caregiver_profiles_user_uq" ON "caregiver_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "caregiver_profiles_status_idx" ON "caregiver_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "family_accounts_created_by_idx" ON "family_accounts" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "family_members_account_user_uq" ON "family_members" USING btree ("family_account_id","user_id");--> statement-breakpoint
CREATE INDEX "family_members_user_idx" ON "family_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "family_members_account_idx" ON "family_members" USING btree ("family_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_request_uq" ON "appointments" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "appointments_at_idx" ON "appointments" USING btree ("appointment_at");--> statement-breakpoint
CREATE INDEX "consents_senior_idx" ON "consents" USING btree ("senior_profile_id");--> statement-breakpoint
CREATE INDEX "consents_family_idx" ON "consents" USING btree ("family_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_details_request_uq" ON "ride_details" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "senior_profiles_family_idx" ON "senior_profiles" USING btree ("family_account_id");--> statement-breakpoint
CREATE INDEX "service_requests_family_idx" ON "service_requests" USING btree ("family_account_id");--> statement-breakpoint
CREATE INDEX "service_requests_senior_idx" ON "service_requests" USING btree ("senior_profile_id");--> statement-breakpoint
CREATE INDEX "service_requests_status_idx" ON "service_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assignment_check_events_assignment_idx" ON "assignment_check_events" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "caregiver_assignments_request_idx" ON "caregiver_assignments" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "caregiver_assignments_caregiver_idx" ON "caregiver_assignments" USING btree ("caregiver_profile_id");--> statement-breakpoint
CREATE INDEX "caregiver_assignments_status_idx" ON "caregiver_assignments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "caregiver_assignments_one_active_uq" ON "caregiver_assignments" USING btree ("service_request_id") WHERE status not in ('REJECTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE INDEX "incident_reports_request_idx" ON "incident_reports" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "incident_reports_reporter_idx" ON "incident_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "incident_reports_status_idx" ON "incident_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internal_notes_request_idx" ON "internal_notes" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "task_checklists_assignment_idx" ON "task_checklists" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_events_recipient_idx" ON "notification_events" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_events_status_idx" ON "notification_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_records_request_idx" ON "payment_records" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "payment_records_family_idx" ON "payment_records" USING btree ("family_account_id");--> statement-breakpoint
CREATE INDEX "payment_records_session_idx" ON "payment_records" USING btree ("stripe_checkout_session_id");