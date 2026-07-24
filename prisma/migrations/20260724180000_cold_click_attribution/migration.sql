-- CreateTable
CREATE TABLE "ColdClick" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botReason" TEXT,
    "userAgent" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColdClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ColdClick_recipientId_clickedAt_idx" ON "ColdClick"("recipientId", "clickedAt");

-- CreateIndex
CREATE INDEX "ColdClick_shareToken_idx" ON "ColdClick"("shareToken");

-- CreateIndex
CREATE INDEX "ColdClick_isBot_clickedAt_idx" ON "ColdClick"("isBot", "clickedAt");

-- AddForeignKey
ALTER TABLE "ColdClick" ADD CONSTRAINT "ColdClick_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "ColdRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

