-- WP0 · MVP 10/10 schema wave · fully additive (nullable columns, new indexes,
-- new tables). Safe to deploy with `prisma migrate deploy`. No data changes.

-- WP0-6 · Agency seat cap (pooled wallet stays agency-level via AgencyWallet).
ALTER TABLE "Agency" ADD COLUMN     "maxSeats" INTEGER;

-- WP0-7 · Business do-not-sell suppression.
ALTER TABLE "Business" ADD COLUMN     "suppressedAt" TIMESTAMP(3);

-- WP0-7 · Contact-level opt-out.
ALTER TABLE "Contact" ADD COLUMN     "optedOutAt" TIMESTAMP(3);

-- WP0-1 · Owning agency on generated drafts (backfilled in app code later).
ALTER TABLE "OutreachDraft" ADD COLUMN     "agencyId" TEXT;

-- WP0-5 · Exponential-backoff marker for the job pool.
ALTER TABLE "EnrichmentJob" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- WP0-4 · Discovery run-start stamp (stuck-discovery recovery anchor).
ALTER TABLE "Discovery" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable · WP0-8 · server-side activation analytics.
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "propsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable · WP0-9 · per-agency saved goal templates.
CREATE TABLE "AgencyTemplate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basedOnTemplate" TEXT,
    "signalsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex · WP0-1
CREATE INDEX "OutreachDraft_agencyId_idx" ON "OutreachDraft"("agencyId");

-- CreateIndex · WP0-2
CREATE INDEX "EnrichmentJob_runId_status_idx" ON "EnrichmentJob"("runId", "status");

-- CreateIndex · WP0-2
CREATE INDEX "EnrichmentJob_status_createdAt_idx" ON "EnrichmentJob"("status", "createdAt");

-- CreateIndex · WP0-3
CREATE INDEX "CreditLedger_runId_type_idx" ON "CreditLedger"("runId", "type");

-- CreateIndex · WP0-8
CREATE INDEX "ProductEvent_type_createdAt_idx" ON "ProductEvent"("type", "createdAt");

-- CreateIndex · WP0-8
CREATE INDEX "ProductEvent_agencyId_createdAt_idx" ON "ProductEvent"("agencyId", "createdAt");

-- CreateIndex · WP0-9
CREATE INDEX "AgencyTemplate_agencyId_idx" ON "AgencyTemplate"("agencyId");
