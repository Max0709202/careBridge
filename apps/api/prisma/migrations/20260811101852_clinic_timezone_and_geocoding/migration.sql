-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "geocodePrecision" TEXT,
ADD COLUMN     "geocodeSource" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/New_York';
