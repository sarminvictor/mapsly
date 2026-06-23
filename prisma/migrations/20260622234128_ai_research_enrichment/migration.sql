-- CreateTable
CREATE TABLE "BusinessEnrichment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subType" TEXT,
    "sophistication" TEXT,
    "pricingTransparency" TEXT,
    "positioningSummary" TEXT,
    "complianceCues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "painHypotheses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitivePositioning" TEXT,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentStageRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "outputJson" JSONB,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentStageRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessEnrichment_businessId_key" ON "BusinessEnrichment"("businessId");

-- CreateIndex
CREATE INDEX "BusinessEnrichment_businessId_idx" ON "BusinessEnrichment"("businessId");

-- CreateIndex
CREATE INDEX "EnrichmentStageRun_businessId_stage_idx" ON "EnrichmentStageRun"("businessId", "stage");

