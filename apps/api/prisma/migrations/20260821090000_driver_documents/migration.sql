-- Driver documents: what somebody hands in before they may carry a passenger.
--
-- The bytes are not here. This table holds a key into object storage and the
-- decision made about the file — a licence scan carries a home address, a date
-- of birth and a photograph, which are the three things this product otherwise
-- refuses to store, so it lives behind a URL that expires rather than behind a
-- path anybody who learns it can fetch forever.

CREATE TYPE "DriverDocumentKind" AS ENUM (
  'driversLicence',
  'vehicleInsurance',
  'vehicleRegistration',
  'backgroundCheck'
);

CREATE TYPE "DriverDocumentStatus" AS ENUM (
  'awaitingUpload',
  'submitted',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "kind" "DriverDocumentKind" NOT NULL,
    "status" "DriverDocumentStatus" NOT NULL DEFAULT 'awaitingUpload',
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "checksum" TEXT,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- Unique, because the key is what a pre-signed URL is minted against. Two rows
-- pointing at one object would mean revoking one and not the other.
CREATE UNIQUE INDEX "driver_documents_storageKey_key"
  ON "driver_documents"("storageKey");

CREATE INDEX "driver_documents_driverId_kind_idx"
  ON "driver_documents"("driverId", "kind");

-- The reviewer's queue reads on this.
CREATE INDEX "driver_documents_status_idx" ON "driver_documents"("status");

-- One live document per kind per driver, enforced where it belongs: on the
-- rows that have not been superseded. A renewal must not erase the certificate
-- that covered last month's rides, so the old row stays and only the current
-- one participates in the constraint.
CREATE UNIQUE INDEX "driver_documents_one_live_per_kind"
  ON "driver_documents"("driverId", "kind")
  WHERE "supersededAt" IS NULL;

-- A rejection has to say why. "Rejected" with no reason is a driver who
-- re-uploads the same unreadable photograph three times, and a support call
-- nobody can answer.
ALTER TABLE "driver_documents"
  ADD CONSTRAINT "driver_documents_rejection_has_a_reason"
  CHECK ("status" <> 'rejected' OR "reviewNote" IS NOT NULL);

-- A reviewed document names its reviewer and when. Every sensitive
-- administrative action has to appear in the audit viewer with a person
-- attached, and a row that can be marked approved by nobody is a hole in that.
ALTER TABLE "driver_documents"
  ADD CONSTRAINT "driver_documents_review_is_attributable"
  CHECK (
    "status" NOT IN ('approved', 'rejected')
    OR ("reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL)
  );

ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "drivers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
