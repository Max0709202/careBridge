-- The clinic portal.
--
-- Two facts a clinic knows and nobody else does: that the patient came in, and
-- that the visit is over. The second is what a `flexibleReturn` ride has been
-- waiting for since Stage 3 — the return leg is booked without a time because
-- nobody knows when a cardiology follow-up will finish, and until now nothing
-- could tell it the time had come.

ALTER TABLE "appointments"
  ADD COLUMN "checkedInAt"      TIMESTAMP(3),
  ADD COLUMN "readyForReturnAt" TIMESTAMP(3);

-- A clinic record is created by a **family** typing where their relative's
-- appointment is. Most will never have anybody from the clinic sign in, so the
-- link is nullable: claiming a clinic is what turns it into a portal, and it
-- is deliberately not required for the clinic to work as an address.
ALTER TABLE "clinics" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "clinics_organizationId_idx" ON "clinics"("organizationId");

ALTER TABLE "clinics" ADD CONSTRAINT "clinics_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A visit cannot be over before it started. Enforced here rather than only in
-- the service because "ready for return" dispatches a car, and a car sent to
-- collect somebody who never arrived is the exact failure the check-in step
-- exists to prevent.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_ready_after_check_in"
  CHECK ("readyForReturnAt" IS NULL OR "checkedInAt" IS NOT NULL);
