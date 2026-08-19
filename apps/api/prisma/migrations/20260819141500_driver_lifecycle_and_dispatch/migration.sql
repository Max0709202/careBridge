-- Stage 3, first slice: the driver lifecycle, and the seat high-water mark.
--
-- Two hand-written passages below, both for the same reason — a generated
-- `ADD COLUMN ... DEFAULT` is correct for an empty database and wrong for one
-- that already has rows:
--
--   1. `drivers.status` defaults to `invited`, which is right for a driver
--      created from now on and wrong for every driver already carrying
--      passengers. They are backfilled to `approved`, which is what they
--      have effectively been.
--   2. `subscriptions.seatsPaidFor` is the highest seat count already charged
--      for in the current period. Defaulting it to 0 would make the next seat
--      grant re-charge the whole fleet, so it is backfilled from `seats`.

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('invited', 'pendingApproval', 'approved', 'suspended', 'offboarded');

-- DropIndex
DROP INDEX "drivers_organizationId_deactivatedAt_idx";

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "onShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "DriverStatus" NOT NULL DEFAULT 'invited',
ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "seatsPaidFor" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "drivers_organizationId_status_idx" ON "drivers"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── backfill ────────────────────────────────────────────────────────────────

-- Everyone who already exists has been driving. `deactivatedAt` was the
-- previous way of saying "no longer occupies a seat", so it decides which side
-- of the line each row lands on.
UPDATE "drivers"
   SET "status"     = 'approved',
       "approvedAt" = COALESCE("approvedAt", "createdAt"),
       -- Nobody is mid-shift at migration time. A driver marked on shift who
       -- is not would be offered a ride they cannot take.
       "onShift"    = false
 WHERE "deactivatedAt" IS NULL;

UPDATE "drivers"
   SET "status" = 'offboarded'
 WHERE "deactivatedAt" IS NOT NULL;

-- Already paid for at the seat count they are currently billed at.
UPDATE "subscriptions" SET "seatsPaidFor" = "seats";
