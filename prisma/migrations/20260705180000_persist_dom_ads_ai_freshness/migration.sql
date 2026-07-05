-- Enrichment overhaul (2026-07-05) · fully additive (nullable columns only).
-- Safe to deploy with `prisma migrate deploy`. No data changes, no locks on a
-- large table (nullable ADD COLUMN with no default is metadata-only in Postgres).
--
--   siteText/siteTextAt   · persist the contacts-scan site DOM text (24k cap) so
--                           the Services + AI-research jobs read the real website
--                           instead of the thin Google listing.
--   servicesLastAt        · Services 90-day freshness cursor (stop double-billing).
--   aiResearchLastAt      · AI-research 90-day freshness cursor.
--   googleAdsLastAt       · Google-ads per-business 30-day freshness cursor (the
--                           per-cell → per-business billing move).
ALTER TABLE "Business" ADD COLUMN     "siteText" TEXT,
ADD COLUMN     "siteTextAt" TIMESTAMP(3),
ADD COLUMN     "servicesLastAt" TIMESTAMP(3),
ADD COLUMN     "aiResearchLastAt" TIMESTAMP(3),
ADD COLUMN     "googleAdsLastAt" TIMESTAMP(3);
