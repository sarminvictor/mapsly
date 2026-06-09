/**
 * Cohort enrollment — turn indexed businesses into ColdRecipients.
 *
 * Eligibility for the cold MVP:
 *   - has a VERIFIED owner email (Business.email, kept fresh by the monthly cron)
 *   - has an active LandingPage (the report payload must exist → no broken links)
 *   - is in the campaign's country (US-first; CASL gate keeps CA out for now)
 *   - is not on the suppression list
 *   - is not already enrolled in this campaign (ColdRecipient @@unique guard)
 *
 * Each enroll also writes a ConsentRecord (conspicuous-publication basis) so the
 * CASL/CAN-SPAM defense file exists per contact.
 */
import prisma, { Prisma } from "@/lib/prisma";

export interface EnrollFilter {
  country?: string;
  category?: string;
  city?: string;
  limit: number;
}

export interface EnrollResult {
  candidates: number;
  enrolled: number;
  skipped: number;
}

function buildWhere(filter: EnrollFilter): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = {
    country: filter.country ?? "US",
    email: { not: null },
    landingPage: { is: { isActive: true } },
  };
  if (filter.category) where.category = filter.category;
  if (filter.city) where.city = filter.city;
  return where;
}

/** Count eligible candidates without enrolling (admin cohort preview). */
export async function previewCohort(filter: EnrollFilter): Promise<number> {
  return prisma.business.count({ where: buildWhere(filter) });
}

export async function enrollCohort(
  campaignId: string,
  filter: EnrollFilter,
): Promise<EnrollResult> {
  const country = filter.country ?? "US";
  const candidates = await prisma.business.findMany({
    where: buildWhere(filter),
    select: {
      id: true,
      email: true,
      website: true,
      landingPage: { select: { token: true, slug: true } },
    },
    take: filter.limit,
    orderBy: { id: "asc" },
  });

  const emails = candidates
    .map((c) => (c.email ?? "").toLowerCase())
    .filter(Boolean);
  const suppressed = new Set(
    (
      await prisma.coldSuppression.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      })
    ).map((s) => s.email),
  );

  const now = new Date();
  let enrolled = 0;
  let skipped = 0;

  for (const b of candidates) {
    const email = (b.email ?? "").toLowerCase();
    if (!email || suppressed.has(email) || !b.landingPage) {
      skipped++;
      continue;
    }
    const reportToken = `${b.landingPage.slug}-${b.landingPage.token}`;
    try {
      await prisma.coldRecipient.create({
        data: {
          campaignId,
          businessId: b.id,
          email,
          status: "PENDING",
          currentStep: 0,
          nextRunAt: now,
          reportToken,
          sends: {
            create: {
              stepOrder: 0,
              scheduledFor: now,
              idempotencyKey: `${campaignId}:${email}:0`,
            },
          },
        },
      });
      await prisma.consentRecord.create({
        data: {
          email,
          businessId: b.id,
          basis: "CONSPICUOUS_PUBLICATION",
          sourceUrl: b.website ?? undefined,
          relevanceNote:
            "Indexed local business; message concerns their public Google Business Profile.",
          country,
        },
      });
      enrolled++;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        skipped++; // already enrolled in this campaign
        continue;
      }
      throw err;
    }
  }

  return { candidates: candidates.length, enrolled, skipped };
}
