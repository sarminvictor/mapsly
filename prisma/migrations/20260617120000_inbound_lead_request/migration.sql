-- Inbound marketing lead-capture · undiscovered business owners who request a
-- free report from /for-businesses (the hero autosuggest found no landing).
-- Additive only (one new table) → forward-only, no data loss.

-- CreateTable
CREATE TABLE "InboundLeadRequest" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceUrl" TEXT,
    "locale" TEXT,
    "businessId" TEXT,
    "consentRecordId" TEXT,
    "ipHash" TEXT,
    "reportSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundLeadRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundLeadRequest_email_businessName_key" ON "InboundLeadRequest"("email", "businessName");

-- CreateIndex
CREATE INDEX "InboundLeadRequest_status_createdAt_idx" ON "InboundLeadRequest"("status", "createdAt");
