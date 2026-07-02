-- WP5-8 · seat invites. Fully additive (one new table). Safe to deploy with
-- `prisma migrate deploy`. No data changes.
--
-- AgencyInvite carries the agencyId + role the NextAuth VerificationToken
-- can't: the invite email links to /signin?invite=<token>; /post-signin
-- resolves the token after the magic-link round-trip, enforces the seat cap,
-- and creates the AgencyMember on the inviting agency.

-- CreateTable
CREATE TABLE "AgencyInvite" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AgencyMemberRole" NOT NULL DEFAULT 'STAFF',
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyInvite_token_key" ON "AgencyInvite"("token");

-- CreateIndex
CREATE INDEX "AgencyInvite_agencyId_idx" ON "AgencyInvite"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyInvite_email_idx" ON "AgencyInvite"("email");

-- AddForeignKey
ALTER TABLE "AgencyInvite" ADD CONSTRAINT "AgencyInvite_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
