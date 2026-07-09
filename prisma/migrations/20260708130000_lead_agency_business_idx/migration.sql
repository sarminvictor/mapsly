-- FT-2 agency-wide dedup (2026-07-08) · additive.
-- "Businesses this agency already holds in any research" is
--   SELECT DISTINCT "businessId" FROM "Lead" WHERE "agencyId" = $1
-- run before every "Search everywhere" so a new search never re-delivers (and
-- never re-charges for) a lead the agency already owns. This index makes that a
-- single index scan instead of a table scan as Lead grows.
CREATE INDEX IF NOT EXISTS "Lead_agencyId_businessId_idx" ON "Lead" ("agencyId", "businessId");
