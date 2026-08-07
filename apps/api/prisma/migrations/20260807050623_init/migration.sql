-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('terms', 'privacy', 'locationSharing', 'notifications');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('under65', 'from65to74', 'from75to84', 'over85');

-- CreateEnum
CREATE TYPE "MobilityNeed" AS ENUM ('walker', 'wheelchair', 'cane', 'oxygen', 'transferAssistance', 'escortToDoor', 'lowVision', 'hardOfHearing', 'memorySupport');

-- CreateEnum
CREATE TYPE "FamilyPermission" AS ENUM ('viewProfile', 'scheduleAppointments', 'requestTransport', 'makePayments', 'manageAccess');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('son', 'daughter', 'spouse', 'sibling', 'grandchild', 'friend', 'professionalCaregiver', 'other');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('primaryCare', 'specialist', 'imaging', 'labWork', 'therapy', 'dental', 'vision', 'followUp', 'other');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('draft', 'scheduled', 'confirmed', 'patientPreparing', 'transportationScheduled', 'patientEnRoute', 'patientArrived', 'completed', 'canceled', 'missed');

-- CreateEnum
CREATE TYPE "RideDirection" AS ENUM ('outbound', 'returnTrip');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('draft', 'requested', 'awaitingAssignment', 'assigned', 'driverAccepted', 'driverEnRoute', 'driverArrived', 'passengerOnboard', 'inProgress', 'arrivedAtDestination', 'completed', 'canceled', 'noShow', 'reassignmentRequired');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('appointmentCreated', 'appointmentReminder', 'appointmentChanged', 'appointmentCanceled', 'rideRequested', 'driverAssigned', 'driverEnRoute', 'driverArrivingSoon', 'driverArrived', 'patientPickedUp', 'patientArrived', 'rideDelayed', 'rideCompleted', 'rideCanceled', 'accessGranted');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "selectedPatientId" TEXT,
    "simplifiedMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "accessNotes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "preferredName" TEXT NOT NULL,
    "legalName" TEXT,
    "phone" TEXT NOT NULL,
    "homeAddressId" TEXT NOT NULL,
    "ageBand" "AgeBand",
    "preferredLanguage" TEXT NOT NULL DEFAULT 'English',
    "mobilityNeeds" "MobilityNeed"[],
    "mobilityNotes" TEXT,
    "preferredClinicId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "relationship" "RelationshipType" NOT NULL,
    "permissions" "FamilyPermission"[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "patient_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "entranceNotes" TEXT,
    "operatingNotes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expectedDurationMinutes" INTEGER NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "coordinationNotes" TEXT,
    "transportRequired" BOOLEAN NOT NULL DEFAULT false,
    "timeZoneLabel" TEXT NOT NULL DEFAULT 'clinic time',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "isWheelchairAccessible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "yearsDriving" INTEGER NOT NULL DEFAULT 1,
    "vehicleId" TEXT NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "roundTripGroupId" TEXT,
    "direction" "RideDirection" NOT NULL,
    "pickupAddressId" TEXT NOT NULL,
    "destinationAddressId" TEXT NOT NULL,
    "scheduledPickupAt" TIMESTAMP(3) NOT NULL,
    "flexibleReturn" BOOLEAN NOT NULL DEFAULT false,
    "status" "RideStatus" NOT NULL,
    "wheelchairRequired" BOOLEAN NOT NULL DEFAULT false,
    "assistanceRequired" BOOLEAN NOT NULL DEFAULT false,
    "notesForDriver" TEXT,
    "driverId" TEXT,
    "isDelayed" BOOLEAN NOT NULL DEFAULT false,
    "delayReason" TEXT,
    "cancellationReason" TEXT,
    "priceRuleVersion" TEXT NOT NULL,
    "distanceMiles" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "distanceChargeCents" INTEGER NOT NULL,
    "timeChargeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "minimumApplied" BOOLEAN NOT NULL DEFAULT false,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastAccuracyMeters" DOUBLE PRECISION,
    "lastCapturedAt" TIMESTAMP(3),
    "etaMinutes" INTEGER,
    "simulationActive" BOOLEAN NOT NULL DEFAULT false,
    "simulationElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_surcharges" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ride_surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_status_history" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "ride_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "isException" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_location_samples" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_location_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "rideId" TEXT,
    "appointmentId" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "baseFareCents" INTEGER NOT NULL,
    "perMileCents" INTEGER NOT NULL,
    "perMinuteCents" INTEGER NOT NULL,
    "minimumFareCents" INTEGER NOT NULL,
    "wheelchairSurchargeCents" INTEGER NOT NULL,
    "assistanceSurchargeCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "correlationId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "changedFields" TEXT[],

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "user_consents_userId_idx" ON "user_consents"("userId");

-- CreateIndex
CREATE INDEX "emergency_contacts_patientId_idx" ON "emergency_contacts"("patientId");

-- CreateIndex
CREATE INDEX "patient_access_patientId_idx" ON "patient_access"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_access_userId_patientId_key" ON "patient_access"("userId", "patientId");

-- CreateIndex
CREATE INDEX "appointments_patientId_idx" ON "appointments"("patientId");

-- CreateIndex
CREATE INDEX "appointments_startsAt_idx" ON "appointments"("startsAt");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointmentId_idx" ON "appointment_status_history"("appointmentId");

-- CreateIndex
CREATE INDEX "rides_patientId_idx" ON "rides"("patientId");

-- CreateIndex
CREATE INDEX "rides_appointmentId_idx" ON "rides"("appointmentId");

-- CreateIndex
CREATE INDEX "rides_status_idx" ON "rides"("status");

-- CreateIndex
CREATE INDEX "ride_surcharges_rideId_idx" ON "ride_surcharges"("rideId");

-- CreateIndex
CREATE INDEX "ride_status_history_rideId_idx" ON "ride_status_history"("rideId");

-- CreateIndex
CREATE INDEX "ride_events_rideId_idx" ON "ride_events"("rideId");

-- CreateIndex
CREATE INDEX "ride_location_samples_rideId_capturedAt_idx" ON "ride_location_samples"("rideId", "capturedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_version_key" ON "pricing_rules"("version");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_at_idx" ON "audit_logs"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_homeAddressId_fkey" FOREIGN KEY ("homeAddressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access" ADD CONSTRAINT "patient_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access" ADD CONSTRAINT "patient_access_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_destinationAddressId_fkey" FOREIGN KEY ("destinationAddressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_surcharges" ADD CONSTRAINT "ride_surcharges_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_status_history" ADD CONSTRAINT "ride_status_history_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_location_samples" ADD CONSTRAINT "ride_location_samples_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
