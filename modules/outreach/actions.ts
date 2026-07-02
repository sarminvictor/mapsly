"use server";

/**
 * Outreach server actions (Phase 8 · Touchpoints · WP5-1/2/10).
 *
 * generateTouchpointsAction · generates signal-grounded OutreachDraft rows.
 * Two scopes:
 *   - POOL (default, the /touchpoints page): the agency's discovered,
 *     reachable prospects that don't yet have a draft (batch ≤20 per
 *     `.claude/rules/scalability.md`).
 *   - SELECTION (WP5-1, the workbench bulk bar + drawer): explicit
 *     `businessIds` (≤25), each gated through the agency's discovered cells.
 * Both support tone / 1–3 step sequences / a pain-theme allowlist (WP5-10),
 * and bill the advertised rate (10 credits per 100 touches — see
 * modules/outreach/touch-pricing.ts) through the wallet hold→settle machinery.
 *
 * regenerateTouchesAction · WP5-10: rebuild selected drafts in place from
 * fresh signals, deduping pain themes against the business's OTHER steps.
 *
 * `generateTouchesForLeads` is DETERMINISTIC (a grounded skeleton + DB write,
 * no external API) so it's safe in the request path.
 *
 * Auth-gated + Zod-validated per `.claude/rules/security.md`. Spend-gated to
 * OWNER/ADMIN per docs/seat-model.md (generation now debits the pooled
 * wallet). Every created draft is stamped with the agency's id (WP0-1).
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  ACTION_ENQUEUE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { requireSpendMember } from "@/modules/agency-portal/roles";
import {
  grantFreeTierIfNew,
  holdCredits,
  refundHold,
  settleRun,
  WalletError,
} from "@/modules/cost/server";
import {
  generateTouchesForLeads,
  gatherTouchSignals,
} from "@/modules/outreach/generate";
import { buildChannelTouch, type OutreachChannel } from "./channels";
import { creditsForTouches } from "./touch-pricing";
import { draftWhereForAgency, loadAgencyDrafts } from "./draft-scope";
import { trackProductEvent } from "@/lib/analytics/product-events";

// ── generateTouchpointsAction ────────────────────────────────────────────────

/** Cap on an explicit selection (WP5-1). ×3 steps = ≤75 drafts per call. */
const MAX_SELECTED_BUSINESSES = 25;

// Channel values match TouchChannel in modules/outreach/first-touch.ts.
const Input = z.object({
  sellingWhat: z.string().min(3).max(400),
  channel: z.enum(["email", "dm", "phone", "social"]),
  limit: z.number().int().min(1).max(20).default(20),
  /** WP5-1 · explicit selection. Absent → the agency-pool default. */
  businessIds: z
    .array(z.string().min(1).max(64))
    .max(MAX_SELECTED_BUSINESSES)
    .optional(),
  /** Optional — tightens the cell gate to one research. */
  discoveryId: z.string().min(1).max(64).optional(),
  tone: z.enum(["direct", "warm", "brief"]).optional(),
  sequenceLength: z.number().int().min(1).max(3).default(1),
  painPointKeys: z.array(z.string().min(1).max(64)).max(16).optional(),
});

export type GenerateTouchpointsInput = z.input<typeof Input>;

