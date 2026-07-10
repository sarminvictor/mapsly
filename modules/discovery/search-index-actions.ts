"use server";

// FT-2 · "Search everywhere" — pull up-to-N leads from our EXISTING index
// (across ALL markets, not a chosen cell) that FULLY match the agency's selected
// signals and have contacts. Available to every plan.
//
// MATCH (Q1 · 2026-07-08 owner decision): we match on the FULL selected signal
// set — INCLUDING paid-research signals (Lighthouse / reviews / ads / SERP /
// tech) — against whatever data we already hold. `hydrateBusinessForSignals`
// already loads every research family, so a business we've audited evaluates its
// paid signals for real. A lead is delivered ONLY when EVERY selected signal is
// confirmed TRUE (strict full match); a business we can't confirm on a selected
// signal (null verdict = no data) is EXCLUDED — no silent skipping. The paid
// VALUES stay hidden in the workbench until the agency enriches that family:
// matching is free, VIEWING paid data needs an entitlement (the value-layer G9
// gate). Delivery volume therefore tracks how much paid data we've accumulated.
//
// DEDUP (Q2 · agency-wide): a new search never re-delivers a business the agency
// already holds in ANY research (Target or Search). Prevents a double-charge and
// keeps every search additive.
//
// Billing: flat 1 credit per DELIVERED lead via the wallet run pattern
// (holdCredits → createMany → settleRun(inserted) → refundHold). We ALSO record
// an EnrichmentRun (scopeKind "search", status OK) so the research card reads the
// real credits + routes to the leads through the SAME channel as a market
// research. Each taken lead mints a CONTACTS entitlement.

