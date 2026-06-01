-- AlterTable
ALTER TABLE "AdMarketInsight" DROP COLUMN "observations",
DROP COLUMN "suggestions",
ADD COLUMN     "promos" JSONB NOT NULL,
ADD COLUMN     "serviceMix" JSONB NOT NULL;

