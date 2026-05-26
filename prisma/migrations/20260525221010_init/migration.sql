-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AgencyPlan" AS ENUM ('SOLO', 'GROWTH', 'AGENCY_PRO', 'BOUTIQUE');

-- CreateEnum
CREATE TYPE "AgencyMemberRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ReviewSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'GOOGLE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "ListServiceType" AS ENUM ('WEBSITE_REBUILD', 'META_ADS_CAMPAIGN', 'GOOGLE_ADS_LAUNCH', 'LOCAL_SEO', 'REVIEW_MANAGEMENT', 'BRAND_DEFENSE', 'NEW_BUSINESS_LAUNCH', 'FULL_AUDIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ListCadence" AS ENUM ('DAILY', 'WEEKLY', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'WON', 'LOST', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('CSV_LIST', 'PDF_ONE_PAGER', 'SHARE_LINK');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'READY', 'SHARED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskDomain" AS ENUM ('FOUNDATION', 'MARKETING', 'DATA', 'COMPUTE', 'SMB_PORTAL', 'AGENCY_PORTAL', 'BILLING', 'OPS', 'I18N');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'SKIPPED', 'FAILED', 'HUMAN_REQUIRED');

-- CreateEnum
CREATE TYPE "TaskRunOutcome" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'PARTIAL', 'FAILED', 'ABORTED', 'SKIPPED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AgentInvocationStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePlan" TEXT,
    "stripeStatus" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "defaultMetro" TEXT,
    "categoriesServed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan" "AgencyPlan" NOT NULL DEFAULT 'SOLO',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePlan" TEXT,
    "stripeStatus" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyMember" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AgencyMemberRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "googleCid" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "instagramHandle" TEXT,
    "instagramFollowers" INTEGER,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "photosCount" INTEGER,
    "hours" JSONB,
    "attributes" JSONB,
    "isClaimed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenOnGoogle" TIMESTAMP(3),
    "yearsOnGoogle" INTEGER,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessService" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSnapshot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "photosCount" INTEGER,
    "replyRate" DOUBLE PRECISION,
    "velocityLast30d" INTEGER,
    "mapslyScore" DOUBLE PRECISION,
    "msiRank" INTEGER,
    "msiTotal" INTEGER,
    "hoursPerWeek" INTEGER,
    "reputationScore" DOUBLE PRECISION,
    "communicationScore" DOUBLE PRECISION,
    "profileCompletenessScore" DOUBLE PRECISION,
    "trustScore" DOUBLE PRECISION,
    "pricingTransparencyScore" DOUBLE PRECISION,
    "brandPresenceScore" DOUBLE PRECISION,
    "raw" JSONB,

    CONSTRAINT "BusinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "externalId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "reviewerProfileReviews" INTEGER,
    "stars" INTEGER NOT NULL,
    "text" TEXT,
    "language" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "ownerReplied" BOOLEAN NOT NULL DEFAULT false,
    "ownerReplyText" TEXT,
    "ownerReplyAt" TIMESTAMP(3),
    "sentiment" "ReviewSentiment",
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "aiReplyDraftEn" TEXT,
    "aiReplyDraftEs" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LighthouseAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performance" DOUBLE PRECISION,
    "accessibility" DOUBLE PRECISION,
    "bestPractices" DOUBLE PRECISION,
    "seo" DOUBLE PRECISION,
    "pwa" DOUBLE PRECISION,
    "lcp" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "fcp" DOUBLE PRECISION,
    "tbt" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,
    "totalBytes" INTEGER,
    "hasLocalBusinessSchema" BOOLEAN,
    "hasFaqSchema" BOOLEAN,
    "hasBookingCtaAboveFold" BOOLEAN,
    "hasPhoneAboveFold" BOOLEAN,
    "napConsistent" BOOLEAN,
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LighthouseAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdLibraryEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "platform" "AdPlatform" NOT NULL,
    "externalAdId" TEXT NOT NULL,
    "adCreativeBody" TEXT,
    "landingUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "targetGeo" TEXT,
    "targetGender" TEXT,
    "targetAgeMin" INTEGER,
    "targetAgeMax" INTEGER,
    "impressionsMid" INTEGER,
    "spendMidLow" DOUBLE PRECISION,
    "spendMidHigh" DOUBLE PRECISION,
    "matchedKeyword" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "locationCode" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "searchVolume" INTEGER,
    "cpc" DOUBLE PRECISION,
    "competition" TEXT,
    "competitionIndex" INTEGER,
    "trend12Month" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3),

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpResult" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "businessId" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localPackRank" INTEGER,
    "organicRank" INTEGER,
    "organicAbsRank" INTEGER,
    "landingUrl" TEXT,
    "pack1Name" TEXT,
    "pack2Name" TEXT,
    "pack3Name" TEXT,
    "isBrandQuery" BOOLEAN NOT NULL DEFAULT false,
    "paidBidders" JSONB,

    CONSTRAINT "SerpResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ownerMemberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" "ListServiceType" NOT NULL,
    "pitch" TEXT,
    "filterJson" JSONB NOT NULL,
    "refreshCadence" "ListCadence" NOT NULL DEFAULT 'WEEKLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "metro" TEXT,
    "radiusMi" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListRefresh" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchesBefore" INTEGER NOT NULL,
    "matchesAfter" INTEGER NOT NULL,
    "added" INTEGER NOT NULL,
    "removed" INTEGER NOT NULL,

    CONSTRAINT "ListRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "matchScore" DOUBLE PRECISION,
    "contactedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "businessId" TEXT,
    "listId" TEXT,
    "type" "ReportType" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'READY',
    "publicShareId" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "storageUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "meta" JSONB,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domain" "TaskDomain" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerUrl" TEXT,
    "targetDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "effort" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "deps" TEXT,
    "tags" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scoreAvg" DOUBLE PRECISION,
    "scoreCompletion" INTEGER,
    "scoreQuality" INTEGER,
    "scoreAudience" INTEGER,
    "scoreRelevance" INTEGER,
    "scorePerformance" INTEGER,
    "lastPrNumber" INTEGER,
    "lastPrUrl" TEXT,
    "lastCommitSha" TEXT,
    "lastSessionId" TEXT,
    "notes" TEXT,
    "contextBundle" JSONB,
    "parallelLane" TEXT,
    "independent" BOOLEAN NOT NULL DEFAULT false,
    "filesPlanned" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "TaskRunOutcome" NOT NULL DEFAULT 'IN_PROGRESS',
    "scoreCompletion" INTEGER,
    "scoreQuality" INTEGER,
    "scoreAudience" INTEGER,
    "scoreRelevance" INTEGER,
    "scorePerformance" INTEGER,
    "scoreAggregate" DOUBLE PRECISION,
    "branchName" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "commitSha" TEXT,
    "filesChanged" TEXT,
    "linesAdded" INTEGER,
    "linesDeleted" INTEGER,
    "testsAdded" INTEGER NOT NULL DEFAULT 0,
    "resumedFromRunId" TEXT,
    "ciPassed" BOOLEAN,
    "deployPassed" BOOLEAN,
    "lighthousePassed" BOOLEAN,
    "agentsUsed" TEXT,
    "skillsUsed" TEXT,
    "rulesConsulted" TEXT,
    "mcpsUsed" TEXT,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "durationSec" INTEGER,
    "incidentsLogged" TEXT,
    "errorMessage" TEXT,
    "validationStrategy" TEXT,
    "validationOutcomes" TEXT,
    "validationNotes" TEXT,
    "screenshotsUrls" TEXT,
    "testsAddedFiles" TEXT,
    "toolsInstalled" TEXT,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "level" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "taskId" TEXT,
    "incidentId" TEXT,
    "prNumber" INTEGER,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentInvocation" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" "AgentInvocationStatus" NOT NULL DEFAULT 'RUNNING',
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "verdict" TEXT,
    "scoreReturned" DOUBLE PRECISION,
    "filesReviewed" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "AgentInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostBudget" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dailyBudgetUsd" DOUBLE PRECISION NOT NULL,
    "weeklyBudgetUsd" DOUBLE PRECISION,
    "monthlyBudgetUsd" DOUBLE PRECISION,
    "alertThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "haltThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 1.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskRunId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheRead" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheWrite" INTEGER NOT NULL DEFAULT 0,
    "costUsdEstimate" DOUBLE PRECISION,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "apiVersion" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeCustomerId_key" ON "Agency"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeSubscriptionId_key" ON "Agency"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyMember_agencyId_userId_key" ON "AgencyMember"("agencyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_googlePlaceId_key" ON "Business"("googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_googleCid_key" ON "Business"("googleCid");

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "Business_category_city_idx" ON "Business"("category", "city");

