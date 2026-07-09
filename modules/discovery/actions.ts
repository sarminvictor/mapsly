"use server";

/**
 * Discovery server actions (Phase 2).
 *
 * Two actions, both auth-gated + Zod-validated per `.claude/rules/security.md`:
 *
 *   - preflightDiscoveryAction · prices the requested cells (fresh-vs-refetch +
 *     pre-flight cost) and mints a CostEstimate. Pure read + a quote row; no
 *     external API.
 *   - runDiscoveryAction · ENQUEUES the run by creating a PENDING Discovery row
 *     and returns its id. The heavy `mapsSearch` work runs in
 *     /api/internal/run-discovery (cron context), NOT here — so the "no live
 *     API in user request path" invariant holds
 *     (.claude/rules/cost-discipline.md).
 *
 * The caller (or a follow-on worker dispatch) hits the internal route with the
 * Discovery id to execute it.
 */

import { z } from "zod";

import { after } from "next/server";
import { headers } from "next/headers";

import { cellKey as makeCellKey, cellFreshnessState } from "@/lib/cell";
import { auth } from "@/lib/auth";
import { metroBySlug } from "@/lib/geo/resolve-metro";
import prisma, { Prisma } from "@/lib/prisma";
import {
  ACTION_ENQUEUE_LIMIT,
  ACTION_MUTATE_LIMIT,
  DISCOVERY_RUN_IP_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { discoveryPhaseWhere } from "@/modules/discovery/discovery-phase-match";
import { parseDiscoverySignals } from "@/modules/agency-portal/discover/discovery-signals";
import {
  createCostEstimate,
  authorizeEstimate,
  holdCredits,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import {
  decideDiscoveryPlan,
  effectiveLastDiscoveredAt,
} from "@/modules/discovery/freshness-decision";
import { discoveryIdempotencyKey } from "@/modules/discovery/run-discovery";
import { kickDispatch } from "@/modules/enrichment/kick-dispatch";
import { requireSpendMember } from "@/modules/agency-portal/roles";
import {
  isPaidAgency,
  monthlyMapCapFor,
} from "@/modules/agency-portal/team/seats";
import { entitlementBillingEnabled } from "@/modules/cost/flags";

const CellInput = z.object({
  categorySlug: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(64),
  metroSlug: z.string().min(1).max(120),
  country: z.string().min(2).max(3).optional(),
});

// B4 · the user-facing discovery cap. Mirrors MarketStep.tsx's MAX_MARKETS = 3
// so the server can't be driven past what the UI allows. Discovery is free to
// the agency but costs US ~$0.04–0.93 of DfS per never-seen cell, so a
// hand-rolled caller sending 50 cells was a ~$46/enqueue free-vendor-spend hole.
const MAX_DISCOVERY_CELLS = 3;

// Review Part B2 · HARD monthly market cap (was a WARN-only soft ceiling). The
// per-plan map-depth cap (run-discovery.ts · discoveryDepthCapFor: Free/Starter
// ≤500 rows ≈ $0.20/market, Solo+ ≤3,000 ≈ $1.20) bounds cost PER map; this
// bounds the COUNT of cost-incurring maps per calendar month and now BLOCKS the
// enqueue at/over the plan ceiling (seats.ts · monthlyMapCapFor) instead of only
// logging. Anti-abuse ceiling, not a revenue match — normal agencies map a
// handful of markets/month and never approach it.

/**
 * Count the agency's cost-incurring Discovery rows so far this calendar month
 * (rows that actually spent DfS $). Best-effort direction: on a count error we
 * return 0 (never block a legit run on an infra hiccup — the depth cap + rate
 * limits remain as bounds). `now` is passed for month-boundary determinism.
 */
async function countCostIncurringMapsThisMonth(
  agencyId: string,
  now: Date,
): Promise<number> {
  try {
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return await prisma.discovery.count({
      where: {
        agencyId,
        createdAt: { gte: monthStart },
        totalCostUsd: { gt: 0 }, // only maps that actually spent DfS $
      },
    });
  } catch {
    return 0;
  }
}

/** Best-effort client IP from request headers (rate-limit keying only). */
async function requestIpKey(): Promise<string> {
  try {
    const h = await headers();
    const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
    const xri = h.get("x-real-ip");
    if (xri) return xri.trim();
  } catch {
    // headers() unavailable (test / non-request context) — fall through.
  }
  return "ip:unknown";
}

/**
 * Pre-flight listing-count estimate for a cell we've NEVER discovered and whose
 * size we can't yet know (no TrackedLocation anchor, no caller-supplied limit).
 *
 * This is ONLY a cost-estimate seed: after the real map runs, the count is
 * re-quoted server-side against DfS's actual `total_count`, so this figure never
 * caps the fetch and never reaches the UI as a market size. It's a defensible
 * midpoint for a typical local-market cell (worked cost examples span a few
 * hundred to ~1,442; the hard fetch ceiling is 3,000). Deliberately NOT 100 —
 * the old lowball under-held credits and seeded the stale "100 · whole market"
 * display bug on truncated cells.
 */
const UNKNOWN_MARKET_ESTIMATE_LISTINGS = 500;

/** The active goal signals, threaded from the journey so the run can persist
 *  them on `Discovery.signalsJson` for the workbench evaluator (P3). Only the
 *  SIG_META key + the user's tune/conds/match are carried; comparator/value/
 *  registryKey are re-derived from SIG_META at read time. Loosely validated
 *  (the eval layer guards every field again) but bounded for safety. */
const PersistedSignalInput = z.object({
  key: z.string().min(1).max(120),
  tune: z.unknown().optional(),
  conds: z.record(z.string(), z.boolean()).optional(),
  match: z.enum(["all", "any"]).optional(),
});

const DiscoveryInput = z.object({
  cells: z.array(CellInput).min(1).max(MAX_DISCOVERY_CELLS),
  limitPerCell: z.number().int().min(1).max(1000).optional(),
  /** Active goal signal registry keys — used to count "Match your signals"
   *  over the REAL businesses of in-DB cells (flagged PlaybookFindings). */
  signalKeys: z.array(z.string().min(1).max(120)).max(40).optional(),
  /** Active goal signals (SIG_META key + tune/conds/match) — persisted onto the
   *  Discovery so the workbench can evaluate each lead for a REAL match%. */
  signals: z.array(PersistedSignalInput).max(40).optional(),
  /** The goal's display name + base template key — persisted onto the Discovery
   *  (signalsJson) so "My research" can resume the flow with the real goal. */
  goalName: z.string().min(1).max(120).optional(),
  goalBase: z.string().min(1).max(64).optional(),
});

export type DiscoveryActionInput = z.input<typeof DiscoveryInput>;

/** Per-cell preview row: REAL business count for in-DB cells, unknown else. */
export interface PreviewCell {
  cellKey: string;
  /** UI freshness chip state (never / fresh / aging / stale). */
  freshness: "never" | "fresh" | "aging" | "stale";
  /** Businesses in this cell — REAL Prisma count; 0 when neverDiscovered. */
  existingBizCount: number;
  /** Businesses in this cell WITH a website — the enrichable subset for
   *  website-dependent researches. REAL count; 0 when neverDiscovered. Drives
   *  the per-cell Enrich column so its cost reflects only leads we can enrich. */
  websiteBizCount: number;
  /** True when this cell has never been discovered — its business count is
   *  genuinely UNKNOWN (never a guessed number; the UI shows "—" until the
   *  real Discover step reveals it). Renamed from the old `isEstimate` to make
   *  the honesty contract explicit: this flags "unknown", never "estimated". */
  neverDiscovered: boolean;
}

/** Aggregate KPI inputs for the Preview cards. All figures are REAL counts
 *  from already-discovered (in-DB) cells only — never a guessed number for a
 *  never-discovered cell. When `hasUnknownCells` is true, the UI notes that
 *  more markets exist whose real counts aren't known yet (not zero, unknown). */
export interface PreviewKpis {
  /** REAL businesses summed across in-DB cells (what we actually mapped —
   *  capped at 3,000/cell). */
  localBusinessesReal: number;
  /** DfS-reported real market size across the in-DB cells (`total_count`).
   *  `null` when unknown (never discovered, or discovered before we captured
   *  it, or mixed). When it exceeds `localBusinessesReal` the market was capped
   *  and the UI says "top N of ~M" instead of "the whole market". */
  totalAvailableReal: number | null;
  /** REAL businesses with a reachable contact channel (in-DB cells). */
  haveContactsReal: number;
  /** REAL businesses with a website on the Google/Maps listing (in-DB cells).
   *  Known at discovery ($0) — drives the "Have a website" KPI. */
  haveWebsiteReal: number;
  /** REAL "active on Google" businesses (in-DB cells). */
  activeOnGoogleReal: number;
  /** REAL businesses with a flagged finding for an active signal (in-DB cells).
   *  Populated only once enrichment has run — 0 pre-enrichment. */
  matchSignalsReal: number;
  /** "~N passing so-far": businesses passing the signals evaluable at
   *  discovery time (website/open/phone — see discovery-phase-match.ts). An
   *  honest upper bound shown as "~N" before enrichment. `null` when NONE of
   *  the active signals is discovery-evaluable (UI shows "computed after
   *  enrichment" instead of a fabricated number). */
  matchSoFarReal: number | null;
  /** True when any requested cell has never been discovered (drives the
   *  "+ N more markets, not yet mapped" note instead of a fake number). */
  hasUnknownCells: boolean;
}

export type PreflightDiscoveryResult =
  | {
      status: "ok";
      estimateId: string;
      netUsd: string;
      netCredits: number;
      freshCount: number;
      refetchCount: number;
      /** Per-cell preview rows (real where the cell is already in the DB). */
      cells: PreviewCell[];
      /** Aggregate KPI inputs (real from in-DB cells + estimate from new). */
      kpis: PreviewKpis;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

/** The run action takes ONLY the estimateId — the cell scope is reconstructed
 *  from the AUTHORIZED estimate server-side (anti-tamper). */
const RunDiscoveryInput = z.object({
  estimateId: z.string().min(1).max(64),
});

export type RunDiscoveryActionResult =
  | { status: "ok"; discoveryId: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "needs_requote"; netUsd: number; netCredits: number }
  | { status: "quote_expired" }
  | { status: "insufficient_credits"; netCredits: number }
  | { status: "market_locked" }
  | { status: "market_quota"; cap: number }
  | { status: "error" };

async function callerAgencyId(userId: string): Promise<string | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  return member?.agencyId ?? null;
}

/** "Active on Google" recency window (~6 months), mirrors getDiscoverySummary. */
const ACTIVE_REVIEW_DAYS = 182;

/**
 * Build the per-cell preview rows + aggregate KPIs. For each requested cell:
 *   - already in the DB (has businesses) → REAL Prisma counts, neverDiscovered=false
 *   - never discovered                   → count is genuinely UNKNOWN, existingBizCount=0,
 *                                           neverDiscovered=true (never a guessed number)
 *
 * Aggregate KPIs come ONLY from the REAL businesses of in-DB cells — no fake
 * contribution from never-discovered cells. "Match your signals" counts in-DB
 * businesses with a flagged PlaybookFinding for one of the active signal keys
 * (reuses the same finding store the signals view reads). All pure Prisma
 * reads — no external API in the request path.
 */
async function buildPreview(
  cells: {
    cellKey: string;
    lastDiscoveredAt: Date | null;
    /** DfS-reported real market size for this cell (null = unknown). */
    lastTotalAvailable?: number | null;
  }[],
  signalKeys: string[],
  now: Date,
): Promise<{ previewCells: PreviewCell[]; kpis: PreviewKpis }> {
  const previewCells = await Promise.all(
    cells.map(async (c) => {
      const base = rawListWhere({ cellKeys: [c.cellKey] });
      const [real, web] = await prisma.$transaction([
        prisma.business.count({ where: base }),
        prisma.business.count({ where: { ...base, website: { not: null } } }),
      ]);
      const inDb = real > 0;
      return {
        cellKey: c.cellKey,
        freshness: cellFreshnessState(c.lastDiscoveredAt, now),
        existingBizCount: inDb ? real : 0,
        websiteBizCount: inDb ? web : 0,
        neverDiscovered: !inDb,
        _base: base,
      };
    }),
  );

  // The in-DB cells we count real KPIs over.
  const inDbKeys = previewCells
    .filter((c) => !c.neverDiscovered)
    .map((c) => c.cellKey);

  let haveContactsReal = 0;
  let haveWebsiteReal = 0;
  let activeOnGoogleReal = 0;
  let matchSignalsReal = 0;
  let matchSoFarReal: number | null = null;
  let localBusinessesReal = 0;

  if (inDbKeys.length > 0) {
    const base = rawListWhere({ cellKeys: inDbKeys });
    const activeSince = new Date(Date.now() - ACTIVE_REVIEW_DAYS * 86_400_000);

    const businessIds = await prisma.business.findMany({
      where: base,
      select: { id: true },
    });
    const idSet = businessIds.map((b) => b.id);
    localBusinessesReal = idSet.length;

    // The discovery-evaluable signal subset → a cheap "~N passing so-far"
    // count. `null` when no active signal is discovery-evaluable (UI shows
    // "computed after enrichment"). Computed via a WHERE fragment ANDed with
    // the cell scope — one count, no per-business hydration.
    const dpWhere = discoveryPhaseWhere(signalKeys);

    const [contacts, website, active, matchSoFar] = await prisma.$transaction([
      prisma.business.count({
        where: { ...base, reachableChannelCount: { gt: 0 } },
      }),
      prisma.business.count({
        where: { ...base, website: { not: null } },
      }),
      prisma.business.count({
        where: {
          ...base,
          OR: [{ lastReviewAt: { gte: activeSince } }, { openStatus: "OPEN" }],
        },
      }),
      dpWhere
        ? prisma.business.count({ where: { ...base, ...dpWhere } })
        : prisma.business.count({ where: { id: "__never__" } }),
    ]);
    haveContactsReal = contacts;
    haveWebsiteReal = website;
    activeOnGoogleReal = active;
    matchSoFarReal = dpWhere ? matchSoFar : null;

    // "Match your signals" (exact, post-enrichment) = distinct businesses with a
    // flagged finding for one of the active signal keys. Counted via the same
    // store the signals view reads (PlaybookFinding status="flagged"). This is
    // 0 until enrichment runs — the UI falls back to matchSoFarReal ("~N") then.
    if (signalKeys.length > 0 && idSet.length > 0) {
      const flagged = await prisma.playbookFinding.findMany({
        where: {
          businessId: { in: idSet },
          status: "flagged",
          signalKey: { in: signalKeys },
        },
        select: { businessId: true },
        distinct: ["businessId"],
      });
      matchSignalsReal = flagged.length;
    }
  }

  // Real DfS market size across the in-DB cells — the anchor for the honest
  // "whole market" vs "top N of ~M" label. Null when ANY in-DB cell lacks a
  // captured total (summing partial data would understate the market, so the UI
  // shows a neutral "found in this market" instead of a wrong number).
  const inDbSet = new Set(inDbKeys);
  const inDbTotals = cells
    .filter((c) => inDbSet.has(c.cellKey))
    .map((c) => c.lastTotalAvailable ?? null);
  const totalAvailableReal =
    inDbTotals.length > 0 && inDbTotals.every((t) => t != null)
      ? inDbTotals.reduce((sum: number, t) => sum + (t as number), 0)
      : null;

  const kpis: PreviewKpis = {
    localBusinessesReal,
    totalAvailableReal,
    haveContactsReal,
    haveWebsiteReal,
    activeOnGoogleReal,
    matchSignalsReal,
    matchSoFarReal,
    hasUnknownCells: previewCells.some((c) => c.neverDiscovered),
  };

  // Strip the internal `_base` field from the returned rows.
  const cleaned: PreviewCell[] = previewCells.map((c) => ({
    cellKey: c.cellKey,
    freshness: c.freshness,
    existingBizCount: c.existingBizCount,
    websiteBizCount: c.websiteBizCount,
    neverDiscovered: c.neverDiscovered,
  }));

  return { previewCells: cleaned, kpis };
}

/**
 * Price a discovery request and mint a CostEstimate. The estimator line inputs
 * are stored in scopeRefsJson so authorizeEstimate can re-quote server-side.
 */
export async function preflightDiscoveryAction(
  input: unknown,
): Promise<PreflightDiscoveryResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // B4 · the preflight mints a CostEstimate row + runs per-cell DB counts on
  // every call (fires on each market/filter change). It was UNBOUNDED — a
  // per-user cap blunts CostEstimate-row / DB-count amplification. Bursty by
  // design (debounced filter tweaks), so the generous mutate window, not the
  // tight enqueue one.
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "error" };

  const parsed = DiscoveryInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyId = await callerAgencyId(session.user.id);
    if (!agencyId) return { status: "forbidden" };

    const now = new Date();
    const cellKeys = parsed.data.cells.map((c) =>
      makeCellKey(
        c.categorySlug,
        c.metroSlug,
        (c.country ?? "US").toUpperCase(),
      ),
    );

    // Pull each cell's freshness anchor from its TrackedLocation (if any).
    const planInputs = await Promise.all(
      parsed.data.cells.map(async (c, i) => {
        const metro = metroBySlug(c.metroSlug);
        const tracked = metro
          ? await prisma.trackedLocation.findFirst({
              where: {
                categoryId: c.categoryId,
                city: metro.name,
                province: null,
                country: (c.country ?? "US").toUpperCase(),
              },
              select: { lastDiscoveredAt: true, lastTotalAvailable: true },
            })
          : null;
        // A "fresh" anchor with ZERO businesses behind it is stale/orphaned
        // (businesses deleted, TrackedLocation survived). effectiveLastDiscoveredAt
        // treats it as never-discovered so the plan prices + schedules a REAL
        // refetch instead of a $0 "served from DB" of an empty cell — matching
        // runOneCell and buildPreview's neverDiscovered.
        const bizCount = await prisma.business.count({
          where: { cellKey: cellKeys[i] },
        });
        return {
          cellKey: cellKeys[i],
          lastDiscoveredAt: effectiveLastDiscoveredAt(
            tracked?.lastDiscoveredAt ?? null,
            bizCount,
          ),
          expectedListings:
            tracked?.lastTotalAvailable ??
            parsed.data.limitPerCell ??
            UNKNOWN_MARKET_ESTIMATE_LISTINGS,
          // The REAL DfS-reported market size (total_count) — distinct from the
          // estimate fallback above. `null` when we've never discovered the cell
          // (or discovered it before we captured total_count). Drives the honest
          // "whole market" vs "top N of ~M" label on Preview.
          lastTotalAvailable: tracked?.lastTotalAvailable ?? null,
        };
      }),
    );

    const plan = decideDiscoveryPlan(planInputs, now);

    // The discovery cost is one cell-priced line ("serp"-style is per-cell, but
    // Maps discovery has its own model in estimateDiscovery). We carry the
    // per-cell discovery estimate through scopeRefs for the re-quote, and use
    // the plan.estimate numbers directly on the CostEstimate row via a single
    // synthesized "meta_ads"-shaped cell line is NOT correct — instead we store
    // the discovery cells and persist the plan estimate verbatim. The
    // CostEstimate row carries net/credits already computed by the plan.
    const { estimate } = await createCostEstimate(
      {
        agencyId,
        userId: session.user.id,
        scopeKind: "discovery",
        enrichments: [],
        // The `signals` carry the goal's tune (typed `unknown` at the Zod
        // boundary), so the literal isn't statically an InputJsonValue; cast at
        // the seam like the other JSON scope payloads (cf. enrichmentsJson).
        scopeRefs: {
          kind: "discovery",
          cells: planInputs,
          lines: [],
          planNetUsd: plan.estimate.netUsd,
          planNetCredits: plan.estimate.netCredits,
          // Whether this run will actually fetch (never-seen/stale cells) and
          // thus cost US DfS $ — drives the monthly cost-incurring map cap at
          // enqueue (a $0 all-fresh re-open never counts against the ceiling).
          costIncurring: plan.refetchCount > 0,
          // Carry the active goal signals through the authorized estimate so the
          // run (which only gets the estimateId, anti-tamper) can persist them
          // onto Discovery.signalsJson for the workbench evaluator (P3). Extra
          // scopeRefs keys are ignored by the discovery re-quote (it reads only
          // `cells`), so this is safe alongside the anti-tamper path.
          signals: parsed.data.signals ?? [],
          // The goal identity — persisted onto signalsJson so "My research" can
          // resume the flow with the real goal name/template (not "Custom").
          goalName: parsed.data.goalName ?? null,
          goalBase: parsed.data.goalBase ?? null,
        } as unknown as Prisma.InputJsonValue,
        lines: [],
        freshnessAsOf: now,
      },
      now,
    );

    // Overwrite the empty-line estimate with the discovery plan's numbers so
    // the quote reflects per-cell Maps cost (estimateRun over [] yields $0).
    await prisma.costEstimate.update({
      where: { id: estimate.id },
      data: {
        grossUsd: plan.estimate.grossUsd,
        freshHitUsd: plan.estimate.freshHitUsd,
        netUsd: plan.estimate.netUsd,
        netCredits: plan.estimate.netCredits,
      },
    });

    // ── REAL per-cell counts (for cells already in the DB) + KPI aggregation ──
    // A cell's businesses are shared market data keyed by cellKey (exactly what
    // the raw-list + signals views count); the agency scope is the Discovery row
    // (validated above). For a cell already in the DB we COUNT for real; for a
    // never-discovered cell the count is genuinely unknown (neverDiscovered=true).
    const { previewCells, kpis } = await buildPreview(
      planInputs,
      parsed.data.signalKeys ?? [],
      now,
    );

    return {
      status: "ok",
      estimateId: estimate.id,
      netUsd: plan.estimate.netUsd.toFixed(4),
      netCredits: plan.estimate.netCredits,
      freshCount: plan.freshCount,
      refetchCount: plan.refetchCount,
      cells: previewCells,
      kpis,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.preflight.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/**
 * Enqueue a discovery run from an authorized estimate. Authorizes the quote
 * (server re-quote + gate), creates/updates a PENDING Discovery (idempotent by
 * sorted cellKeys + requester), holds the credits, and marks the estimate
 * CONSUMED. The dispatch cron executes maps-search + settles the hold against
 * the actual fetch cost (fresh cells refund to $0).
 *
 * Spend gate (WP5-8): when the authorized quote holds credits (stale/undiscovered
 * cells cost real money), the caller must be OWNER/ADMIN — a STAFF seat can never
 * spend the pooled wallet via a discovery run. A $0 all-fresh re-open holds
 * nothing and stays open to STAFF (a free read of an already-mapped market).
 */
export async function runDiscoveryAction(
  input: unknown,
): Promise<RunDiscoveryActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound discovery-run creation floods per user.
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  // B4 · additional per-IP cap — discovery is free to the agency but costs US
  // DfS $ per never-seen cell, and any STAFF seat can trigger it. Blunts
  // account-rotation farming behind one IP (orthogonal to the per-user cap).
  const ipRl = await rateLimitAction(
    DISCOVERY_RUN_IP_LIMIT,
    await requestIpKey(),
  );
  if (ipRl.limited) {
    return { status: "rate_limited", retryAfter: ipRl.retryAfter };
  }

  const parsed = RunDiscoveryInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyId = await callerAgencyId(session.user.id);
    if (!agencyId) return { status: "forbidden" };

    // Agency billing state — used by BOTH the free-market lock and the monthly
    // cost-incurring map cap below. One read.
    const agencyRow = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { plan: true, stripeStatus: true },
    });

    // FT-2 · free tier can't open brand-new markets (Target) — it uses "Search
    // everywhere" over our existing index instead. Server-side lock (the client
    // tab-hide is UX only). Flag-gated so today's free "unlimited discovery" is
    // unaffected until the entitlement model + search-everywhere ship together.
    if (entitlementBillingEnabled()) {
      if (!isPaidAgency(agencyRow?.stripeStatus ?? null)) {
        return { status: "market_locked" };
      }
    }

    await grantFreeTierIfNew(agencyId);

    const authz = await authorizeEstimate(
      parsed.data.estimateId,
      session.user.id,
    );
    switch (authz.status) {
      case "not_found":
        return { status: "invalid_input", message: "estimate not found" };
      case "forbidden":
        return { status: "forbidden" };
      case "expired":
        return { status: "quote_expired" };
      case "already_consumed":
        return { status: "invalid_input", message: "estimate already used" };
      case "needs_requote":
        return {
          status: "needs_requote",
          netUsd: authz.result.netUsd,
          netCredits: authz.result.netCredits,
        };
    }
    const result = authz.result;
    // WP1-11 (Viktor exception): no approval gate. The wallet balance remains
    // the sole spend gate.
    //
    // WP5-8 · spend gate (docs/seat-model.md): a discovery over stale/undiscovered
    // cells prices > 0 and holds pooled credits, so THAT path is OWNER/ADMIN only
    // (mirrors runEnrichAction, touch generation, polish + checkout). But a $0
    // re-open of an already-mapped market (all cells fresh → no hold) is a free
    // read — STAFF must stay able to re-open their team's mapped markets. So we
    // gate PRECISELY on whether this authorized quote actually holds credits: the
    // net is known here (authz "ok"), before the hold below. Keep the existing
    // insufficient_credits/error shapes untouched.
    if (result.netCredits > 0) {
      const spender = await requireSpendMember(session.user.id);
      if (!spender) return { status: "forbidden" };
    }

    // Reconstruct cell scope from the AUTHORIZED estimate (anti-tamper).
    const est = await prisma.costEstimate.findUnique({
      where: { id: parsed.data.estimateId },
      select: { scopeRefsJson: true },
    });
    const scope = (est?.scopeRefsJson ?? {}) as {
      cells?: { cellKey?: string }[];
      costIncurring?: boolean;
      signals?: unknown;
      goalName?: string | null;
      goalBase?: string | null;
    };
    const cellKeys = (scope.cells ?? [])
      .map((c) => c.cellKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    if (cellKeys.length === 0) {
      return { status: "invalid_input", message: "estimate has no cells" };
    }

    // Review Part B2 · monthly cap on COST-INCURRING maps. A $0 all-fresh
    // re-open (costIncurring false) never counts and is never blocked; only a
    // run that will actually fetch never-seen/stale cells is gated. Anti-abuse
    // ceiling per plan (seats.ts · monthlyMapCapFor) — normal use never nears it.
    // The counter reads SETTLED maps (totalCostUsd>0, set by the async dispatch),
    // so a burst enqueued before settlement can transiently overshoot the cap;
    // that residual is bounded by the enqueue (10/min/user) + IP + 3-cells/run
    // limits — the goal (kill the previously unbounded burn) holds either way.
    if (scope.costIncurring) {
      const cap = monthlyMapCapFor({
        plan: agencyRow?.plan ?? null,
        stripeStatus: agencyRow?.stripeStatus ?? null,
      });
      const used = await countCostIncurringMapsThisMonth(agencyId, new Date());
      if (used >= cap) {
        return { status: "market_quota", cap };
      }
    }

    // The active goal signals + goal identity carried through the estimate →
    // persisted onto the Discovery so the workbench evaluates each lead against
    // them (P3) AND "My research" can resume the flow with the real goal.
    // Parsed defensively. We persist whenever there ARE signals OR a goalName
    // (so the goal identity is stored even for a signal-less goal); an empty
    // payload stores null and the workbench falls back to the pain heuristic.
    const parsedSignals = parseDiscoverySignals({ signals: scope.signals });
    const goalName =
      typeof scope.goalName === "string" && scope.goalName.length > 0
        ? scope.goalName
        : undefined;
    const goalBase =
      typeof scope.goalBase === "string" && scope.goalBase.length > 0
        ? scope.goalBase
        : undefined;
    const hasSignals = !!parsedSignals && parsedSignals.signals.length > 0;
    const signalsJson: Prisma.InputJsonValue | undefined =
      hasSignals || goalName || goalBase
        ? ({
            signals: parsedSignals?.signals ?? [],
            ...(goalName ? { goalName } : {}),
            ...(goalBase ? { goalBase } : {}),
          } as unknown as Prisma.InputJsonValue)
        : undefined;

    const idempotencyKey = discoveryIdempotencyKey(cellKeys, session.user.id);

    const discovery = await prisma.discovery.upsert({
      where: { idempotencyKey },
      create: {
        agencyId,
        requestedByUserId: session.user.id,
        idempotencyKey,
        status: "PENDING",
        cellKeys,
        cellCount: cellKeys.length,
        ...(signalsJson ? { signalsJson } : {}),
      },
      // On an idempotent re-submit, refresh the persisted signals (the user may
      // have re-tuned between attempts); leave everything else untouched.
      update: signalsJson ? { signalsJson } : {},
      select: { id: true },
    });

    // Reserve credits (idempotent: skip if this discovery already has a hold,
    // e.g. an idempotent re-submit). A $0 (all-fresh) discovery needs no hold.
    if (result.netCredits > 0) {
      const existingHold = await prisma.creditLedger.findFirst({
        where: { runId: discovery.id, type: "HOLD" },
        select: { id: true },
      });
      if (!existingHold) {
        try {
          await holdCredits(
            agencyId,
            result.netCredits,
            discovery.id,
            result.netUsd,
          );
        } catch (err) {
          if (
            err instanceof WalletError &&
            err.code === "insufficient_credits"
          ) {
            await prisma.discovery
              .update({
                where: { id: discovery.id },
                data: { status: "FAILED" },
              })
              .catch(() => {});
            return {
              status: "insufficient_credits",
              netCredits: result.netCredits,
            };
          }
          throw err;
        }
      }
    }

    await prisma.costEstimate.update({
      where: { id: parsed.data.estimateId },
      data: { status: "CONSUMED", consumedByRunId: discovery.id },
    });

    // Kick the dispatch drain AFTER the response is sent so PENDING → RUNNING is
    // near-instant instead of waiting up to 2 min for the cron. Best-effort —
    // the */2 cron is the guaranteed fallback (see kickDispatch). Guarded:
    // `after()` throws outside a request scope (e.g. unit tests), and the kick
    // must never break the enqueue.
    try {
      after(() => kickDispatch());
    } catch {
      /* no request scope — the cron drains it */
    }

    return { status: "ok", discoveryId: discovery.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.enqueue.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// NOTE: do NOT re-export types from this "use server" file — Next's server-action
// transform mishandles `export type { ... }` re-exports and emits a runtime value
// reference (ReferenceError at module eval). Import RunDiscoverySummary directly
// from "@/modules/discovery/run-discovery" instead.
