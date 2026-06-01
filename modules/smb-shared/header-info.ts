// modules/smb-shared/header-info.ts
//
// One tiny cached lookup that every /(smb) page uses for its <SmbPageHeader>:
// the owned business's name + clean website URL. Keeps name + website on every
// page header without plumbing `website` into each page's data type.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface SmbHeaderInfo {
  name: string;
  /** Clean website URL (params already stripped at ingest). Null if none. */
  websiteUrl: string | null;
}

export async function getSmbHeaderInfo(
  userId: string,
): Promise<SmbHeaderInfo | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-header-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  if (!userId || typeof userId !== "string") return null;

  try {
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, website: true },
    });
    if (!own) return null;
    return { name: own.name, websiteUrl: own.website ?? null };
  } catch {
    return null;
  }
}
