-- Account deletion — ADR-0013.
--
-- Deletion means the person becomes unidentifiable, not that history becomes
-- untrue. Nothing here deletes anything: it adds the three columns the request
-- and the sweep need, plus the clock on an orphaned patient. The erasure
-- itself is `AccountDeletionService`, because the policy is per-relation and a
-- cascade cannot express "keep this row, drop the identity on it".

-- A third credential-token purpose.
--
-- Google Play requires deletion to be requestable at a public URL without
-- installing the app, so the requester is by definition not signed in. The
-- emailed link is what proves they hold the address — the same mechanism as a
-- password reset, for the same reason, with the same single-use expiring token.
ALTER TYPE "CredentialTokenType" ADD VALUE 'accountDeletion';

-- The request, and when the sweep will act on it.
--
-- `deletionScheduledFor` is stored rather than derived from the request date so
-- that changing the grace period does not silently move the date out from
-- under requests already made — somebody told "17 October" must not discover
-- it became the 10th because a constant changed.
ALTER TABLE "users"
  ADD COLUMN "deletionRequestedAt"  TIMESTAMP(3),
  ADD COLUMN "deletionScheduledFor" TIMESTAMP(3),
  ADD COLUMN "isTombstone"          BOOLEAN NOT NULL DEFAULT false;

-- The sweep asks "whose deletion is due" once a day. Without this it is a
-- sequential scan of every account on the platform to find the handful that
-- are.
CREATE INDEX "users_deletionScheduledFor_idx" ON "users"("deletionScheduledFor");

-- Both dates move together or neither does. A scheduled deletion with no
-- request date cannot be cancelled by signing in, because the cancel path
-- looks for the request; a request with no schedule is never executed by the
-- sweep, because the sweep looks for the schedule. Either half alone is a row
-- that silently does nothing, which is the worst outcome available here.
ALTER TABLE "users"
  ADD CONSTRAINT "users_deletion_dates_together"
  CHECK (("deletionRequestedAt" IS NULL) = ("deletionScheduledFor" IS NULL));

-- A tombstone can never sign in, and nothing may ask it to.
--
-- Enforced in the database rather than only in the guard: the tombstone's
-- whole purpose is to be a foreign key with no person behind it, and an
-- authentication path that reached one would be authenticating as an absence.
-- `passwordHash` is left NOT NULL and filled with unusable bytes instead of
-- being made nullable, so no code path can read "no password" as "any
-- password".
ALTER TABLE "users"
  ADD CONSTRAINT "users_tombstone_is_not_verified"
  CHECK (NOT "isTombstone" OR "emailVerifiedAt" IS NULL);

-- A patient whose last caregiver has gone.
--
-- Set when a deletion removes the last access grant. Thirty days later the
-- sweep purges the record outright: nobody can reach it, so nobody can ask for
-- it back, and a row carrying a home address and mobility needs that is
-- reachable by nobody and deletable by nobody is the worst of the three
-- available options.
ALTER TABLE "patients"
  ADD COLUMN "orphanedAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt"   TIMESTAMP(3);

-- A purge empties the patient record; it does not delete the row.
--
-- `rides.patientId` is ON DELETE CASCADE, so removing the patient would take
-- every completed ride and its fare with it — which is precisely the thing
-- ADR-0013 refuses to let "delete my account" mean. The ride's own pickup and
-- destination are separate snapshot rows copied at booking, so scrubbing the
-- patient's home address cannot rewrite where a completed journey actually
-- went.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_purged_implies_orphaned"
  CHECK ("purgedAt" IS NULL OR "orphanedAt" IS NOT NULL);

CREATE INDEX "patients_orphanedAt_idx" ON "patients"("orphanedAt");

-- An orphaned patient is always archived too. Archiving is what removes them
-- from every view; orphaning is only the clock. Splitting them lets a patient
-- be archived by a family that still holds the grant — the ordinary case —
-- while making the reverse, a patient on a purge clock still visible
-- somewhere, unrepresentable.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_orphaned_implies_archived"
  CHECK ("orphanedAt" IS NULL OR "archivedAt" IS NOT NULL);
