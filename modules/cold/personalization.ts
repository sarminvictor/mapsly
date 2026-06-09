/**
 * Personalization tokens for cold copy — pulled from Mapsly's own signals.
 * All values are strings ("" when absent) so the template engine's {{#if}}
 * guards work. The killer cold hook is the recipient's OWN business data.
 */
import prisma from "@/lib/prisma";

export interface BuildTokensOptions {
  reportUrl: string;
  /** Sign-off name — matches the From display of the chosen mailbox. */
  senderName: string;
}

export async function buildTokens(
  businessId: string | null,
  opts: BuildTokensOptions,
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {
    reportUrl: opts.reportUrl,
    senderFirstName: opts.senderName,
    businessName: "there",
    city: "",
    rating: "",
    reviewCount: "",
    unansweredCount: "",
    unansweredOneStar: "",
  };
  if (!businessId) return tokens;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, city: true, rating: true, reviewCount: true },
  });
  if (business) {
    tokens.businessName = business.name;
    tokens.city = business.city ?? "";
    tokens.rating = business.rating != null ? business.rating.toFixed(1) : "";
    tokens.reviewCount =
      business.reviewCount != null ? String(business.reviewCount) : "";
  }

  const [unanswered, unansweredOne] = await Promise.all([
    prisma.review.count({ where: { businessId, ownerReplied: false } }),
    prisma.review.count({
      where: { businessId, ownerReplied: false, stars: { lte: 2 } },
    }),
  ]);
  tokens.unansweredCount = unanswered > 0 ? String(unanswered) : "";
  tokens.unansweredOneStar = unansweredOne > 0 ? String(unansweredOne) : "";

  return tokens;
}
