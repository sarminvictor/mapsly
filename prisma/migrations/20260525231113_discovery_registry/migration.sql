-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('DISCOVERY', 'MANUAL_SEED', 'ONBOARDING', 'HUNTER_EXPAND');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "source" "BusinessSource" NOT NULL DEFAULT 'DISCOVERY';

-- CreateTable
CREATE TABLE "BusinessCategory" (
    "id" TEXT NOT NULL,
    "dataforseoId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "groupKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "BusinessCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLocation" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusKm" INTEGER NOT NULL DEFAULT 5,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalNewFound" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "TrackedLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "trackedLocationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredByUserId" TEXT,
    "radiusKm" INTEGER NOT NULL,
    "limitRequested" INTEGER NOT NULL,
    "totalReturned" INTEGER NOT NULL DEFAULT 0,
    "newBusinesses" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "meta" JSONB,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCategory_dataforseoId_key" ON "BusinessCategory"("dataforseoId");

-- CreateIndex
CREATE INDEX "BusinessCategory_groupKey_label_idx" ON "BusinessCategory"("groupKey", "label");

-- CreateIndex
CREATE INDEX "BusinessCategory_isActive_idx" ON "BusinessCategory"("isActive");

-- CreateIndex
CREATE INDEX "TrackedLocation_categoryId_lastRunAt_idx" ON "TrackedLocation"("categoryId", "lastRunAt");

-- CreateIndex
CREATE INDEX "TrackedLocation_isActive_idx" ON "TrackedLocation"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLocation_categoryId_city_province_country_key" ON "TrackedLocation"("categoryId", "city", "province", "country");

-- CreateIndex
CREATE INDEX "DiscoveryRun_trackedLocationId_startedAt_idx" ON "DiscoveryRun"("trackedLocationId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "DiscoveryRun_categoryId_startedAt_idx" ON "DiscoveryRun"("categoryId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "DiscoveryRun_startedAt_idx" ON "DiscoveryRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "DiscoveryRun_status_idx" ON "DiscoveryRun"("status");

-- AddForeignKey
ALTER TABLE "TrackedLocation" ADD CONSTRAINT "TrackedLocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BusinessCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_trackedLocationId_fkey" FOREIGN KEY ("trackedLocationId") REFERENCES "TrackedLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BusinessCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
