-- Landing pages · personalized public proposal pages (/l/[slug]-[token]).
-- Additive only (two new tables + one enum) → forward-only, no data loss.

-- CreateEnum
CREATE TYPE "LandingEventType" AS ENUM ('PAGE_OPENED', 'SECTION_VIEWED', 'CTA_CLICKED', 'CHECKOUT_OPENED', 'SUBSCRIPTION_BOUGHT');

-- CreateTable: LandingPage — one per Business, the token + funnel anchor
CREATE TABLE "LandingPage" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT,
  CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LandingEvent — captured funnel events per landing page
CREATE TABLE "LandingEvent" (
  "id" TEXT NOT NULL,
  "landingPageId" TEXT NOT NULL,
  "type" "LandingEventType" NOT NULL,
  "section" TEXT,
  "visitorId" TEXT,
  "sessionId" TEXT,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "isBot" BOOLEAN NOT NULL DEFAULT false,
  "stripeSessionId" TEXT,
  "convertedUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandingEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "LandingPage_businessId_key" ON "LandingPage"("businessId");
CREATE UNIQUE INDEX "LandingPage_token_key" ON "LandingPage"("token");
CREATE INDEX "LandingPage_businessId_idx" ON "LandingPage"("businessId");

CREATE INDEX "LandingEvent_landingPageId_type_createdAt_idx" ON "LandingEvent"("landingPageId", "type", "createdAt");
CREATE INDEX "LandingEvent_landingPageId_createdAt_idx" ON "LandingEvent"("landingPageId", "createdAt");
CREATE INDEX "LandingEvent_visitorId_idx" ON "LandingEvent"("visitorId");
CREATE INDEX "LandingEvent_stripeSessionId_idx" ON "LandingEvent"("stripeSessionId");

-- Foreign keys
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LandingEvent" ADD CONSTRAINT "LandingEvent_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
