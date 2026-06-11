-- Discovery saturation visibility: store DataForSEO total_count so the
-- admin can see how loaded a cell is vs how much we've indexed.
ALTER TABLE "DiscoveryRun" ADD COLUMN "totalAvailable" INTEGER;
ALTER TABLE "TrackedLocation" ADD COLUMN "lastTotalAvailable" INTEGER;
