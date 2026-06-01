-- Scoring v2 · market-relative pillars
-- Additive only (nullable columns + new table) → forward-only, no data loss.

-- AlterTable: BusinessSnapshot — pillar input bag + pillar outputs
ALTER TABLE "BusinessSnapshot"
  ADD COLUMN "signalsJson" JSONB,
  ADD COLUMN "reputationPillar" DOUBLE PRECISION,
  ADD COLUMN "visibilityPillar" DOUBLE PRECISION,
  ADD COLUMN "profilePillar" DOUBLE PRECISION,
  ADD COLUMN "websitePillar" DOUBLE PRECISION,
  ADD COLUMN "adsPillar" DOUBLE PRECISION,
  ADD COLUMN "adsApplicable" BOOLEAN,
  ADD COLUMN "pillarScore" DOUBLE PRECISION,
  ADD COLUMN "msiPercentile" DOUBLE PRECISION,
  ADD COLUMN "cellKey" TEXT,
  ADD COLUMN "cellConfidence" TEXT;

-- CreateTable: CellMetric — per (category × city × country) market reference
CREATE TABLE "CellMetric" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "cellKey" TEXT NOT NULL,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "confidence" TEXT NOT NULL DEFAULT 'low',
  "ratingP50" DOUBLE PRECISION,
  "reviewCountP50" INTEGER,
  "reviewCountP90" INTEGER,
  "photoCountP50" INTEGER,
  "replyRateP50" DOUBLE PRECISION,
  "velocityP50" DOUBLE PRECISION,
  "lighthousePerfP50" INTEGER,
  "shareOfVoiceP50" DOUBLE PRECISION,
  "adPrevalence" DOUBLE PRECISION,
  "distributions" JSONB,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CellMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CellMetric_category_city_country_key" ON "CellMetric"("category", "city", "country");
CREATE INDEX "CellMetric_cellKey_idx" ON "CellMetric"("cellKey");
CREATE INDEX "CellMetric_category_city_country_idx" ON "CellMetric"("category", "city", "country");
