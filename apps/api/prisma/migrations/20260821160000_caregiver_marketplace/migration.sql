-- The caregiver marketplace.
--
-- Companion care, not clinical care. Nothing here records a treatment, a
-- medication or a condition — the same absence the rest of the model keeps.
--
-- The rule this section is written around: a platform check is not a safety
-- guarantee. What is stored is that identity was confirmed and that a
-- background check was run, each with its own date, so a family judges rather
-- than the platform.


-- CreateEnum
CREATE TYPE "CaregiverStatus" AS ENUM ('applied', 'verified', 'suspended', 'offboarded');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('requested', 'confirmed', 'inProgress', 'completed', 'cancelledByFamily', 'cancelledByCaregiver', 'noShow');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'resolved', 'withdrawn');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('upheld', 'refunded', 'waived');

-- CreateTable
CREATE TABLE "caregivers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hourlyRateCents" INTEGER NOT NULL,
    "serviceRadiusMiles" INTEGER NOT NULL DEFAULT 10,
    "serviceAreaCity" TEXT NOT NULL,
    "serviceAreaState" TEXT NOT NULL,
    "status" "CaregiverStatus" NOT NULL DEFAULT 'applied',
    "identityVerifiedAt" TIMESTAMP(3),
    "backgroundCheckAt" TIMESTAMP(3),
    "backgroundCheckRef" TEXT,
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_availability" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',

    CONSTRAINT "caregiver_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_bookings" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "bookedByUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'requested',
    "hourlyRateCents" INTEGER NOT NULL,
    "commissionBasisPoints" INTEGER NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "billableMinutes" INTEGER,
    "totalCents" INTEGER,
    "platformFeeCents" INTEGER,
    "caregiverPayoutCents" INTEGER,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_reviews" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_disputes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "outcome" "DisputeOutcome",
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "caregivers_userId_key" ON "caregivers"("userId");

-- CreateIndex
CREATE INDEX "caregivers_status_serviceAreaState_serviceAreaCity_idx" ON "caregivers"("status", "serviceAreaState", "serviceAreaCity");

-- CreateIndex
CREATE INDEX "caregiver_availability_caregiverId_weekday_idx" ON "caregiver_availability"("caregiverId", "weekday");

-- CreateIndex
CREATE INDEX "caregiver_bookings_caregiverId_startsAt_idx" ON "caregiver_bookings"("caregiverId", "startsAt");

-- CreateIndex
CREATE INDEX "caregiver_bookings_patientId_startsAt_idx" ON "caregiver_bookings"("patientId", "startsAt");

-- CreateIndex
CREATE INDEX "caregiver_bookings_status_idx" ON "caregiver_bookings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_reviews_bookingId_key" ON "caregiver_reviews"("bookingId");

-- CreateIndex
CREATE INDEX "caregiver_reviews_caregiverId_createdAt_idx" ON "caregiver_reviews"("caregiverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_disputes_bookingId_key" ON "booking_disputes"("bookingId");

-- CreateIndex
CREATE INDEX "booking_disputes_status_createdAt_idx" ON "booking_disputes"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "caregivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_bookings" ADD CONSTRAINT "caregiver_bookings_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "caregivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_bookings" ADD CONSTRAINT "caregiver_bookings_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_bookings" ADD CONSTRAINT "caregiver_bookings_bookedByUserId_fkey" FOREIGN KEY ("bookedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_reviews" ADD CONSTRAINT "caregiver_reviews_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "caregiver_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_reviews" ADD CONSTRAINT "caregiver_reviews_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "caregivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_reviews" ADD CONSTRAINT "caregiver_reviews_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_disputes" ADD CONSTRAINT "booking_disputes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "caregiver_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_disputes" ADD CONSTRAINT "booking_disputes_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_disputes" ADD CONSTRAINT "booking_disputes_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A rating is one to five. Anything else is a number somebody will average.
ALTER TABLE "caregiver_reviews"
  ADD CONSTRAINT "caregiver_reviews_rating_is_one_to_five"
  CHECK ("rating" BETWEEN 1 AND 5);

-- A booking ends after it starts, and an availability window does too.
ALTER TABLE "caregiver_bookings"
  ADD CONSTRAINT "caregiver_bookings_end_after_start" CHECK ("endsAt" > "startsAt");

ALTER TABLE "caregiver_availability"
  ADD CONSTRAINT "caregiver_availability_end_after_start"
  CHECK ("endMinute" > "startMinute");

ALTER TABLE "caregiver_availability"
  ADD CONSTRAINT "caregiver_availability_within_a_day"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440);

ALTER TABLE "caregiver_availability"
  ADD CONSTRAINT "caregiver_availability_iso_weekday"
  CHECK ("weekday" BETWEEN 1 AND 7);

-- Money is never negative, and a rate of zero is a listing that is not really
-- for sale.
ALTER TABLE "caregivers"
  ADD CONSTRAINT "caregivers_rate_is_positive" CHECK ("hourlyRateCents" > 0);

-- A resolved dispute names an outcome, a reason and a person. A decision with
-- none of those is one nobody can defend when the same question is asked again.
ALTER TABLE "booking_disputes"
  ADD CONSTRAINT "booking_disputes_resolution_is_attributable"
  CHECK (
    "status" <> 'resolved'
    OR ("outcome" IS NOT NULL
        AND "resolutionNote" IS NOT NULL
        AND "resolvedByUserId" IS NOT NULL
        AND "resolvedAt" IS NOT NULL)
  );

-- One caregiver cannot be in two places at once.
--
-- A GiST exclusion constraint rather than an application check, because two
-- families booking the same hour at the same moment is exactly the race an
-- application check loses — and the consequence is somebody sitting alone
-- while a caregiver is at the other address.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "caregiver_bookings"
  ADD CONSTRAINT "caregiver_bookings_no_double_booking"
  EXCLUDE USING gist (
    "caregiverId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('requested', 'confirmed', 'inProgress'));
