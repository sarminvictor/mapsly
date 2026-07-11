"use server";

/**
 * Enrichment server actions (Phase 9 · Raw List → Enrich).
 *
 * Two actions, both auth-gated + Zod-validated per `.claude/rules/security.md`:
 *
 *   - preflightEnrichAction · prices the selected enrichments over the selected
 *     businesses (per-business families) + cells (per-cell families), mints a
 *     CostEstimate, and returns the quote. Pure read + a quote row; no external
 *     API (`.claude/rules/cost-discipline.md`).
 *   - runEnrichAction · ENQUEUES the run by creating a PENDING EnrichmentRun and
 *     returns its id. The heavy work runs in the existing `/api/internal/*`
 *     worker routes (cron context), NOT here — so the "no live API in user
 *     request path" invariant holds.
 *
 * Fresh counts are real: every unit (business or cell) already enriched within
 * its family's `freshnessDays` window is deduped to $0 ("served from cache") via
 * `countFreshForRun` → `buildEnrichLines({ freshByEnrichment })`. See
 * `modules/discovery/enrich-fresh.ts` (pure math) + `enrich-fresh-db.ts` (reads).
 */

import { z } from "zod";

import { after } from "next/server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import {
  ACTION_ENQUEUE_LIMIT,
  ENRICH_RUN_IP_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { requireSpendMember } from "@/modules/agency-portal/roles";
