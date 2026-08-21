-- A driver becomes someone who can sign in, and a position report becomes
-- something safe to send twice.

-- ─── the driver's account ───────────────────────────────────────────────────
--
-- All three columns are nullable and start null: every existing driver row was
-- created by an operator building a roster, and none of them has an account
-- yet. Nothing about dispatch changes for a driver who never claims one.
ALTER TABLE "drivers"
  ADD COLUMN "userId"          TEXT,
  ADD COLUMN "invitedEmail"    TEXT,
  ADD COLUMN "accountLinkedAt" TIMESTAMP(3);

-- One account, one driver row. Postgres allows any number of NULLs under a
-- unique index, which is exactly the shape wanted: unclaimed rows do not
-- collide, claimed ones cannot be claimed twice.
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

CREATE INDEX "drivers_organizationId_invitedEmail_idx"
  ON "drivers"("organizationId", "invitedEmail");

ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── one reading per instant ────────────────────────────────────────────────
--
-- The unique index is what makes the driver app's offline queue safe to flush
-- twice: a batch whose response was lost can be re-sent and insert nothing.
--
-- Existing rows were written one at a time by the preview trip runner and can
-- in principle share a millisecond, so duplicates are collapsed first — keeping
-- the earliest row of each pair, since they carry the same reading and the
-- lower id is the one already referenced by anything that read the table.
DELETE FROM "ride_location_samples" a
USING "ride_location_samples" b
WHERE a."rideId" = b."rideId"
  AND a."capturedAt" = b."capturedAt"
  AND a."id" > b."id";

DROP INDEX "ride_location_samples_rideId_capturedAt_idx";

CREATE UNIQUE INDEX "ride_location_samples_rideId_capturedAt_key"
  ON "ride_location_samples"("rideId", "capturedAt");
