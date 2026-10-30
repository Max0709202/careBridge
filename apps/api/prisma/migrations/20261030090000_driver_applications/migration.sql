-- Drivers applying to an operator themselves, with the operator's join code.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "driverJoinCode" TEXT;

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN "appliedAt" TIMESTAMP(3),
ADD COLUMN "phone" TEXT,
ADD COLUMN "rejectionReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_driverJoinCode_key" ON "organizations"("driverJoinCode");
