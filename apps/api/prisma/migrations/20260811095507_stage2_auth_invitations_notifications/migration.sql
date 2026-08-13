-- Stage 2 completion: the auth lifecycle, family invitations, and notification
-- delivery.
--
-- Every added column is nullable or carries a default, so this applies to a
-- populated database without a backfill step and without a table rewrite that
-- would lock `users` while it ran.
--
-- Two defaults are worth naming:
--
--   * `users.emailVerifiedAt` is left NULL for existing accounts rather than
--     backfilled to now(). Marking addresses verified because they predate the
--     feature would be recording something we did not check — and invitations
--     are gated on exactly this column.
--
--   * `appointments.timeZone` defaults to America/New_York, which is right for
--     the single-metro pilot (O1) and wrong the moment a second region exists.
--     Called out here so the second region arrives with a backfill rather than
--     with reminders firing three hours early.

-- CreateEnum
CREATE TYPE "CredentialTokenType" AS ENUM ('emailVerification', 'passwordReset');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('inApp', 'email', 'push');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('android', 'ios', 'web');

-- CreateEnum
CREATE TYPE "AppTarget" AS ENUM ('family', 'driver', 'ops');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/New_York';

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "deviceLabel" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revokedReason" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-US',
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credential_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CredentialTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "credential_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "userId" TEXT NOT NULL,
    "secretCiphertext" BYTEA NOT NULL,
    "secretIv" BYTEA NOT NULL,
    "secretAuthTag" BYTEA NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "recoveryCodeHashes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "patient_invitations" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "relationship" "RelationshipType" NOT NULL,
    "permissions" "FamilyPermission"[],
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "patient_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reminders" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "failureReason" TEXT,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "appTarget" "AppTarget" NOT NULL DEFAULT 'family',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credential_tokens_tokenHash_key" ON "credential_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "credential_tokens_userId_type_idx" ON "credential_tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "credential_tokens_expiresAt_idx" ON "credential_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "patient_invitations_tokenHash_key" ON "patient_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "patient_invitations_patientId_idx" ON "patient_invitations"("patientId");

-- CreateIndex
CREATE INDEX "patient_invitations_email_idx" ON "patient_invitations"("email");

-- CreateIndex
CREATE INDEX "patient_invitations_expiresAt_idx" ON "patient_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "appointment_reminders_scheduledFor_sentAt_idx" ON "appointment_reminders"("scheduledFor", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_reminders_appointmentId_offsetMinutes_key" ON "appointment_reminders"("appointmentId", "offsetMinutes");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_attemptedAt_idx" ON "notification_deliveries"("status", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_kind_channel_key" ON "notification_preferences"("userId", "kind", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_revokedAt_idx" ON "device_tokens"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "credential_tokens" ADD CONSTRAINT "credential_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_invitations" ADD CONSTRAINT "patient_invitations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_invitations" ADD CONSTRAINT "patient_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_invitations" ADD CONSTRAINT "patient_invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
