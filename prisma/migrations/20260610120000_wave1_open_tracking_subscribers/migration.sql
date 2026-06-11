-- AlterEnum
ALTER TYPE "LandingEventType" ADD VALUE 'FREE_SIGNUP';

-- AlterTable
ALTER TABLE "LandingEvent" ADD COLUMN     "botReason" TEXT;

-- AlterTable
ALTER TABLE "ColdSend" ADD COLUMN     "firstOpenUserAgent" TEXT,
ADD COLUMN     "firstOpenedAt" TIMESTAMP(3),
ADD COLUMN     "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN     "openCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "suspectedPrefetch" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WeeklyScoreSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "businessId" TEXT,
    "landingPageId" TEXT,
    "unsubToken" TEXT NOT NULL,
    "consentRecordId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'landing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WeeklyScoreSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScoreSubscriber_unsubToken_key" ON "WeeklyScoreSubscriber"("unsubToken");

-- CreateIndex
CREATE INDEX "WeeklyScoreSubscriber_businessId_idx" ON "WeeklyScoreSubscriber"("businessId");

-- CreateIndex
CREATE INDEX "WeeklyScoreSubscriber_unsubscribedAt_lastSentAt_idx" ON "WeeklyScoreSubscriber"("unsubscribedAt", "lastSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScoreSubscriber_email_businessId_key" ON "WeeklyScoreSubscriber"("email", "businessId");

-- CreateIndex
CREATE INDEX "ColdSend_firstOpenedAt_idx" ON "ColdSend"("firstOpenedAt");

