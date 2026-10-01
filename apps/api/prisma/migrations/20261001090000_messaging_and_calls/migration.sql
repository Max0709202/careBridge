-- Messaging and relay calls — ADR-0014.
--
-- Threads between dispatch, families and drivers, optionally tied to a ride,
-- and a log of relay calls. There is deliberately no participants table:
-- who may read a thread is derived on every request from `patient_access`,
-- `organization_memberships` and `rides.driverId`, so there is no second list
-- of people to fall out of step with the first.
--
-- `call_sessions` stores no phone number on either side and there are no
-- recordings. Numbers are resolved at dial time.

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('dispatchFamily', 'dispatchDriver', 'driverDriver', 'operatorDrivers');

-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('dispatcher', 'family', 'driver', 'system');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('initiating', 'ringingCaller', 'ringingCallee', 'inProgress', 'completed', 'noAnswer', 'busy', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "CallPartyKind" AS ENUM ('patient', 'familyMember', 'driver', 'dispatch');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'messageReceived';
ALTER TYPE "NotificationKind" ADD VALUE 'callMissed';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "appTarget" "AppTarget" NOT NULL DEFAULT 'family',
ADD COLUMN     "conversationId" TEXT;

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "driverId" TEXT,
    "peerDriverId" TEXT,
    "rideId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderRole" "MessageSenderRole" NOT NULL,
    "senderLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_read_states" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_read_states_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "rideId" TEXT,
    "initiatedByUserId" TEXT,
    "callerKind" "CallPartyKind" NOT NULL,
    "calleeKind" "CallPartyKind" NOT NULL,
    "calleeRef" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'initiating',
    "providerRef" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_subjectKey_key" ON "conversations"("subjectKey");

-- CreateIndex
CREATE INDEX "conversations_organizationId_lastMessageAt_idx" ON "conversations"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_patientId_idx" ON "conversations"("patientId");

-- CreateIndex
CREATE INDEX "conversations_driverId_idx" ON "conversations"("driverId");

-- CreateIndex
CREATE INDEX "conversations_peerDriverId_idx" ON "conversations"("peerDriverId");

-- CreateIndex
CREATE INDEX "conversations_rideId_idx" ON "conversations"("rideId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_senderUserId_clientMessageId_key" ON "messages"("senderUserId", "clientMessageId");

-- CreateIndex
CREATE INDEX "conversation_read_states_userId_idx" ON "conversation_read_states"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "call_sessions_providerRef_key" ON "call_sessions"("providerRef");

-- CreateIndex
CREATE INDEX "call_sessions_organizationId_startedAt_idx" ON "call_sessions"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "call_sessions_initiatedByUserId_startedAt_idx" ON "call_sessions"("initiatedByUserId", "startedAt");

-- CreateIndex
CREATE INDEX "notifications_conversationId_userId_idx" ON "notifications"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_peerDriverId_fkey" FOREIGN KEY ("peerDriverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The API validates the length too; this is what holds when something other
-- than the API writes. Plain text, bounded, and never empty.
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length"
  CHECK (char_length("body") BETWEEN 1 AND 2000);
