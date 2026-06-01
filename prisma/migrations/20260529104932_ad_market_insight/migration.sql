-- CreateTable
CREATE TABLE "AdMarketInsight" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL DEFAULT 'META',
    "observations" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "creativesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdMarketInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdMarketInsight_category_city_country_idx" ON "AdMarketInsight"("category", "city", "country");

-- CreateIndex
CREATE UNIQUE INDEX "AdMarketInsight_category_city_country_platform_key" ON "AdMarketInsight"("category", "city", "country", "platform");

