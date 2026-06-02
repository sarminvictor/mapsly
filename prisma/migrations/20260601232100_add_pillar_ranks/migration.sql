-- Scoring v2 · per-pillar ranks within the cell. Additive, forward-only.
ALTER TABLE "BusinessSnapshot"
  ADD COLUMN "pillarRanks" JSONB,
  ADD COLUMN "cellSize" INTEGER;