-- CreateIndex
CREATE INDEX "Business_country_province_city_idx" ON "Business"("country", "province", "city");

-- CreateIndex
CREATE INDEX "Business_lat_lng_idx" ON "Business"("lat", "lng");

-- CreateIndex
CREATE INDEX "Business_category_country_idx" ON "Business"("category", "country");

-- CreateIndex
CREATE INDEX "BusinessService_businessId_sortOrder_idx" ON "BusinessService"("businessId", "sortOrder");

-- CreateIndex
CREATE INDEX "BusinessService_businessId_isActive_idx" ON "BusinessService"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "BusinessSnapshot_businessId_snapshotDate_idx" ON "BusinessSnapshot"("businessId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSnapshot_businessId_snapshotDate_key" ON "BusinessSnapshot"("businessId", "snapshotDate");

-- CreateIndex
CREATE INDEX "Review_businessId_postedAt_idx" ON "Review"("businessId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_businessId_externalId_key" ON "Review"("businessId", "externalId");

-- CreateIndex
CREATE INDEX "LighthouseAudit_businessId_auditedAt_idx" ON "LighthouseAudit"("businessId", "auditedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdLibraryEntry_externalAdId_key" ON "AdLibraryEntry"("externalAdId");

-- CreateIndex
CREATE INDEX "AdLibraryEntry_businessId_platform_idx" ON "AdLibraryEntry"("businessId", "platform");

-- CreateIndex
CREATE INDEX "AdLibraryEntry_matchedKeyword_idx" ON "AdLibraryEntry"("matchedKeyword");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_keyword_locationCode_language_key" ON "Keyword"("keyword", "locationCode", "language");

-- CreateIndex
CREATE INDEX "SerpResult_keywordId_scannedAt_idx" ON "SerpResult"("keywordId", "scannedAt");

-- CreateIndex
CREATE INDEX "SerpResult_businessId_scannedAt_idx" ON "SerpResult"("businessId", "scannedAt");

-- CreateIndex
CREATE INDEX "ListRefresh_listId_refreshedAt_idx" ON "ListRefresh"("listId", "refreshedAt");

-- CreateIndex
CREATE INDEX "Lead_agencyId_status_idx" ON "Lead"("agencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_listId_businessId_key" ON "Lead"("listId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_publicShareId_key" ON "Report"("publicShareId");

-- CreateIndex
CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");

-- CreateIndex
CREATE INDEX "TaskGroup_domain_sortOrder_idx" ON "TaskGroup"("domain", "sortOrder");

-- CreateIndex
CREATE INDEX "Task_status_groupId_sortOrder_idx" ON "Task"("status", "groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "Task_parallelLane_status_idx" ON "Task"("parallelLane", "status");

-- CreateIndex
CREATE INDEX "Task_groupId_sortOrder_idx" ON "Task"("groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "TaskRun_taskId_startedAt_idx" ON "TaskRun"("taskId", "startedAt");

-- CreateIndex
CREATE INDEX "TaskRun_sessionId_idx" ON "TaskRun"("sessionId");

-- CreateIndex
CREATE INDEX "TaskRun_outcome_idx" ON "TaskRun"("outcome");

-- CreateIndex
CREATE INDEX "TaskRun_resumedFromRunId_idx" ON "TaskRun"("resumedFromRunId");

-- CreateIndex
CREATE INDEX "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_category_createdAt_idx" ON "Notification"("category", "createdAt");

-- CreateIndex
CREATE INDEX "AgentInvocation_taskRunId_agentName_idx" ON "AgentInvocation"("taskRunId", "agentName");

-- CreateIndex
CREATE INDEX "AgentInvocation_agentName_startedAt_idx" ON "AgentInvocation"("agentName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostBudget_scope_key" ON "CostBudget"("scope");

-- CreateIndex
CREATE INDEX "TokenUsage_occurredAt_idx" ON "TokenUsage"("occurredAt");

-- CreateIndex
CREATE INDEX "TokenUsage_sessionId_idx" ON "TokenUsage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_type_idx" ON "StripeWebhookEvent"("type");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_receivedAt_idx" ON "StripeWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processedAt_idx" ON "StripeWebhookEvent"("processedAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMember" ADD CONSTRAINT "AgencyMember_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMember" ADD CONSTRAINT "AgencyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessService" ADD CONSTRAINT "BusinessService_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSnapshot" ADD CONSTRAINT "BusinessSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LighthouseAudit" ADD CONSTRAINT "LighthouseAudit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdLibraryEntry" ADD CONSTRAINT "AdLibraryEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpResult" ADD CONSTRAINT "SerpResult_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpResult" ADD CONSTRAINT "SerpResult_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "AgencyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListRefresh" ADD CONSTRAINT "ListRefresh_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TaskGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