export type GenerateTouchpointsResult =
  | {
      status: "ok";
      generated: number;
      scanned: number;
      /** Selected businesses skipped because they already have a draft. */
      skippedExisting: number;
      /** Whole credits actually settled against the wallet. */
      creditsCharged: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "insufficient_credits"; creditsNeeded: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function generateTouchpointsAction(
  input: unknown,
): Promise<GenerateTouchpointsResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound enqueue-class floods (spend-bearing + DB-heavy).
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    // Spend gate (WP5-8 / docs/seat-model.md): generation debits the pooled
    // wallet, so OWNER/ADMIN only.
    const member = await requireSpendMember(session.user.id);
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    // Agency boundary: discovered cells (optionally narrowed to one research;
    // a discoveryId that isn't this agency's simply yields no cells).
    const discoveries = await prisma.discovery.findMany({
      where: {
        agencyId,
        ...(parsed.data.discoveryId ? { id: parsed.data.discoveryId } : {}),
      },
      select: { cellKeys: true },
    });
    const cellKeys = Array.from(
      new Set(discoveries.flatMap((d) => d.cellKeys)),
    );
    if (cellKeys.length === 0) {
      return {
        status: "ok",
        generated: 0,
        scanned: 0,
        skippedExisting: 0,
        creditsCharged: 0,
      };
    }

    // Candidate pool: the explicit selection gated through the agency's
    // cells, or the best reachable prospects (pool mode, over-fetched so the
    // already-drafted exclusion still fills the batch).
    const explicit = parsed.data.businessIds;
    const pool = await prisma.business.findMany({
      where: {
        ...(explicit ? { id: { in: explicit } } : {}),
        cellKey: { in: cellKeys },
        isHidden: false,
        // WP7-2 · never generate outreach for a do-not-sell-suppressed business.
        suppressedAt: null,
        ...(explicit ? {} : { reachableChannelCount: { gt: 0 } }),
      },
      select: { id: true },
      ...(explicit ? {} : { take: parsed.data.limit * 3 }),
      orderBy: { reviewCount: "desc" },
    });
    if (pool.length === 0) {
      return {
        status: "ok",
        generated: 0,
        scanned: 0,
        skippedExisting: 0,
        creditsCharged: 0,
      };
    }

    // Exclude businesses THIS AGENCY already drafted. Agency-scoped (fixes a
    // real pre-WP5 bug: another agency's drafts in a shared cell suppressed
    // this agency's generation).
    const drafted = await prisma.outreachDraft.findMany({
      where: draftWhereForAgency(
        agencyId,
        pool.map((p) => p.id),
      ),
      select: { businessId: true },
    });
    const draftedSet = new Set(drafted.map((d) => d.businessId));
    const undrafted = pool.filter((p) => !draftedSet.has(p.id));
    const targets = (
      explicit ? undrafted : undrafted.slice(0, parsed.data.limit)
    ).map((p) => p.id);
    const skippedExisting = explicit ? pool.length - undrafted.length : 0;

    if (targets.length === 0) {
      return {
        status: "ok",
        generated: 0,
        scanned: pool.length,
        skippedExisting,
        creditsCharged: 0,
      };
    }

    // Bill the advertised rate (10 cr / 100 touches): hold up front, settle
    // the actual after generation, refund on failure. The synthetic runId
    // keys the ledger rows (CreditLedger.runId is a plain string).
    const creditsNeeded = creditsForTouches(
      targets.length * parsed.data.sequenceLength,
    );
    const runId = `touchgen:${randomUUID()}`;
    if (creditsNeeded > 0) {
      await grantFreeTierIfNew(agencyId);
      try {
        await holdCredits(agencyId, creditsNeeded, runId);
      } catch (err) {
        if (err instanceof WalletError && err.code === "insufficient_credits") {
          return { status: "insufficient_credits", creditsNeeded };
        }
        throw err;
      }
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, mailingAddress: true },
    });

    let touches;
    try {
      touches = await generateTouchesForLeads(targets, {
        sellingWhat: parsed.data.sellingWhat,
        channel: parsed.data.channel,
        agencyId,
        mailingAddress: agency?.mailingAddress ?? null,
        // WP7-4 · CASL sender-ID line for CA recipients.
        senderName: agency?.name ?? null,
        tone: parsed.data.tone,
        sequenceLength: parsed.data.sequenceLength,
        painPointKeys: parsed.data.painPointKeys,
      });
    } catch (err) {
      if (creditsNeeded > 0) await refundHold(runId);
      throw err;
    }

    let creditsCharged = 0;
    if (creditsNeeded > 0) {
      const settled = await settleRun(runId, creditsForTouches(touches.length));
      creditsCharged = settled.charged;
    }

    // WP6-4 · touch_generated — outreach drafts produced (the "value leaves the
    // funnel toward a send" checkpoint). Records counts + the channel/sequence
    // shape; fire-and-forget, no draft PII.
    void trackProductEvent({
      type: "touch_generated",
      agencyId,
      userId: session.user.id,
      props: {
        generated: touches.length,
        leads: targets.length,
        channel: parsed.data.channel,
        sequenceLength: parsed.data.sequenceLength ?? 1,
      },
    });

    return {
      status: "ok",
      generated: touches.length,
      scanned: pool.length,
      skippedExisting,
      creditsCharged,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.generate.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── regenerateTouchesAction (WP5-10) ─────────────────────────────────────────

const RegenerateInput = z.object({
  draftIds: z.array(z.string().min(1).max(64)).min(1).max(60),
  /** New pitch line; absent → the draft's stored `whyJson.sellingWhat`. */
  sellingWhat: z.string().min(3).max(400).optional(),
  tone: z.enum(["direct", "warm", "brief"]).optional(),
});

export type RegenerateTouchesInput = z.input<typeof RegenerateInput>;

export type RegenerateTouchesResult =
  | {
      status: "ok";
      regenerated: number;
      failedIds: string[];
      creditsCharged: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "insufficient_credits"; creditsNeeded: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

/** The whyJson fields regeneration reads back (all optional/legacy-safe). */
function parseDraftMeta(whyJson: unknown): {
  sellingWhat: string | null;
  tone: "direct" | "warm" | "brief" | null;
  sequenceStep: number;
  sequenceOf: number;
  usedSignals: string[];
} {
  const o = (whyJson ?? {}) as Record<string, unknown>;
  const tone =
    o.tone === "direct" || o.tone === "warm" || o.tone === "brief"
      ? o.tone
      : null;
  const used = Array.isArray(o.usedSignals)
    ? o.usedSignals.filter((s): s is string => typeof s === "string")
    : [];
  return {
    sellingWhat: typeof o.sellingWhat === "string" ? o.sellingWhat : null,
    tone,
    sequenceStep:
      typeof o.sequenceStep === "number" && o.sequenceStep >= 1
        ? Math.trunc(o.sequenceStep)
        : 1,
    sequenceOf:
      typeof o.sequenceOf === "number" && o.sequenceOf >= 1
        ? Math.trunc(o.sequenceOf)
        : 1,
    usedSignals: used,
  };
}

/**
 * Rebuild the selected drafts in place from fresh signals. Pain themes are
 * deduped against the SAME business's other steps (non-repeating sequences,
 * WP5-10). Bills the same advertised rate as generation. Drafts that can't be
 * rebuilt (unknown pitch, ungroundable business) are reported in `failedIds`
 * and not billed.
 */
export async function regenerateTouchesAction(
  input: unknown,
): Promise<RegenerateTouchesResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · regeneration bills the wallet — same enqueue-class bound.
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = RegenerateInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await requireSpendMember(session.user.id);
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    const drafts = await loadAgencyDrafts(agencyId, parsed.data.draftIds);
    if (drafts.length === 0) return { status: "forbidden" };

    const creditsNeeded = creditsForTouches(drafts.length);
    const runId = `touchregen:${randomUUID()}`;
    if (creditsNeeded > 0) {
      await grantFreeTierIfNew(agencyId);
      try {
        await holdCredits(agencyId, creditsNeeded, runId);
      } catch (err) {
        if (err instanceof WalletError && err.code === "insufficient_credits") {
          return { status: "insufficient_credits", creditsNeeded };
        }
        throw err;
      }
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, mailingAddress: true },
    });

    const failedIds: string[] = [];
    let regenerated = 0;
    const signalsCache = new Map<
      string,
      Awaited<ReturnType<typeof gatherTouchSignals>>
    >();

    for (const draft of drafts) {
      const meta = parseDraftMeta(draft.whyJson);
      const sellingWhat = parsed.data.sellingWhat ?? meta.sellingWhat;
      if (!sellingWhat) {
        // Legacy draft with no stored pitch and none supplied — can't ground
        // the opener honestly. Report, don't guess.
        failedIds.push(draft.id);
        continue;
      }

      try {
        let signals = signalsCache.get(draft.businessId);
        if (!signals) {
          signals = await gatherTouchSignals(draft.businessId);
          signalsCache.set(draft.businessId, signals);
        }

        // Theme dedup: exclude the pains the business's OTHER drafts cite.
        const siblings = await prisma.outreachDraft.findMany({
          where: {
            ...draftWhereForAgency(agencyId, [draft.businessId]),
            id: { not: draft.id },
          },
          select: { whyJson: true },
        });
        const excludePainKeys = Array.from(
          new Set(
            siblings.flatMap((s) => parseDraftMeta(s.whyJson).usedSignals),
          ),
        );

        const tone = parsed.data.tone ?? meta.tone ?? "direct";
        const touch = buildChannelTouch(signals, {
          channel: draft.channel as OutreachChannel,
          sellingWhat,
          mailingAddress: agency?.mailingAddress ?? null,
          // WP7-4 · CASL sender-ID line for CA recipients.
          senderName: agency?.name ?? null,
          tone,
          excludePainKeys,
          sequenceStep: meta.sequenceStep,
        });

        await prisma.outreachDraft.update({
          where: { id: draft.id },
          data: {
            subject: touch.subject ?? null,
            body: touch.body,
            whyJson: {
              why: touch.why,
              usedSignals: touch.usedSignals,
              droppedTokens: touch.droppedTokens,
              sequenceStep: meta.sequenceStep,
              sequenceOf: meta.sequenceOf,
              tone,
              sellingWhat,
            },
            predictedTier: touch.predictedTier,
            status: "draft",
          },
          select: { id: true },
        });
        regenerated += 1;
      } catch {
        failedIds.push(draft.id);
      }
    }

    let creditsCharged = 0;
    if (creditsNeeded > 0) {
      const settled = await settleRun(runId, creditsForTouches(regenerated));
      creditsCharged = settled.charged;
    }

    return { status: "ok", regenerated, failedIds, creditsCharged };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.regenerate.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
