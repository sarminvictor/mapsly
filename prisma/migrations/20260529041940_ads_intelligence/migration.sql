-- AlterTable
ALTER TABLE "AdLibraryEntry" ADD COLUMN     "advertiserExternalId" TEXT,
ADD COLUMN     "advertiserName" TEXT,
ADD COLUMN     "collationCount" INTEGER,
ADD COLUMN     "ctaText" TEXT,
ADD COLUMN     "displayFormat" TEXT,
ADD COLUMN     "linkCaption" TEXT,
ADD COLUMN     "linkTitle" TEXT,
ADD COLUMN     "pageId" TEXT,
ADD COLUMN     "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "previewImageUrl" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "adsScanLastAt" TIMESTAMP(3),
ADD COLUMN     "fbPageId" TEXT;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "highTopOfPageBid" DOUBLE PRECISION,
ADD COLUMN     "lowTopOfPageBid" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "AdLibraryEntry_businessId_isActive_idx" ON "AdLibraryEntry"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "AdLibraryEntry_advertiserExternalId_idx" ON "AdLibraryEntry"("advertiserExternalId");

