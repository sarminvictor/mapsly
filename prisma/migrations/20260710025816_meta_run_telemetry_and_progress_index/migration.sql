-- AlterTable
ALTER TABLE "AdMarketRun" ADD COLUMN     "apifyRunId" TEXT,
ADD COLUMN     "detailJson" JSONB;

-- CreateIndex
CREATE INDEX "AdMarketRun_platform_ranAt_idx" ON "AdMarketRun"("platform", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "EnrichmentJob_runId_businessId_status_idx" ON "EnrichmentJob"("runId", "businessId", "status");

