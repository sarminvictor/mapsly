/**
 * Cold-email suppression spine — the source of truth, checked before EVERY send.
 * Fed by unsubscribes, hard bounces, complaints, manual adds, and consent expiry.
 */
import prisma from "@/lib/prisma";

export type ColdSuppressionSource =
  | "UNSUBSCRIBE"
  | "BOUNCE_HARD"
  | "COMPLAINT"
  | "MANUAL"
  | "ROLE_BLOCK"
  | "UNDELIVERABLE"
  | "CASL_EXPIRED";

export async function isSuppressed(email: string): Promise<boolean> {
  const hit = await prisma.coldSuppression.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  return hit != null;
}

export async function suppress(
  email: string,
  source: ColdSuppressionSource,
  reason?: string,
): Promise<void> {
  const e = email.toLowerCase();
  await prisma.coldSuppression.upsert({
    where: { email: e },
    create: { email: e, source, reason },
    update: {}, // first suppression wins; keep original source/date
  });
}

export async function unsuppress(email: string): Promise<void> {
  await prisma.coldSuppression
    .delete({ where: { email: email.toLowerCase() } })
    .catch(() => {}); // tolerate not-present
}
