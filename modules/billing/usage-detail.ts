// modules/billing/usage-detail.ts · Phase 5 (billing repricing 2026-07-09).
//
// Enriches the "What" column of the usage table with the human context behind a
// credit movement — the market, the number of businesses, and what was run —
// by joining the CreditLedger.runId to its EnrichmentRun (families + unit
// counts + discovery) or Discovery (mapped market). Read-only, batched, and
// fully defensive: any failure returns an empty map so the usage table degrades
// to the plain type labels rather than breaking the billing page.

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { metroBySlug } from "@/lib/geo/resolve-metro";

/** Short human label per enrichment family for the usage detail line. */
const FAMILY_LABEL: Record<string, string> = {
  contacts: "contacts",
  tech: "site tech",
  services: "services",
  reviews: "reviews",
  lighthouse: "site speed",
  ai_research: "AI angle",
  google_ads: "ads",
  meta_ads: "ads",
  serp: "rankings",
};

/** Title-case a category slug (e.g. "medical_spa" → "Medical spa"). */
function prettyCategory(slug: string): string {
  const s = slug.replace(/_/g, " ").trim();
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : slug;
}

/** "Medical spa · Miami (+2 more)" from a cell-key list. Null when unparseable. */
function marketLabel(cellKeys: string[]): string | null {
  const first = cellKeys.map(parseCellKey).find((c) => c != null);
  if (!first) return null;
  const metro = metroBySlug(first.metroSlug);
  const metroName = metro?.name ?? first.metroSlug;
  const base = `${prettyCategory(first.categorySlug)} · ${metroName}`;
  return cellKeys.length > 1 ? `${base} (+${cellKeys.length - 1} more)` : base;
}

/** Dedup + join up to 3 family labels; "+N" past that. */
function familiesLabel(enrichmentsJson: unknown): string | null {
  const arr = Array.isArray(enrichmentsJson)
    ? (enrichmentsJson as unknown[])
    : [];
  const labels = Array.from(
    new Set(
      arr
        .map((f) => (typeof f === "string" ? FAMILY_LABEL[f] : undefined))
        .filter((v): v is string => Boolean(v)),
    ),
  );
  if (labels.length === 0) return null;
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 3).join(" + ")} +${labels.length - 3}`;
}

/**
 * Build a `runId → detail string` map for the given ledger runIds. Batches two
 * (or three) `findMany`s; never throws.
 */
export async function buildUsageDetails(
  runIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(
      runIds.filter((r): r is string => typeof r === "string" && r.length > 0),
    ),
  );
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  try {
    const [enrichRuns, directDiscos] = await Promise.all([
      prisma.enrichmentRun.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          enrichmentsJson: true,
          unitsRequested: true,
          unitsCompleted: true,
          discoveryId: true,
        },
      }),
      prisma.discovery.findMany({
        where: { id: { in: ids } },
        select: { id: true, cellKeys: true },
      }),
    ]);

    // Discovery rows behind the enrichment runs (for the market label).
    const enrichDiscoIds = Array.from(
      new Set(
        enrichRuns
          .map((r) => r.discoveryId)
          .filter((d): d is string => typeof d === "string" && d.length > 0),
      ),
    );
    const enrichDiscos =
      enrichDiscoIds.length > 0
        ? await prisma.discovery.findMany({
            where: { id: { in: enrichDiscoIds } },
            select: { id: true, cellKeys: true },
          })
        : [];

    const discoByIdCells = new Map<string, string[]>();
    for (const d of [...directDiscos, ...enrichDiscos]) {
      discoByIdCells.set(d.id, d.cellKeys);
    }

    // Enrichment runs → "{market} · {N} businesses · {families}".
    for (const r of enrichRuns) {
      const parts: string[] = [];
      const market = r.discoveryId
        ? marketLabel(discoByIdCells.get(r.discoveryId) ?? [])
        : null;
      if (market) parts.push(market);
      const n = r.unitsCompleted || r.unitsRequested;
      if (n > 0) parts.push(`${n.toLocaleString("en-US")} businesses`);
      const fam = familiesLabel(r.enrichmentsJson);
      if (fam) parts.push(fam);
      if (parts.length > 0) out.set(r.id, parts.join(" · "));
    }

    // Discovery runs (runId is a Discovery id directly) → "{market} · mapped".
    for (const d of directDiscos) {
      if (out.has(d.id)) continue; // an enrichment run already described it
      const market = marketLabel(d.cellKeys);
      out.set(d.id, market ? `${market} · mapped market` : "Mapped a market");
    }
  } catch {
    // Read-only enhancement — never break the billing page.
    return new Map();
  }

  return out;
}
