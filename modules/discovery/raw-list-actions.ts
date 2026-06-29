"use server";

/**
 * Raw-list server action (Phase 2/8 · read surface).
 *
 * The Raw List page server-renders the first page; this action powers
 * "Load more" (cursor pagination) and the "show hidden" toggle so the table
 * can browse the FULL market server-side instead of being capped at the first
 * 50 rows + filtering them client-side. Pure read (no external API), agency-
 * scoped via the caller's AgencyMember → the discovery's cells.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  getRawList,
  type RawListFilters,
  type ReachabilityFilter,
} from "@/modules/discovery/raw-list";

const REACHABILITY = [
  "UNREACHABLE",
  "EMAIL_ONLY",
  "PHONE_ONLY",
  "MULTI",
  "RICH",
  "UNKNOWN",
] as const;

const Input = z.object({
  discoveryId: z.string().min(1).max(64),
  cursor: z.string().min(1).max(64).optional(),
  includeHidden: z.boolean().optional(),
  filters: z
    .object({
      hasWebsite: z.boolean().optional(),
      minRating: z.number().min(0).max(5).optional(),
      minReviewCount: z.number().int().min(0).optional(),
      reachability: z.array(z.enum(REACHABILITY)).max(6).optional(),
      metroSlug: z.string().min(1).max(120).optional(),
    })
    .optional(),
});

export type FetchRawListActionInput = z.input<typeof Input>;

/** The plain row shape the client table consumes (matches RawListTableRow). */
export interface FetchedRawRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  province: string | null;
  metroSlug: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  phone: string | null;
  reachability: string | null;
  reachableChannelCount: number | null;
}

export type FetchRawListResult =
  | { status: "ok"; rows: FetchedRawRow[]; nextCursor: string | null }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function fetchRawListAction(
  input: unknown,
): Promise<FetchRawListResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    // Agency-scope: the discovery must belong to the caller's agency.
    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { agencyId: true, cellKeys: true },
    });
    if (!discovery || discovery.agencyId !== member.agencyId) {
      return { status: "forbidden" };
    }

    const filters = parsed.data.filters
      ? ({
          ...parsed.data.filters,
          reachability: parsed.data.filters.reachability as
            | ReachabilityFilter[]
            | undefined,
        } as RawListFilters)
      : undefined;

    const page = await getRawList(
      {
        cellKeys: discovery.cellKeys,
        includeHidden: parsed.data.includeHidden ?? false,
        filters,
      },
      { take: 50, cursor: parsed.data.cursor },
    );

    return {
      status: "ok",
      rows: page.rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        city: r.city,
        province: r.province,
        metroSlug: r.metroSlug,
        rating: r.rating,
        reviewCount: r.reviewCount,
        website: r.website,
        phone: r.phone,
        reachability: r.reachability,
        reachableChannelCount: r.reachableChannelCount,
      })),
      nextCursor: page.nextCursor,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "raw-list.fetch.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