import { rawListWhere } from "./raw-list";
import { kickDispatch } from "@/modules/enrichment/kick-dispatch";
import { markCronWork, GATED_CRON } from "@/lib/cron/idle-gate";
import { seedRunProgress } from "@/modules/enrichment/run-progress-counter";
import {
  createCostEstimate,
  authorizeEstimate,
  holdCredits,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import {
  ALL_ENRICHMENT_TYPES,
  enrichmentNeedsWebsite,
  ENRICHMENT_PRICES,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { buildEnrichLines } from "@/modules/discovery/enrich-lines";
import {
  jobFamilyForType,
  permanentlyUnavailablePairs,
} from "@/modules/enrichment/dispatch";
import { countFreshForRun } from "@/modules/discovery/enrich-fresh-db";
import { countFreeForRun } from "@/modules/discovery/entitlements";
import { entitlementBillingEnabled } from "@/modules/cost/flags";
import { trackProductEvent } from "@/lib/analytics/product-events";

// ── Input schema ──────────────────────────────────────────────────────────

const EnrichmentEnum = z.enum(
  ALL_ENRICHMENT_TYPES as [EnrichmentType, ...EnrichmentType[]],
);

/**
 * WP5-4 · free pre-enrich filters. Applied ONLY on the cellKeys-resolution path
 * (no explicit businessIds) — the resolved scope becomes the estimate's stored
 * businessIds, so the priced set, the held credits, and the fan-out are all the
 * SAME filtered subset. Explicit-ids callers already chose their rows, so
 * filters are ignored for them. Mirrors `RawListFilters` (raw-list.ts).
 */
const RawFiltersSchema = z.object({
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
});

const EnrichInput = z.object({
  /** The discovery this run belongs to — persisted on the run (Wave-3 FK) so
   *  run→discovery attribution never falls back to cellKeys-overlap guessing.
   *  Optional: legacy callers omit it; those runs resolve via the fallback. */
  discoveryId: z.string().min(1).max(64).optional(),
  /** Selected businesses (drives per-business families). Empty → cell-only. */
  businessIds: z.array(z.string().min(1).max(64)).max(5000).default([]),
  /** Cells the run spans (drives per-cell families). */
  cellKeys: z.array(z.string().min(1).max(160)).max(200).default([]),
  /** Enrichment families to run (at least one). */
  enrichments: z.array(EnrichmentEnum).min(1).max(ALL_ENRICHMENT_TYPES.length),
  /**
   * WP2-2 · wallet-capped "Enrich your best N". Caps the run to the top N
   * enrichable businesses, ordered by reviewCount desc (the workbench default
   * sort — review volume is the best free revenue proxy, so "best N" = the
   * leads Tom would open first anyway). Applied SERVER-SIDE: the sliced set
   * becomes the estimate's stored scope, so the priced set, the held credits,
   * and the fan-out are all the same authoritative subset — the client only
   * ever suggests N, never computes cost math.
   */
  topN: z.number().int().min(1).max(5000).optional(),
  /** WP5-4 · free pre-enrich filters (cell-resolution path only, see above). */
  filters: RawFiltersSchema.optional(),
});

export type EnrichActionInput = z.input<typeof EnrichInput>;

/**
 * The run action takes ONLY the estimateId. The scope (businesses, cells,
 * families) is reconstructed from the AUTHORIZED estimate server-side — a
 * tampered client can't enrich a larger/different set than was quoted.
 */
const RunEnrichInput = z.object({
  estimateId: z.string().min(1).max(64),
});

export type RunEnrichActionInput = z.input<typeof RunEnrichInput>;

// ── Result shapes ───────────────────────────────────────────────────────────

export interface EnrichQuoteLine {
  enrichment: EnrichmentType;
  label: string;
  unit: "business" | "cell";
  total: number;
  netUsd: number;
  upperBoundUsd: number;
}

export type PreflightEnrichResult =
  | {
      status: "ok";
      estimateId: string;
      netUsd: number;
      upperBoundUsd: number;
      freshHitUsd: number;
      netCredits: number;
      /** Credits saved by the fresh cache, in the CREDIT unit (not COGS). */
      freshCredits: number;
      // WP1-11: no "approval" gate — wallet balance is the only spend gate.
      gate: "auto" | "confirm";
      lines: EnrichQuoteLine[];
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export type RunEnrichResult =
  | { status: "ok"; runId: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "needs_requote"; netUsd: number; netCredits: number }
  | { status: "quote_expired" }
  | { status: "insufficient_credits"; netCredits: number }
  | { status: "error" };

async function callerAgencyId(userId: string): Promise<string | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  return member?.agencyId ?? null;
}

/**
 * Price an enrichment request and mint a CostEstimate. The estimator line
 * inputs are stored in scopeRefsJson so authorizeEstimate can re-quote
 * server-side (anti-tamper, per `.claude/rules/cost-discipline.md`).
 */
export async function preflightEnrichAction(
  input: unknown,
): Promise<PreflightEnrichResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound enqueue/estimate floods (spend-bearing, DB-heavy).
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = EnrichInput.safeParse(input);
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
    // "Enrich the market" passes cellKeys with no explicit businessIds —
    // resolve the cells' enrichable businesses here so the estimate, the stored
    // scope (re-quote on run), and the fan-out all price/enrich the SAME real
    // set. Without this the per-business cost was 0 → nothing billed or enriched.
    // Resolve via rawListWhere so the enriched set is EXACTLY the visible raw
    // market: excludes hidden/unreachable AND permanently-closed listings (a
    // plain `isHidden: { not: true }` would wrongly include CLOSED_FOREVER rows,
    // paying to enrich dead businesses).
    let businessIds = parsed.data.businessIds;
    if (businessIds.length === 0 && parsed.data.cellKeys.length > 0) {
      // Scope to website-havers when ANY selected family needs a live site
      // (Lighthouse/contacts/tech/services/AI can't run without one). The
      // WHOLESALE gate is deliberate: the workbench, CSV export, and the
      // enrichable-count all use the SAME `enrichmentNeedsWebsite` rule to keep
      // "the visible list == the enrichable list" — so scope, display, quote,
      // and fan-out stay in lockstep. (A per-family gate that ran reviews for
      // site-less leads in a mixed goal was reverted: it billed for leads the
      // workbench/export never rendered — invisible paid data. The reviews-for-
      // dead-sites asymmetry is a known-minor limitation, not worth breaking the
      // visible==enrichable invariant across five view-layer consumers.)
      const needsWebsite = enrichmentNeedsWebsite(parsed.data.enrichments);
      // WP5-4 · compose the caller's free pre-enrich filters with the website
      // gate (filters first, then topN caps within the filtered set below).
      const userFilters = parsed.data.filters;
      const scopeFilters =
        userFilters || needsWebsite
          ? {
              ...(userFilters ?? {}),
              ...(needsWebsite ? { hasWebsite: true } : {}),
            }
          : undefined;
      const inCell = await prisma.business.findMany({
        where: rawListWhere({
          cellKeys: parsed.data.cellKeys,
          filters: scopeFilters,
        }),
        // Best-first (workbench default sort: reviewCount desc NULLS LAST,
        // id asc) so a `topN` cap keeps the strongest leads — and an uncapped
        // 5000-take is deterministic instead of arbitrary-row-order.
        orderBy: [
          { reviewCount: { sort: "desc", nulls: "last" } },
          { id: "asc" },
        ],
        select: { id: true },
        take: Math.min(parsed.data.topN ?? 5000, 5000),
      });
      businessIds = inCell.map((b) => b.id);
    } else if (parsed.data.topN != null) {
      // Explicit-ids callers (raw-list selection) pass their own order —
      // honor it, just cap the count.
      businessIds = businessIds.slice(0, parsed.data.topN);
    }

    // 2026-07-10 · SCOPE THE CELL FAMILIES (meta_ads/serp) TO THE SELECTED MARKET.
    // When the caller scoped by EXPLICIT businessIds (selected/visible leads), the
    // per-cell families must run only on the cells THOSE businesses belong to —
    // NOT every cell of the discovery. Without this, selecting one market's leads
    // still quoted + ran Meta/SERP through ALL visible markets (the "suggests all
    // markets" bug). Derive the effective cells from the scoped businesses'
    // Business.cellKey (authoritative — the estimate, the stored scope re-quoted on
    // run, the fan-out, and the billing all then agree on the same cells). The
    // "enrich the market" path (businessIds RESOLVED from cellKeys above, so
    // parsed.data.businessIds was empty) keeps its cellKeys as-is — those ARE the
    // intended market scope.
    let effectiveCellKeys = parsed.data.cellKeys;
    if (parsed.data.businessIds.length > 0 && businessIds.length > 0) {
      const cellRows = await prisma.business.findMany({
        where: { id: { in: businessIds } },
        select: { cellKey: true },
      });
      effectiveCellKeys = [
        ...new Set(
          cellRows.map((r) => r.cellKey).filter((c): c is string => Boolean(c)),
        ),
      ];
    }

    // Entitlement model (Phase 2 · G6): the billing reducer becomes the FREE
    // quadrant (owned ∧ fresh), not global freshness — so a non-owner served
    // from our DB is billable and the hold covers it. DB freshness stops being a
    // billing input. Legacy path (flag off) is byte-identical.
    const freshByEnrichment = entitlementBillingEnabled()
      ? await countFreeForRun({
          agencyId,
          enrichments: parsed.data.enrichments,
          businessIds,
          cellKeys: effectiveCellKeys,
          now,
        })
      : await countFreshForRun({
          enrichments: parsed.data.enrichments,
          businessIds,
          cellKeys: effectiveCellKeys,
          now,
        });
    // P3 · PER-FAMILY line totals — exclude PERMANENTLY-UNAVAILABLE pairs from
    // the quote. A (business, family) past the cross-run attempt cap (or with a
    // structurally non-retryable reason) is "Not available": fan-out skips it,
    // so the QUOTE must not count it either — else the enrich sheet keeps
    // quoting hopeless leads ("Enrich 45 · ~55 cr" forever, the retry treadmill).
    // Uses the SAME permanentlyUnavailablePairs + jobFamilyForType keying as
    // fan-out, so quote and run agree on which pairs are dead.
    let businessCountByEnrichment:
      | Partial<Record<EnrichmentType, number>>
      | undefined;
    const businessBasisSelected = parsed.data.enrichments.filter(
      (e) => ENRICHMENT_PRICES[e].unit === "business",
    );
    if (businessBasisSelected.length > 0 && businessIds.length > 0) {
      const jobFamilies = [
        ...new Set(
          businessBasisSelected
            .map(jobFamilyForType)
            .filter(
              (f): f is NonNullable<ReturnType<typeof jobFamilyForType>> =>
                Boolean(f),
            ),
        ),
      ];
      const dead = await permanentlyUnavailablePairs(
        businessIds,
        jobFamilies,
        now,
      );
      const counts: Partial<Record<EnrichmentType, number>> = {};
      for (const e of businessBasisSelected) {
        const fam = jobFamilyForType(e);
        let eligible = 0;
        for (const id of businessIds) {
          if (fam && dead.has(`${id}:${fam}`)) continue;
          eligible += 1;
        }
        counts[e] = eligible;
      }
      businessCountByEnrichment = counts;
    }
    const lines = buildEnrichLines({
      enrichments: parsed.data.enrichments,
      businessCount: businessIds.length,
      cellCount: effectiveCellKeys.length,
      freshByEnrichment,
      ...(businessCountByEnrichment ? { businessCountByEnrichment } : {}),
    });

    const { estimate, result } = await createCostEstimate(
      {
        agencyId,
        userId: session.user.id,
        scopeKind: "enrichment",
        enrichments: parsed.data.enrichments,
        scopeRefs: {
          kind: "enrichment",
          discoveryId: parsed.data.discoveryId ?? null,
          businessIds,
          cellKeys: effectiveCellKeys,
          // Persist the estimator inputs so authorizeEstimate can re-quote.
          lines: lines as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonObject,
        lines,
        freshnessAsOf: now,
      },
      now,
    );

    return {
      status: "ok",
      estimateId: estimate.id,
      netUsd: result.netUsd,
      upperBoundUsd: result.upperBoundUsd,
      freshHitUsd: result.freshHitUsd,
      netCredits: result.netCredits,
      freshCredits: result.freshCredits,
      gate: result.gate,
      lines: result.lines.map((l) => ({
        enrichment: l.enrichment,
        label: l.label,
        unit: l.unit,
        total: l.total,
        netUsd: l.netUsd,
        upperBoundUsd: l.upperBoundUsd,
      })),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "enrich.preflight.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/**
 * Enqueue an enrichment run from an authorized estimate. Authorizes the quote
 * (server re-quote + anti-tamper + gate), holds the credits, creates a PENDING
 * EnrichmentRun, and marks the estimate CONSUMED (single-use). The internal
 * dispatch cron executes the families + settles the hold; this action NEVER
 * calls external APIs and never charges above the held amount.
 */
/** Best-effort client IP from the request headers (rate-limit keying only). */
async function requestIpKey(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
    const xri = h.get("x-real-ip");
    if (xri) return xri.trim();
  } catch {
    // headers() unavailable (test / non-request context) — fall through.
  }
  return "ip:unknown";
}

export async function runEnrichAction(
  input: unknown,
): Promise<RunEnrichResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound enrichment-run creation floods per user.
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  // WP7-5 · trial-abuse: an additional per-IP cap on enrich-run creation blunts
  // account-rotation farming behind one IP (orthogonal to the per-user cap).
  const ipRl = await rateLimitAction(ENRICH_RUN_IP_LIMIT, await requestIpKey());
  if (ipRl.limited) {
    return { status: "rate_limited", retryAfter: ipRl.retryAfter };
  }

  const parsed = RunEnrichInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    // WP5-8 · spend gate (docs/seat-model.md): enqueueing a run holds pooled
    // credits, so OWNER/ADMIN only. STAFF can still preflight (a quote is
    // free) but never authorize the spend.
    const spender = await requireSpendMember(session.user.id);
    if (!spender) return { status: "forbidden" };
    const agencyId = spender.agencyId;

    await grantFreeTierIfNew(agencyId);

    // Authorize: server re-quotes from the stored inputs (ignores any client
    // number) and flips the estimate AUTHORIZED, or tells us to re-quote.
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
    // WP1-11 (Viktor exception): no approval gate. A funded run of ANY size
    // proceeds self-serve — the ONLY spend gate is the wallet balance, enforced
    // below by holdCredits (→ insufficient_credits when the balance can't cover).

    // Reconstruct the run scope from the AUTHORIZED estimate (anti-tamper).
    const est = await prisma.costEstimate.findUnique({
      where: { id: parsed.data.estimateId },
      select: { enrichmentsJson: true, scopeRefsJson: true },
    });
    if (!est) return { status: "invalid_input", message: "estimate not found" };

    const families = (
      Array.isArray(est.enrichmentsJson) ? est.enrichmentsJson : []
    ) as EnrichmentType[];
    const scope = (est.scopeRefsJson ?? {}) as {
      discoveryId?: string | null;
      businessIds?: string[];
      cellKeys?: string[];
      lines?: { total?: number; fresh?: number }[];
    };
    const businessIds = scope.businessIds ?? [];
    const cellKeys = scope.cellKeys ?? [];
    const lines = Array.isArray(scope.lines) ? scope.lines : [];
    // WP4-3 · ONE progress unit = BUSINESSES, not Σ family lines. A 100-business
    // × 3-family run has 300 job rows but is "100 leads" to the user — measuring
    // progress in job-rows made a 2-of-3-families run open at 67% (2 fresh
    // families) and a multi-family run's bar march in family-sized jumps. The
    // enrichable business set (already resolved + website-scoped by preflight,
    // stored on the estimate's scope) is the honest denominator. A pure cell-only
    // run (meta/google/serp, no per-business ids) has no business unit → fall
    // back to the cell count so its bar still has a denominator.
    const unitsRequested =
      businessIds.length > 0 ? businessIds.length : cellKeys.length;
    // Fresh-skipped is likewise counted in BUSINESSES: a business is "skipped
    // fresh" only when EVERY one of its family lines was already fresh. Per-line
    // freshness is summed above per family, so the min across the run's lines is
    // the safe business-level floor (never over-counts skipped businesses).
    const unitsSkippedFresh =
      lines.length > 0
        ? Math.min(
            businessIds.length > 0 ? businessIds.length : Infinity,
            ...lines.map((l) => Math.min(l.fresh ?? 0, l.total ?? 0)),
          )
        : 0;

    const run = await prisma.enrichmentRun.create({
      data: {
        agencyId,
        // Wave-3 FK · authoritative run→discovery attribution (from the
        // authorized estimate's scope — anti-tamper like everything else here).
        discoveryId: scope.discoveryId ?? null,
        triggeredByUserId: session.user.id,
        estimateId: parsed.data.estimateId,
        enrichmentsJson: families as unknown as Prisma.InputJsonValue,
        scopeKind: "enrichment",
        scopeRefsJson: {
          kind: "enrichment",
          businessIds,
          cellKeys,
        } as Prisma.InputJsonValue,
        status: "PENDING",
        estimatedUsd: result.netUsd,
        creditsHeld: result.netCredits,
        unitsRequested,
        unitsSkippedFresh,
      },
      select: { id: true },
    });

    // Reserve credits. A $0 run (everything fresh) needs no hold.
    if (result.netCredits > 0) {
      try {
        await holdCredits(agencyId, result.netCredits, run.id, result.netUsd);
      } catch (err) {
        if (err instanceof WalletError && err.code === "insufficient_credits") {
          await prisma.enrichmentRun
            .delete({ where: { id: run.id } })
            .catch(() => {});
          // WP6-4 · the credit-wall checkpoint — the balance couldn't cover a
          // funded run the user tried to authorize (the activation drop-off the
          // upgrade sheet must catch). Counts only; never blocks the return.
          void trackProductEvent({
            type: "credit_exhausted_hit",
            agencyId,
            userId: session.user.id,
            props: {
              netCredits: result.netCredits,
              units: unitsRequested,
              families: families.length,
            },
          });
          return {
            status: "insufficient_credits",
            netCredits: result.netCredits,
          };
        }
        throw err;
      }
    }

    // Single-use: mark the estimate consumed so it can't be replayed.
    await prisma.costEstimate.update({
      where: { id: parsed.data.estimateId },
      data: { status: "CONSUMED", consumedByRunId: run.id },
    });

    // WP6-4 · enrich_started — the run is authorized + credits held. This is the
    // "committed spend" checkpoint (distinct from preview_viewed / a free
    // quote). Records the priced units + family count for per-template
    // conversion; fire-and-forget, no PII.
    void trackProductEvent({
      type: "enrich_started",
      agencyId,
      userId: session.user.id,
      props: {
        runId: run.id,
        units: unitsRequested,
        families: families.length,
        credits: result.netCredits,
      },
    });

    // 2026-07-10 · seed the Redis progress counters at ENQUEUE so the very
    // first poll (before any dispatch tick has run updateRunProgress) reads a
    // coherent "0 of N · PENDING" instead of the DB-fallback 0/0 — the
    // EnrichingStep can render "queued · starting" honestly during the start
    // lag instead of a blank/zero bar. Best-effort (degrades open when Redis is
    // down); the first tick's updateRunProgress corrects it regardless.
    await seedRunProgress(run.id, {
      done: 0,
      failed: 0,
      total: unitsRequested,
      retrying: 0,
      status: "PENDING",
    });

    // Arm the Neon idle gate so the next dispatch tick runs (not skipped) — set
    // BEFORE the kick so a gated GET tick can never miss this just-enqueued run.
    // Best-effort; the gate's safety scan is the backstop.
    await markCronWork(GATED_CRON.dispatch);

    // Kick the dispatch drain post-response so enrichment starts near-instantly
    // instead of waiting for the */2 cron. Best-effort (see kickDispatch).
    // Guarded: `after()` throws outside a request scope (e.g. unit tests).
    try {
      after(() => kickDispatch());
    } catch {
      /* no request scope — the cron drains it */
    }

    return { status: "ok", runId: run.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "enrich.enqueue.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
