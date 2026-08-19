-- Two-sided subscription billing.
--
-- Before this migration the product had exactly one payer: a family, paying a
-- flat fee plus the fare for each ride. The transport operator was an implicit
-- thing outside the system that supplied drivers, and had no row anywhere.
--
-- It cannot stay implicit once it is billed. So this migration introduces the
-- operator as an `Organization`, gives both sides a `BillingAccount`, and
-- makes plans, periods and driver seats data rather than constants.
--
-- Three things below are hand-written rather than generated, and each is here
-- because the generated form would have been wrong:
--
--   1. `drivers.organizationId` and `vehicles.organizationId` are added
--      nullable, backfilled onto a pilot operator, and only then tightened to
--      NOT NULL. A generated `ADD COLUMN ... NOT NULL` fails against any
--      database that already has drivers in it — which is every database
--      this will ever run against.
--   2. A partial unique index enforcing at most one *live* subscription per
--      billing account. Prisma cannot express a partial index, and without it
--      "which subscription is in force" has more than one answer, which is how
--      an entitlement check starts depending on row order.
--   3. A CHECK constraint that a billing account belongs to exactly one of a
--      user or an organisation. The two nullable foreign keys are a shape the
--      type system cannot narrow; the database can.

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('dispatchCompany', 'clinicNetwork');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'dispatcher', 'member');

-- CreateEnum
CREATE TYPE "PlatformFunding" AS ENUM ('operatorSubscription', 'perRide');

-- CreateEnum
CREATE TYPE "BillingPayer" AS ENUM ('family', 'dispatchOrganization');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'pastDue', 'pendingCancellation', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "SeatChange" AS ENUM ('granted', 'released');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "pricing_rules" ADD COLUMN     "platformFeeBps" INTEGER NOT NULL DEFAULT 1500;

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "operatorPayoutCents" INTEGER,
ADD COLUMN     "platformFeeCents" INTEGER,
ADD COLUMN     "platformFunding" "PlatformFunding",
ADD COLUMN     "settledOrganizationId" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "kind" "OrganizationKind" NOT NULL DEFAULT 'dispatchCompany',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" TEXT NOT NULL,
    "payer" "BillingPayer" NOT NULL,
    "ownerUserId" TEXT,
    "organizationId" TEXT,
    "billingEmail" TEXT NOT NULL,
    "externalCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "payer" "BillingPayer" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "includedSeats" INTEGER NOT NULL DEFAULT 0,
    "entitlements" TEXT[],
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_seat_tiers" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "upToSeats" INTEGER,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "subscription_plan_seat_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "carriedCreditCents" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_periods" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "planCode" TEXT NOT NULL,
    "planVersion" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "seatsBilled" INTEGER NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "seatChargeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_ledger_entries" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "change" "SeatChange" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "seatsAfter" INTEGER NOT NULL,
    "prorationCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seat_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_memberships_organizationId_revokedAt_idx" ON "organization_memberships"("organizationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_userId_organizationId_key" ON "organization_memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_ownerUserId_key" ON "billing_accounts"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_organizationId_key" ON "billing_accounts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_externalCustomerId_key" ON "billing_accounts"("externalCustomerId");

-- CreateIndex
CREATE INDEX "subscription_plans_payer_active_idx" ON "subscription_plans"("payer", "active");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_interval_version_key" ON "subscription_plans"("code", "interval", "version");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_seat_tiers_planId_position_key" ON "subscription_plan_seat_tiers"("planId", "position");

-- CreateIndex
CREATE INDEX "subscriptions_billingAccountId_status_idx" ON "subscriptions"("billingAccountId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_periods_subscriptionId_sequence_key" ON "subscription_periods"("subscriptionId", "sequence");

-- CreateIndex
CREATE INDEX "seat_ledger_entries_subscriptionId_at_idx" ON "seat_ledger_entries"("subscriptionId", "at");

-- CreateIndex
CREATE INDEX "seat_ledger_entries_driverId_idx" ON "seat_ledger_entries"("driverId");

-- CreateIndex
CREATE INDEX "drivers_organizationId_deactivatedAt_idx" ON "drivers"("organizationId", "deactivatedAt");

-- CreateIndex
CREATE INDEX "vehicles_organizationId_idx" ON "vehicles"("organizationId");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── backfill: the pilot operator ────────────────────────────────────────────
--
-- One operator in one metro area is the MVP's stated scope (FOUNDATION O1), so
-- every existing driver and vehicle belongs to it. Inserted with a fixed id so
-- the seed can find it rather than creating a second one.
INSERT INTO "organizations" ("id", "kind", "name", "slug", "contactEmail", "phone", "timeZone", "createdAt", "updatedAt")
SELECT
    '00000000-0000-4000-8000-0000000000a1',
    'dispatchCompany',
    'Meridian Transit Partners',
    'meridian-transit',
    'dispatch@meridiantransit.example',
    '+1-555-0142',
    'America/New_York',
    NOW(),
    NOW()
WHERE EXISTS (SELECT 1 FROM "drivers")
   OR EXISTS (SELECT 1 FROM "vehicles");

UPDATE "drivers"  SET "organizationId" = '00000000-0000-4000-8000-0000000000a1' WHERE "organizationId" IS NULL;
UPDATE "vehicles" SET "organizationId" = '00000000-0000-4000-8000-0000000000a1' WHERE "organizationId" IS NULL;

ALTER TABLE "drivers"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "drivers"  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ─── constraints Prisma cannot express ───────────────────────────────────────

-- At most one subscription per billing account is in force at a time. A
-- terminal subscription is history and may repeat; a live one may not.
CREATE UNIQUE INDEX "subscriptions_one_live_per_account"
    ON "subscriptions" ("billingAccountId")
    WHERE "status" IN ('trialing', 'active', 'pastDue', 'pendingCancellation');

-- A billing account belongs to a household or to an operator, never both and
-- never neither.
ALTER TABLE "billing_accounts"
    ADD CONSTRAINT "billing_accounts_exactly_one_owner"
    CHECK (("ownerUserId" IS NULL) <> ("organizationId" IS NULL));

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_settledOrganizationId_fkey" FOREIGN KEY ("settledOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_seat_tiers" ADD CONSTRAINT "subscription_plan_seat_tiers_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_ledger_entries" ADD CONSTRAINT "seat_ledger_entries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_ledger_entries" ADD CONSTRAINT "seat_ledger_entries_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_ledger_entries" ADD CONSTRAINT "seat_ledger_entries_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

