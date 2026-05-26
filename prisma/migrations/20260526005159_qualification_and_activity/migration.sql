-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('NOT_QUALIFIED', 'QUALIFIED', 'DISQUALIFIED', 'UNREACHABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailDiscoverySource" AS ENUM ('SCRAPE_HOMEPAGE', 'SCRAPE_CONTACT', 'SCRAPE_ABOUT', 'SCRAPE_TEAM', 'SCRAPE_FOOTER', 'SCRAPE_BOOKING', 'RDAP', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('NOT_CHECKED', 'ACTIVE', 'STALE', 'NO_REVIEWS', 'FAILED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "activityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "activityCheckedByUserId" TEXT,
ADD COLUMN     "activityStatus" "ActivityStatus" NOT NULL DEFAULT 'NOT_CHECKED',
ADD COLUMN     "emailCandidates" JSONB,
ADD COLUMN     "emailDiscovered" TEXT,
ADD COLUMN     "emailDiscoveredAt" TIMESTAMP(3),
ADD COLUMN     "emailDiscoverySource" "EmailDiscoverySource",
ADD COLUMN     "lastReviewAt" TIMESTAMP(3),
ADD COLUMN     "qualificationFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "qualificationStatus" "QualificationStatus" NOT NULL DEFAULT 'NOT_QUALIFIED',
ADD COLUMN     "qualifiedAt" TIMESTAMP(3),
ADD COLUMN     "qualifiedByUserId" TEXT;

-- AlterTable
ALTER TABLE "TrackedLocation" ADD COLUMN     "activeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disqualifiedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastActivityCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastQualifyAt" TIMESTAMP(3),
ADD COLUMN     "noReviewsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualifiedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalActivityCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalQualifyCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "unreachableCount" INTEGER NOT NULL DEFAULT 0;