import { randomUUID } from "crypto";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import { markCronWork, GATED_CRON } from "@/lib/cron/idle-gate";
import { CREDIT_PRICES } from "@/modules/cost/pricing";
import {
  getOrCreateWallet,
  holdCredits,
  reconcileRunCredits,
  refundHold,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import { entitlementBillingEnabled } from "@/modules/cost/flags";
import {
  hydrateBusinessForSignals,
  resolveMatches,
} from "@/modules/agency-portal/discover/signal-eval";
import {
  activeSignalsFromJson,
  isEvaluableSignalKey,
} from "@/modules/agency-portal/discover/discovery-signals";

/** Safety bound: never scan more than this many businesses in one call. */
const MAX_SCAN = 6000;
const SCAN_BATCH = 200;
const DEFAULT_SERVICE_TYPE = "CUSTOM" as const;

const Input = z.object({
  /** The goal's signal selection (Discovery.signalsJson shape). */
  signalsJson: z.unknown(),
  /** How many leads the user asked for (a ceiling, not a guarantee). */
  count: z.number().int().min(1).max(1000),
  name: z.string().min(1).max(120).optional(),
});

export type SearchIndexResult =
  | {
      status: "ok";
      discoveryId: string;
      listId: string;
      delivered: number;
      requested: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "insufficient_credits"; creditsNeeded: number }
  | { status: "no_matches" }
  | { status: "invalid_input" }
  | { status: "error" };

export async function searchIndexLeadsAction(
  input: unknown,
): Promise<SearchIndexResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { status: "invalid_input" };

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { id: true, agencyId: true },
    });
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    await grantFreeTierIfNew(agencyId);
    const wallet = await getOrCreateWallet(agencyId);

    // 1 credit per lead → the wallet is the authoritative ceiling (server-side).
    // No separate free cap: credits ARE the cap (owner decision Q3).
    const target = Math.min(parsed.data.count, wallet.availableCredits);
    if (target <= 0)
      return { status: "insufficient_credits", creditsNeeded: 1 };

    // Match on the FULL selected signal set (basic AND paid) — Q1. Nothing is
    // dropped; strict full-match below requires every signal to be confirmed.
    // EXCEPT roadmap signals: they resolve null for every business, so a strict
    // AND-gate could never satisfy them → the search would always return
    // nothing. Exclude them from the gate (same rule as allLibraryActiveSignals).
    const signals = activeSignalsFromJson(parsed.data.signalsJson).filter((s) =>
      isEvaluableSignalKey(s.key),
    );

    // Agency-wide dedup (Q2): every business this agency already holds as a Lead
    // in ANY list/research. Loaded once into a Set; skipped in the scan so a new
    // search is always additive and never re-charges for a lead already owned.
    const heldRows = await prisma.lead.findMany({
      where: { agencyId },
      select: { businessId: true },
      distinct: ["businessId"],
    });
    const heldSet = new Set(heldRows.map((l) => l.businessId));

    // Keyset scan across ALL markets (cellKey-contiguous, busiest-first) for
    // STRICT full-threshold matches with contacts, until `target` reached or the
    // scan is exhausted / bounded.
    const now = new Date();
    const matched: string[] = [];
    let cursor: string | null = null;
    let scanned = 0;

    while (matched.length < target && scanned < MAX_SCAN) {
      const batch: { id: string }[] = await prisma.business.findMany({
        where: {
          isActive: true,
          isHidden: false,
          reachableChannelCount: { gt: 0 },
        },
        orderBy: [{ cellKey: "asc" }, { reviewCount: "desc" }, { id: "asc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: SCAN_BATCH,
        select: { id: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      scanned += batch.length;

      // Drop already-held (dedup) BEFORE hydration/match — never re-deliver.
      const fresh = batch.filter((b) => !heldSet.has(b.id));
      if (fresh.length === 0) continue;

      if (signals.length === 0) {
        // No signals selected → any fresh contactable business qualifies.
        for (const b of fresh) {
          if (matched.length >= target) break;
          matched.push(b.id);
        }
        continue;
      }

      const ids = fresh.map((b) => b.id);
      const hyd = await hydrateBusinessForSignals(ids);
      for (const id of ids) {
        if (matched.length >= target) break;
        const h = hyd.get(id);
        if (!h) continue;
        const r = resolveMatches(signals, h, now);
        // STRICT full match: EVERY selected signal must be confirmed TRUE. A
        // signal with no data for this business (null) means we can't confirm
        // the match → exclude. This is what "fully matched leads" means (Q1) —
        // the redesign qualifier really fired, not silently skipped.
        if (signals.every((s) => r.perSignal[s.key] === true)) {
          matched.push(id);
        }
      }
    }

    if (matched.length === 0) return { status: "no_matches" };

    // Charge only for DELIVERED leads — wallet run (outreach pattern).
    const runId = `searchidx:${randomUUID()}`;
    const unit = CREDIT_PRICES.contacts; // 1 credit / lead
    try {
      await holdCredits(agencyId, matched.length * unit, runId);
    } catch (err) {
      if (err instanceof WalletError && err.code === "insufficient_credits") {
        return {
          status: "insufficient_credits",
          creditsNeeded: matched.length,
        };
      }
      throw err;
    }

    let listId: string;
    let discoveryId: string;
    let delivered: number;
    let cellKeys: string[];
    try {
      // Distinct cells the matched leads live in — drive the workbench's
      // market-relative bands (and let a cross-market search render grouped).
      const cellRows = await prisma.business.findMany({
        where: { id: { in: matched } },
        select: { cellKey: true },
      });
      cellKeys = Array.from(
        new Set(
          cellRows
            .map((b) => b.cellKey)
            .filter((k): k is string => typeof k === "string" && k.length > 0),
        ),
      );

      // A search is a "research" (Discovery row) so it appears in My research and
      // opens through the existing, proven list-workbench route — search leads
      // aren't orphaned. status READY = done; researchStatus ACTIVE = listed.
      const discovery = await prisma.discovery.create({
        data: {
          agencyId,
          requestedByUserId: session.user.id,
          name: parsed.data.name ?? "Search everywhere",
          idempotencyKey: runId,
          status: "READY",
          cellKeys,
          cellCount: cellKeys.length,
          totalBusinesses: matched.length,
          finishedAt: new Date(),
          signalsJson: (parsed.data.signalsJson ??
            undefined) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      discoveryId = discovery.id;

      const list = await prisma.list.create({
        data: {
          agencyId,
          ownerMemberId: member.id,
          name: parsed.data.name ?? "Search results",
          serviceType: DEFAULT_SERVICE_TYPE,
          filterJson: {},
          discoveryId,
          isRaw: false,
        },
        select: { id: true },
      });
      listId = list.id;

      const created = await prisma.lead.createMany({
        data: matched.map((businessId) => ({
          listId,
          agencyId,
          businessId,
          status: "NEW" as const,
        })),
        skipDuplicates: true,
      });
      delivered = created.count;

      // Record the search as a first-class research run in the SAME durable unit
      // as the leads — the research card's "delivered" status + credits derive
      // from this row, so it must NOT be best-effort (a swallowed failure would
      // mis-route the card back into "Enrich →"). scopeKind "search" is the
      // downstream discriminator.
      await prisma.enrichmentRun.create({
        data: {
          agencyId,
          discoveryId,
          triggeredByUserId: session.user.id,
          enrichmentsJson: {
            kind: "search",
            families: ["contacts"],
          } as Prisma.InputJsonValue,
          scopeKind: "search",
          scopeRefsJson: { cellKeys } as Prisma.InputJsonValue,
          status: "OK",
          creditsHeld: matched.length * unit,
          creditsCharged: delivered * unit,
          unitsRequested: parsed.data.count,
          unitsCompleted: delivered,
          finishedAt: new Date(),
        },
      });

      // This search run is born terminal → arm the run-finished-emails gate so
      // its next tick emails the outcome instead of waiting for the safety scan.
      await markCronWork(GATED_CRON.runFinishedEmails);
    } catch (err) {
      // Nothing charged yet (settle runs below) → refund the whole hold.
      await refundHold(runId);
      throw err;
    }

    // Settle the charge for what we actually inserted. reconcileRunCredits NEVER
    // throws (it wraps the wallet write) — so a transient settle hiccup can't
    // strand the hold OR return "error" after leads are already delivered; the
    // hold reconciles to the charge or is refunded internally.
    await reconcileRunCredits(runId, {
      actualCredits: delivered * unit,
      hadProgress: delivered > 0,
    });

    // Best-effort: mint the CONTACTS entitlement per taken lead (the 1-credit buy
    // = list membership + contacts; richer families stay locked, their VALUES
    // hidden until per-family enrichment though search matched on them). A mint
    // failure is reconcilable and must not fail an already-delivered search.
    try {
      if (entitlementBillingEnabled()) {
        await prisma.agencyEntitlement.createMany({
          data: matched.map((businessId) => ({
            agencyId,
            businessId,
            family: "CONTACTS" as const,
            sourceRunId: runId,
            creditsCharged: unit,
          })),
          skipDuplicates: true,
        });
      }
    } catch (recErr) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "search_index.mint_failed",
          runId,
          discoveryId,
          message: recErr instanceof Error ? recErr.message : String(recErr),
        }),
      );
    }

    return {
      status: "ok",
      discoveryId,
      listId,
      delivered,
      requested: parsed.data.count,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "search_index.error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
