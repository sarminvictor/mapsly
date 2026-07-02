-- WP9-4 · raw-list covering index. Fully additive (one new index). Safe to
-- deploy with `prisma migrate deploy`. No data changes.
--
-- The raw-list read model (modules/discovery/raw-list.ts) filters
-- `cellKey IN (...)` and sorts `reviewCount DESC NULLS LAST, id ASC` for both
-- the Preview sample and the workbench cursor pagination. The single-column
-- `Business_cellKey_idx` served the filter but forced an in-memory sort of the
-- whole cell; this composite lets Postgres walk the cell in review-count order
-- directly so per-cell pages come back in index order at 2.1M scale.
--
-- NOTE (Neon/production apply): building an index on the 2.1M-row Business
-- table with a plain CREATE INDEX takes an ACCESS EXCLUSIVE lock. When applying
-- to the live Neon branch, prefer running the equivalent
-- `CREATE INDEX CONCURRENTLY "Business_cellKey_reviewCount_idx" ON "Business"("cellKey", "reviewCount" DESC);`
-- OUTSIDE a migration transaction (CONCURRENTLY can't run inside one), then mark
-- this migration applied. Left as a plain CREATE INDEX here to match Prisma's
-- generated DDL for `@@index`.

-- CreateIndex
CREATE INDEX "Business_cellKey_reviewCount_idx" ON "Business"("cellKey", "reviewCount" DESC);
