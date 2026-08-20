-- Money movement: invoices, payment attempts, and the dunning that follows a
-- decline.
--
-- The billing *model* landed with the two-sided subscription migration: plans,
-- periods, seats and entitlements. What it had no room for was the thing that
-- actually settles — so a period was written, quoted and stamped with its plan
-- version, and then nothing ever charged it. This migration adds the four
-- tables that close that loop.
--
-- Three things below are hand-written rather than generated:
--
--   1. `invoice_number_seq`, created **before** the table that defaults to it.
--      Prisma emits the column default but not the sequence behind it, so the
--      generated file alone fails on a clean database. A number minted in
--      application code was the alternative and is worse: two sweeps renewing
--      at the same instant would read the same maximum and mint the same
--      number, which is discovered by the two customers holding it.
--   2. A partial unique index giving each billing account at most one default
--      payment method. Prisma cannot express a partial index, and "which card
--      do we charge" having two answers is not a question worth resolving by
--      row order.
--   3. A CHECK that a payment never claims to have moved a negative amount. A
--      negative charge is a refund, which is a different row with a different
--      status, and conflating the two makes every revenue sum wrong.

-- CreateSequence
--
-- Owned by nothing, so a table rewrite cannot drop it and restart numbering
-- from one — which would collide with every invoice already issued.
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" AS BIGINT START WITH 1000 INCREMENT BY 1;

-- CreateEnum
CREATE TYPE "InvoiceReason" AS ENUM ('subscriptionPeriod', 'seatProration', 'intervalSwitch');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'paid', 'uncollectible', 'void');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "detachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "periodId" TEXT,
    "reason" "InvoiceReason" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'open',
    "number" TEXT NOT NULL DEFAULT ('CB-' || lpad(nextval('invoice_number_seq')::text, 6, '0')),
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "subtotalCents" INTEGER NOT NULL,
    "creditAppliedCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "externalInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "attempt" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "externalPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processor_events" (
    "id" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "skippedReason" TEXT,

    CONSTRAINT "processor_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_externalId_key" ON "payment_methods"("externalId");

-- CreateIndex
CREATE INDEX "payment_methods_billingAccountId_detachedAt_idx" ON "payment_methods"("billingAccountId", "detachedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_periodId_key" ON "invoices"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_externalInvoiceId_key" ON "invoices"("externalInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_billingAccountId_issuedAt_idx" ON "invoices"("billingAccountId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_status_nextAttemptAt_idx" ON "invoices"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_externalPaymentId_key" ON "payments"("externalPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_invoiceId_createdAt_idx" ON "payments"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_billingAccountId_createdAt_idx" ON "payments"("billingAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "processor_events_externalEventId_key" ON "processor_events"("externalEventId");

-- CreateIndex
CREATE INDEX "processor_events_type_receivedAt_idx" ON "processor_events"("type", "receivedAt");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "subscription_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
--
-- At most one default card per account. Partial, so the many rows that are not
-- the default do not contend for uniqueness on `false`.
CREATE UNIQUE INDEX "payment_methods_one_default_per_account"
    ON "payment_methods" ("billingAccountId")
    WHERE "isDefault" AND "detachedAt" IS NULL;

-- AddCheckConstraint
--
-- A payment moves money one way. A refund is a `refunded` row, not a negative
-- charge, and every revenue sum in the system assumes that.
ALTER TABLE "payments"
    ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amountCents" >= 0);

-- AddCheckConstraint
--
-- An invoice cannot be settled for more than it asked for. Without this, a
-- redelivered webhook that slipped past the processor-event table would
-- silently credit an account twice and the drift would only surface in a
-- reconciliation nobody runs until the first dispute.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_amount_paid_within_total"
    CHECK ("amountPaidCents" >= 0 AND "amountPaidCents" <= "totalCents");
