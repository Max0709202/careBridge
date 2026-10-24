-- Per-operator service area.
--
-- JSON rather than PostGIS: the area is read whole and checked in the API
-- (src/domain/service-area.ts), never queried spatially in SQL. Null means the
-- operator has not set one.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "serviceArea" JSONB,
ADD COLUMN "serviceAreaUpdatedAt" TIMESTAMP(3);
