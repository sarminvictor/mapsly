-- CreateEnum
CREATE TYPE "BusinessOpenStatus" AS ENUM ('OPEN', 'CLOSED', 'TEMPORARILY_CLOSED', 'CLOSED_FOREVER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReachabilityStatus" AS ENUM ('UNREACHABLE', 'EMAIL_ONLY', 'PHONE_ONLY', 'MULTI', 'RICH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactScanStatus" AS ENUM ('PENDING', 'OK', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TIKTOK', 'YOUTUBE', 'X', 'YELP', 'BOOKING_URL', 'WEBSITE');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('OWNER', 'FRONT_DESK', 'PERSONAL', 'GENERIC', 'SUPPORT', 'BOOKING', 'SOCIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('DFS_LISTING', 'DFS_MAPS', 'SCRAPE_HOMEPAGE', 'SCRAPE_CONTACT', 'SCRAPE_ABOUT', 'SCRAPE_TEAM', 'SCRAPE_FOOTER', 'SCRAPE_JSBUNDLE', 'SCRAPE_JSONLD', 'SCRAPE_MAILTO', 'SCRAPE_TEL', 'SCRAPE_SOCIAL_META', 'RDAP', 'AI_WEB_SEARCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerifiedStatus" AS ENUM ('UNVERIFIED', 'VALID', 'CATCH_ALL', 'RISKY', 'INVALID', 'UNREACHABLE_MX');

-- CreateEnum
CREATE TYPE "ReviewJobStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'AWAITING_PINGBACK', 'FETCHING', 'DONE', 'FAILED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveryCellOutcome" AS ENUM ('SERVED_FROM_DB', 'REFETCHED', 'DISCOVERED_NEW', 'FAILED');

-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrichmentFamily" AS ENUM ('CONTACTS', 'SERVICES', 'TECH', 'REVIEWS', 'META_ADS', 'GOOGLE_ADS', 'SERP', 'LIGHTHOUSE', 'AI_RESEARCH', 'PLAYBOOK');

-- CreateEnum
CREATE TYPE "EnrichmentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED_FRESH');

-- CreateEnum
CREATE TYPE "BusinessTechCategory" AS ENUM ('CMS', 'FRAMEWORK', 'CDN', 'ANALYTICS', 'PIXEL', 'BOOKING', 'CHAT', 'ECOMMERCE', 'HOSTING', 'PAYMENT', 'CONSENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('HOLD', 'SETTLE', 'REFUND', 'TOPUP', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "CostEstimateStatus" AS ENUM ('QUOTED', 'AUTHORIZED', 'CONSUMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "EnrichmentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL', 'OK', 'FAILED');

-- AlterTable
ALTER TABLE "AdLibraryEntry" ADD COLUMN     "cards" JSONB,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "spendBandUsd" TEXT;

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "dailyCostCapUsd" DOUBLE PRECISION,
ADD COLUMN     "mailingAddress" TEXT,
ADD COLUMN     "maxConcurrentRuns" INTEGER;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "anchorDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "categoryProfileSlug" TEXT,
ADD COLUMN     "cbsaGeoid" TEXT,
ADD COLUMN     "cellKey" TEXT,
ADD COLUMN     "complianceFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contactScanStatus" "ContactScanStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "contactsExtractedAt" TIMESTAMP(3),
ADD COLUMN     "crossMetroDupe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enrichmentFreshness" JSONB,
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "holidayHours" JSONB,
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metroSlug" TEXT,
ADD COLUMN     "openStatus" "BusinessOpenStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "openStatusAt" TIMESTAMP(3),
ADD COLUMN     "permanentlyClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reachability" "ReachabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "reachabilityComputedAt" TIMESTAMP(3),
ADD COLUMN     "reachableChannelCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "techScanLastAt" TIMESTAMP(3),
ADD COLUMN     "temporarilyClosed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BusinessService" ADD COLUMN     "canonicalKey" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "detectedVia" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "embeddingId" TEXT,
ADD COLUMN     "rawNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "BusinessSnapshot" ADD COLUMN     "complianceRiskPercentile" DOUBLE PRECISION,
ADD COLUMN     "complianceRiskPillar" DOUBLE PRECISION,
ADD COLUMN     "qualityTrajectory" TEXT,
ADD COLUMN     "reviewLifecycle" TEXT,
ADD COLUMN     "velocityPrev30d" INTEGER;

-- AlterTable
ALTER TABLE "CellMetric" ADD COLUMN     "lastSnapshotAt" TIMESTAMP(3),
ADD COLUMN     "metricsDirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metricsVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "metroSlug" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "enrichmentStateJson" JSONB;

-- AlterTable
ALTER TABLE "LighthouseAudit" ADD COLUMN     "a11yCriticalCount" INTEGER,
ADD COLUMN     "a11yViolationCount" INTEGER,
ADD COLUMN     "diagnostics" JSONB,
ADD COLUMN     "formFactor" TEXT,
ADD COLUMN     "hasVulnerableLibrary" BOOLEAN,
ADD COLUMN     "isOnHttps" BOOLEAN,
ADD COLUMN     "opportunities" JSONB,
ADD COLUMN     "perfSavingsMs" INTEGER,
ADD COLUMN     "techDetectedAt" TIMESTAMP(3),
ADD COLUMN     "techSource" TEXT;

-- AlterTable
ALTER TABLE "List" ADD COLUMN     "discoveryId" TEXT,
ADD COLUMN     "isRaw" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TrackedLocation" ADD COLUMN     "cbsaGeoid" TEXT,
ADD COLUMN     "geocodeSource" TEXT,
ADD COLUMN     "geohash" TEXT,
ADD COLUMN     "lastDiscoveredAt" TIMESTAMP(3),
ADD COLUMN     "lastDiscoveryStatus" "DiscoveryRunStatus",
ADD COLUMN     "metroSlug" TEXT,
ADD COLUMN     "nextStaleAt" TIMESTAMP(3),
ADD COLUMN     "radiusTier" TEXT,
ADD COLUMN     "rawDataVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CostEstimate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "enrichmentsJson" JSONB NOT NULL,
    "scopeRefsJson" JSONB NOT NULL,
    "grossUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "freshHitUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "netUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "netCredits" INTEGER NOT NULL DEFAULT 0,
    "upperBoundUsd" DECIMAL(10,4),
    "confidence" TEXT NOT NULL,
    "priceListVersion" TEXT NOT NULL,
    "freshnessAsOf" TIMESTAMP(3) NOT NULL,
    "status" "CostEstimateStatus" NOT NULL DEFAULT 'QUOTED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedByRunId" TEXT,

    CONSTRAINT "CostEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "estimateId" TEXT,
    "triggeredByUserId" TEXT NOT NULL,
    "enrichmentsJson" JSONB NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeRefsJson" JSONB NOT NULL,
    "status" "EnrichmentRunStatus" NOT NULL DEFAULT 'PENDING',
    "estimatedUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "actualUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "creditsHeld" INTEGER NOT NULL DEFAULT 0,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "unitsRequested" INTEGER NOT NULL DEFAULT 0,
    "unitsCompleted" INTEGER NOT NULL DEFAULT 0,
    "unitsSkippedFresh" INTEGER NOT NULL DEFAULT 0,
    "unitsSkippedHidden" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "workflowRunId" TEXT,
    "meta" JSONB,

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "family" "EnrichmentFamily" NOT NULL,
    "status" "EnrichmentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "runId" TEXT,
    "workflowRunId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyWallet" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "planCredits" INTEGER NOT NULL DEFAULT 0,
    "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
    "rolloverCredits" INTEGER NOT NULL DEFAULT 0,
    "heldCredits" INTEGER NOT NULL DEFAULT 0,
    "cycleResetAt" TIMESTAMP(3) NOT NULL,
    "overageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overageCapUsd" DECIMAL(10,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "runId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "name" TEXT,
    "intentCampaignId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'PENDING',
    "researchStatus" "ResearchStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "viewPref" TEXT,
    "lastOpenedAt" TIMESTAMP(3),
    "cellKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cellCount" INTEGER NOT NULL DEFAULT 0,
    "freshCount" INTEGER NOT NULL DEFAULT 0,
    "refetchedCount" INTEGER NOT NULL DEFAULT 0,
    "totalBusinesses" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cohortSize" INTEGER NOT NULL DEFAULT 0,
    "spendToDateUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freshnessJson" JSONB,
    "loopProgressJson" JSONB,
    "workflowRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Discovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCell" (
    "id" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "trackedLocationId" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "outcome" "DiscoveryCellOutcome" NOT NULL,
    "discoveryRunId" TEXT,
    "businessCount" INTEGER NOT NULL DEFAULT 0,
    "dfsCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellSnapshot" (
    "id" TEXT NOT NULL,
    "trackedLocationId" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "discoveryRunId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessCount" INTEGER NOT NULL DEFAULT 0,
    "totalAvailable" INTEGER,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "closedForeverCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CellSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "role" "ContactRole" NOT NULL DEFAULT 'UNKNOWN',
    "source" "ContactSource" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "verifiedStatus" "VerifiedStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "ReviewJobStatus" NOT NULL DEFAULT 'QUEUED',
    "taskId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 200,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 365,
    "lastError" TEXT,
    "workflowRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTech" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "BusinessTechCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessTech_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMarketRun" (
    "id" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advertiserCount" INTEGER NOT NULL DEFAULT 0,
    "adCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdMarketRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTaxonomy" (
    "id" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "group" TEXT,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "status" TEXT NOT NULL DEFAULT 'seed',
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTaxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellServicePrevalence" (
    "id" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "prevalence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'internal',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CellServicePrevalence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LighthouseOpportunity" (
    "id" TEXT NOT NULL,
    "lighthouseAuditId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "auditKey" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "savingsMs" INTEGER,
    "savingsBytes" INTEGER,
    "displayValue" TEXT,
    "itemCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LighthouseOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryProfile" (
    "id" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "vocabulary" JSONB,
    "regulations" JSONB,
    "benchmarks" JSONB,
    "pitchNuances" JSONB,
    "licenseSource" JSONB,
    "scoringWeightOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessLicense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "trade" TEXT,
    "status" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookFinding" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "playbookVersion" INTEGER NOT NULL DEFAULT 1,
    "signalKey" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "corroboration" INTEGER NOT NULL DEFAULT 0,
    "evidenceJson" JSONB,
    "explanation" TEXT NOT NULL,
    "pitchAngle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notCheckedReason" TEXT,
    "feedback" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT,
    "sellingWhat" TEXT,
    "buyerIcp" TEXT,
    "painPoints" TEXT,
    "budgetHintUsd" DOUBLE PRECISION,
    "proposedPlanJson" JSONB,
    "signalWeightsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPainPoint" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "signalKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPainPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellingWhat" TEXT,
    "recommendedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedEnrichments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signalWeightsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlan" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "discoveryId" TEXT,
    "planJson" JSONB NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT,
    "leadId" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "whyJson" JSONB,
    "predictedTier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT,
    "leadId" TEXT,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitchIntent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "raw" TEXT,
    "parsedJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PitchIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationSelection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metroSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEstimate_agencyId_status_idx" ON "CostEstimate"("agencyId", "status");

-- CreateIndex
CREATE INDEX "CostEstimate_expiresAt_idx" ON "CostEstimate"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentRun_estimateId_key" ON "EnrichmentRun"("estimateId");

-- CreateIndex
CREATE INDEX "EnrichmentRun_agencyId_status_idx" ON "EnrichmentRun"("agencyId", "status");

-- CreateIndex
CREATE INDEX "EnrichmentRun_startedAt_idx" ON "EnrichmentRun"("startedAt");

-- CreateIndex
CREATE INDEX "EnrichmentJob_businessId_family_idx" ON "EnrichmentJob"("businessId", "family");

-- CreateIndex
CREATE INDEX "EnrichmentJob_status_idx" ON "EnrichmentJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyWallet_agencyId_key" ON "AgencyWallet"("agencyId");

-- CreateIndex
CREATE INDEX "CreditLedger_agencyId_createdAt_idx" ON "CreditLedger"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Discovery_idempotencyKey_key" ON "Discovery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Discovery_agencyId_createdAt_idx" ON "Discovery"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Discovery_agencyId_researchStatus_idx" ON "Discovery"("agencyId", "researchStatus");

-- CreateIndex
CREATE INDEX "Discovery_status_idx" ON "Discovery"("status");

-- CreateIndex
CREATE INDEX "DiscoveryCell_trackedLocationId_idx" ON "DiscoveryCell"("trackedLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCell_discoveryId_trackedLocationId_key" ON "DiscoveryCell"("discoveryId", "trackedLocationId");

-- CreateIndex
CREATE INDEX "CellSnapshot_trackedLocationId_capturedAt_idx" ON "CellSnapshot"("trackedLocationId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "Contact_businessId_channel_idx" ON "Contact"("businessId", "channel");

-- CreateIndex
CREATE INDEX "Contact_channel_verifiedStatus_idx" ON "Contact"("channel", "verifiedStatus");

-- CreateIndex
CREATE INDEX "Contact_businessId_isPrimary_idx" ON "Contact"("businessId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_businessId_channel_normalizedValue_key" ON "Contact"("businessId", "channel", "normalizedValue");

-- CreateIndex
CREATE INDEX "ReviewJob_status_idx" ON "ReviewJob"("status");

-- CreateIndex
CREATE INDEX "ReviewJob_businessId_idx" ON "ReviewJob"("businessId");

-- CreateIndex
CREATE INDEX "BusinessTech_businessId_category_idx" ON "BusinessTech"("businessId", "category");

-- CreateIndex
CREATE INDEX "BusinessTech_name_idx" ON "BusinessTech"("name");

-- CreateIndex
CREATE INDEX "AdMarketRun_cellKey_platform_ranAt_idx" ON "AdMarketRun"("cellKey", "platform", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "ServiceTaxonomy_categorySlug_status_idx" ON "ServiceTaxonomy"("categorySlug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTaxonomy_categorySlug_canonicalKey_key" ON "ServiceTaxonomy"("categorySlug", "canonicalKey");

-- CreateIndex
CREATE INDEX "CellServicePrevalence_cellKey_rank_idx" ON "CellServicePrevalence"("cellKey", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "CellServicePrevalence_cellKey_canonicalKey_key" ON "CellServicePrevalence"("cellKey", "canonicalKey");

-- CreateIndex
CREATE INDEX "LighthouseOpportunity_businessId_bucket_idx" ON "LighthouseOpportunity"("businessId", "bucket");

-- CreateIndex
CREATE INDEX "LighthouseOpportunity_auditKey_idx" ON "LighthouseOpportunity"("auditKey");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryProfile_categorySlug_version_key" ON "CategoryProfile"("categorySlug", "version");

-- CreateIndex
CREATE INDEX "BusinessLicense_businessId_idx" ON "BusinessLicense"("businessId");

-- CreateIndex
CREATE INDEX "PlaybookFinding_playbookId_signalKey_confidence_idx" ON "PlaybookFinding"("playbookId", "signalKey", "confidence");

-- CreateIndex
CREATE INDEX "PlaybookFinding_businessId_status_idx" ON "PlaybookFinding"("businessId", "status");

-- CreateIndex
CREATE INDEX "PlaybookFinding_signalKey_feedback_idx" ON "PlaybookFinding"("signalKey", "feedback");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookFinding_businessId_signalKey_key" ON "PlaybookFinding"("businessId", "signalKey");

-- CreateIndex
CREATE INDEX "Campaign_agencyId_idx" ON "Campaign"("agencyId");

-- CreateIndex
CREATE INDEX "CampaignPainPoint_campaignId_idx" ON "CampaignPainPoint"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTemplate_slug_key" ON "StrategyTemplate"("slug");

-- CreateIndex
CREATE INDEX "ResearchPlan_campaignId_idx" ON "ResearchPlan"("campaignId");

-- CreateIndex
CREATE INDEX "OutreachDraft_campaignId_idx" ON "OutreachDraft"("campaignId");

-- CreateIndex
CREATE INDEX "OutreachDraft_businessId_idx" ON "OutreachDraft"("businessId");

-- CreateIndex
CREATE INDEX "OutreachEvent_draftId_type_idx" ON "OutreachEvent"("draftId", "type");

-- CreateIndex
CREATE INDEX "OutreachEvent_leadId_type_idx" ON "OutreachEvent"("leadId", "type");

-- CreateIndex
CREATE INDEX "PitchIntent_agencyId_idx" ON "PitchIntent"("agencyId");

-- CreateIndex
CREATE INDEX "LocationSelection_ownerId_idx" ON "LocationSelection"("ownerId");

-- CreateIndex
CREATE INDEX "Business_openStatus_idx" ON "Business"("openStatus");

-- CreateIndex
CREATE INDEX "Business_metroSlug_idx" ON "Business"("metroSlug");

-- CreateIndex
CREATE INDEX "Business_cellKey_idx" ON "Business"("cellKey");

-- CreateIndex
CREATE INDEX "Business_isHidden_idx" ON "Business"("isHidden");

-- CreateIndex
CREATE INDEX "BusinessService_businessId_canonicalKey_idx" ON "BusinessService"("businessId", "canonicalKey");

-- CreateIndex
CREATE INDEX "BusinessService_canonicalKey_idx" ON "BusinessService"("canonicalKey");

-- CreateIndex
CREATE INDEX "CellMetric_metroSlug_idx" ON "CellMetric"("metroSlug");

-- CreateIndex
CREATE INDEX "List_discoveryId_idx" ON "List"("discoveryId");

-- CreateIndex
CREATE INDEX "TrackedLocation_metroSlug_idx" ON "TrackedLocation"("metroSlug");

-- CreateIndex
CREATE INDEX "TrackedLocation_nextStaleAt_idx" ON "TrackedLocation"("nextStaleAt");

