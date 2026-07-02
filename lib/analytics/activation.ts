// lib/analytics/activation.ts · WP6-4 · the ONE aggregate query the future
// activation dashboard reads. Pairs the server-side ProductEvent rows (WP0-8,
// written by lib/analytics/product-events.ts) into two honest measures:
//
//   1. time-to-aha — median minutes from an agency's FIRST activation event
//      (agency_created, else signup) to its FIRST first_lead_drawer_opened (the
//      evidence-reveal moment). Only agencies that reached the drawer count.
//   2. per-template conversion — for each research market that was mapped
//      (market_mapped), whether the SAME agency went on to commit spend
//      (enrich_started) within the window. Keyed by the goal/market props we
//      recorded, not by ML — a single GROUP BY.
//
// No external vendor (reads ProductEvent). Read-only, bounded windows, no PII
// (ids/counts only — enforced at the write site). This helper is the query
// contract; the dashboard route/card that renders it lands with the /dev
// surface — kept out of this WP to avoid touching the locked dashboard flow.

import prisma from "@/lib/prisma";

/** A single point in an agency's activation funnel (one ProductEvent). */
interface FunnelEvent {
  agencyId: string;
  type: string;
  createdAt: Date;
}

/** The aggregate the dashboard renders. All counts are agency-level. */
export interface ActivationSummary {
  /** Window analysed (days back from `now`). */
  windowDays: number;
  /** Agencies that fired ANY event in the window. */
  agenciesSeen: number;
  /** Agencies that reached the first-drawer aha. */
  agenciesActivated: number;
  /** Agencies that committed spend (enrich_started). */
  agenciesEnriched: number;
  /** Median minutes from first activation event → first drawer open. Null when
   *  no agency reached the drawer in the window. */
  timeToAhaMedianMin: number | null;
  /** Per-goal-template conversion: mapped a market → committed spend. */
  perTemplate: TemplateConversion[];
}

/** One goal/template's map→enrich conversion. */
export interface TemplateConversion {
  /** The template/goal key recorded on the event props (or "unknown"). */
  templateKey: string;
  /** Agencies that mapped a market under this template. */
  mapped: number;
  /** …of which committed spend afterwards. */
  enriched: number;
  /** enriched / mapped (0–1), 0 when mapped=0. */
  rate: number;
}

const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_MIN = 60_000;

/** Median of a numeric array (nearest-rank on the sorted values). Null empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid];
}

/**
 * Compute the activation summary over the trailing `windowDays`. One bounded
 * read of the relevant ProductEvent types, folded in-memory (the window caps
 * the row count; a full dashboard would page, but the funnel needs the whole
 * window to pair events per agency). Fail-soft: any error returns an empty
 * summary so a dashboard card never crashes the page.
 */
export async function getActivationSummary(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<ActivationSummary> {
  const empty: ActivationSummary = {
    windowDays,
    agenciesSeen: 0,
    agenciesActivated: 0,
    agenciesEnriched: 0,
    timeToAhaMedianMin: null,
    perTemplate: [],
  };
  try {
    const since = new Date(now.getTime() - windowDays * 86_400_000);
    const rows = await prisma.productEvent.findMany({
      where: {
        createdAt: { gte: since },
        agencyId: { not: null },
        type: {
          in: [
            "agency_created",
            "signup",
            "market_mapped",
            "first_lead_drawer_opened",
            "enrich_started",
          ],
        },
      },
      select: { agencyId: true, type: true, createdAt: true, propsJson: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    });

    // ── time-to-aha ──────────────────────────────────────────────────────────
    // First activation event (agency_created preferred, else signup) → first
    // drawer open, per agency.
    const firstActivation = new Map<string, Date>();
    const firstDrawer = new Map<string, Date>();
    const enrichedAgencies = new Set<string>();
    const seenAgencies = new Set<string>();

    const events: FunnelEvent[] = rows.map((r) => ({
      agencyId: r.agencyId as string,
      type: r.type,
      createdAt: r.createdAt,
    }));

    for (const e of events) {
      seenAgencies.add(e.agencyId);
      if (e.type === "agency_created" || e.type === "signup") {
        // agency_created wins over signup at the same or later time only if we
        // don't already hold an earlier activation anchor.
        const prior = firstActivation.get(e.agencyId);
        if (!prior || e.createdAt < prior) {
          firstActivation.set(e.agencyId, e.createdAt);
        }
      } else if (e.type === "first_lead_drawer_opened") {
        if (!firstDrawer.has(e.agencyId)) {
          firstDrawer.set(e.agencyId, e.createdAt);
        }
      } else if (e.type === "enrich_started") {
        enrichedAgencies.add(e.agencyId);
      }
    }

    const ahaMinutes: number[] = [];
    for (const [agencyId, drawerAt] of firstDrawer) {
      const startAt = firstActivation.get(agencyId);
      if (!startAt) continue; // no activation anchor in-window — skip (honest)
      const min = (drawerAt.getTime() - startAt.getTime()) / MS_PER_MIN;
      if (min >= 0) ahaMinutes.push(min);
    }
    const rawMedian = median(ahaMinutes);
    const timeToAhaMedianMin = rawMedian == null ? null : Math.round(rawMedian);

    // ── per-template conversion ────────────────────────────────────────────────
    // market_mapped carries the template/goal on props. An agency "converted"
    // that template when it fired enrich_started anywhere in the window (a
    // coarse but honest map→spend link; a per-discovery join would need the
    // discoveryId on both, which enrich_started doesn't carry).
    const mappedByTemplate = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.type !== "market_mapped") continue;
      const props = (r.propsJson ?? {}) as Record<string, unknown>;
      const key =
        typeof props.templateKey === "string"
          ? props.templateKey
          : typeof props.goal === "string"
            ? props.goal
            : "unknown";
      const set = mappedByTemplate.get(key) ?? new Set<string>();
      if (r.agencyId) set.add(r.agencyId);
      mappedByTemplate.set(key, set);
    }

    const perTemplate: TemplateConversion[] = [...mappedByTemplate.entries()]
      .map(([templateKey, agencies]) => {
        const mapped = agencies.size;
        let enriched = 0;
        for (const a of agencies) if (enrichedAgencies.has(a)) enriched += 1;
        return {
          templateKey,
          mapped,
          enriched,
          rate: mapped > 0 ? enriched / mapped : 0,
        };
      })
      .sort((a, b) => b.mapped - a.mapped);

    return {
      windowDays,
      agenciesSeen: seenAgencies.size,
      agenciesActivated: firstDrawer.size,
      agenciesEnriched: enrichedAgencies.size,
      timeToAhaMedianMin,
      perTemplate,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "activation.summary.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return empty;
  }
}
