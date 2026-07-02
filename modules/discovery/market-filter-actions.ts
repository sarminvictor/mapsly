"use server";

/**
 * Pre-enrich market filter counts (WP5-4).
 *
 * The Preview step's free filter chips (min reviews / rating / has-website /
 * reachability) need a LIVE server-side count of the surviving set before Tom
 * commits credits — "enrich 180 of 412". This action counts the discovery's
 * market through the SAME `rawListWhere` the enrich preflight resolves its
 * scope with, so the number shown is exactly the set that would be priced.
 *
 * Auth-gated + Zod-validated per `.claude/rules/security.md`; agency-scoped via
 * the discovery (mirrors getDiscoverySummary). Pure Prisma counts — no external
 * API in the request path (`.claude/rules/cost-discipline.md`).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rawListWhere } from "@/modules/discovery/raw-list";
import {
  ALL_ENRICHMENT_TYPES,
  enrichmentNeedsWebsite,
  type EnrichmentType,
} from "@/modules/cost/pricing";

const EnrichmentEnum = z.enum(
  ALL_ENRICHMENT_TYPES as [EnrichmentType, ...EnrichmentType[]],
);

const Input = z.object({
  discoveryId: z.string().min(1).max(64),
  /** The free pre-enrich filters (mirrors RawListFilters). */
  filters: z
    .object({
      hasWebsite: z.boolean().optional(),
      minRating: z.number().min(0).max(5).optional(),
      minReviewCount: z.number().int().min(0).max(1_000_000).optional(),
      reachability: z
        .array(
          z.enum([
            "UNREACHABLE",
            "EMAIL_ONLY",
            "PHONE_ONLY",
            "MULTI",
            "RICH",
            "UNKNOWN",
          ]),
        )
        .max(6)
        .optional(),
    })
    .optional(),
  /**
   * The selected enrichment families — decides whether the ENRICHABLE count
   * additionally requires a website (site-reading families can't run without
   * one, mirroring the preflight's authoritative scope gate).
   */
  enrichments: z
    .array(EnrichmentEnum)
    .max(ALL_ENRICHMENT_TYPES.length)
    .optional(),
});

export type CountFilteredMarketInput = z.input<typeof Input>;

export type CountFilteredMarketResult =
  | {
      status: "ok";
      /** Businesses passing the filters (default-excluded view). */
      total: number;
      /** The subset the enrich run would actually price/queue (website gate
       *  applied when any selected family needs a live site). */
      enrichable: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function countFilteredMarketAction(
  input: unknown,
): Promise<CountFilteredMarketResult> {
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

    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { agencyId: true, cellKeys: true },
    });
    if (!discovery || discovery.agencyId !== member.agencyId) {
      return { status: "forbidden" };
    }

    const filters = parsed.data.filters ?? {};
    const needsWebsite = enrichmentNeedsWebsite(parsed.data.enrichments ?? []);

    const [total, enrichable] = await prisma.$transaction([
      prisma.business.count({
        where: rawListWhere({ cellKeys: discovery.cellKeys, filters }),
      }),
      prisma.business.count({
        where: rawListWhere({
          cellKeys: discovery.cellKeys,
          filters: needsWebsite ? { ...filters, hasWebsite: true } : filters,
        }),
      }),
    ]);

    return { status: "ok", total, enrichable };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "market.filter-count.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
