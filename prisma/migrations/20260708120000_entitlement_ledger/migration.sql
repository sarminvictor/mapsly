-- Entitlement model (2026-07-08) · Phase 1 · additive, ships DARK behind the
-- ENTITLEMENT_BILLING flag. No backfill (pre-launch wipe · owner decision 1).

-- AlterEnum · two new terminal-SUCCESS statuses. CHARGED_FROM_DB = served from
-- our DB copy at full charge, zero vendor COGS. SKIPPED_ENTITLED = agency
-- already owns the unit, $0. (ADD VALUE is safe here: PG15 allows it in a tx as
-- long as the new value is not USED in the same tx — it is not.)
ALTER TYPE "EnrichmentJobStatus" ADD VALUE 'CHARGED_FROM_DB';
ALTER TYPE "EnrichmentJobStatus" ADD VALUE 'SKIPPED_ENTITLED';

-- CreateTable · per-agency research entitlement ledger.
CREATE TABLE "AgencyEntitlement" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "businessId" TEXT,
    "cellKey" TEXT,
    "family" "EnrichmentFamily" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRunId" TEXT,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex · the two unique keys double as the batched-read indexes.
CREATE UNIQUE INDEX "AgencyEntitlement_agencyId_businessId_family_key" ON "AgencyEntitlement"("agencyId", "businessId", "family");
CREATE UNIQUE INDEX "AgencyEntitlement_agencyId_cellKey_family_key" ON "AgencyEntitlement"("agencyId", "cellKey", "family");
CREATE INDEX "AgencyEntitlement_agencyId_family_idx" ON "AgencyEntitlement"("agencyId", "family");
CREATE INDEX "AgencyEntitlement_businessId_idx" ON "AgencyEntitlement"("businessId");
CREATE INDEX "AgencyEntitlement_cellKey_idx" ON "AgencyEntitlement"("cellKey");

-- XOR CHECK (G5) · exactly one of businessId / cellKey is set. Prisma can't
-- express this; without it Postgres NULLS DISTINCT would let a both-null /
-- wrong-null row escape BOTH unique indexes and silently double-mint.
ALTER TABLE "AgencyEntitlement"
  ADD CONSTRAINT "AgencyEntitlement_business_xor_cell"
  CHECK (("businessId" IS NULL) <> ("cellKey" IS NULL));

-- FT-2 · partial covering index for the "Search everywhere" keyset scan.
-- EXPLAIN (2026-07-08, 5.7k rows) showed a cheap seq-scan+sort at current scale,
-- and proved the existing Business_cellKey_reviewCount_idx is NOT used for this
-- query (the isActive/reachableChannelCount filter can't push into it). At the
-- 2.1M target this partial index lets the planner do an index scan in
-- [cellKey, reviewCount desc, id] order over ONLY the reachable/active/visible
-- rows — no sort. Prisma can't express a partial (WHERE) index, so it's raw SQL.
CREATE INDEX "Business_search_everywhere_idx"
  ON "Business" ("cellKey", "reviewCount" DESC, "id")
  WHERE "isActive" AND NOT "isHidden" AND "reachableChannelCount" > 0;
