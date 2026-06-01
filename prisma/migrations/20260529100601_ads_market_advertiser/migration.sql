-- CreateTable
CREATE TABLE "AdMarketAdvertiser" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "locationCode" INTEGER NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "handle" TEXT,
    "followerCount" INTEGER,
    "pageCategory" TEXT,
    "activeAdCount" INTEGER NOT NULL DEFAULT 0,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runningSince" TIMESTAMP(3),
    "creatives" JSONB,
    "matchedBusinessId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AdMarketAdvertiser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdMarketAdvertiser_category_city_country_isActive_idx" ON "AdMarketAdvertiser"("category", "city", "country", "isActive");

-- CreateIndex
CREATE INDEX "AdMarketAdvertiser_matchedBusinessId_idx" ON "AdMarketAdvertiser"("matchedBusinessId");

-- CreateIndex
CREATE INDEX "AdMarketAdvertiser_pageId_idx" ON "AdMarketAdvertiser"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "AdMarketAdvertiser_category_city_country_platform_pageId_key" ON "AdMarketAdvertiser"("category", "city", "country", "platform", "pageId");

