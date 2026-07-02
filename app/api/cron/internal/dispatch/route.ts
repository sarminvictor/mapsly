// Internal cron · enrichment:dispatch
//
// Drains PENDING Discovery + EnrichmentRun rows and runs them through the real
// worker functions (maps-search, contact scan, reviews, cell ads/serp, AI
// research, services, playbooks). The user-facing actions only enqueue; this is
// the air-gapped consumer so no external API ever runs in a user request path
// (.claude/rules/cost-discipline.md). Cost is attributed to the CronRun opened
// by withCronRun("enrichment:dispatch").
//
// Auth: Bearer CRON_SECRET (server-to-server only · not rate-limited per
// .claude/rules/scalability.md). Schedule frequently via Vercel cron; also
// POST-triggerable from the admin tool / right after an enqueue.

import { after } from "next/server";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { withCronRun } from "@/lib/cost/cost-counter";
import { dispatchPending } from "@/modules/enrichment/dispatch";
import {
  kickDispatch,
  enqueueRekickDispatch,
} from "@/modules/enrichment/kick-dispatch";

// A dispatch tick budgets itself under ~240s (WP3-7) but the RUNNING-run close
// loop + fan-out can push it toward the cap — give it the full 300s headroom.
export const maxDuration = 300;

const JOB = "enrichment:dispatch";

/** Max PENDING rows of each kind to drain per invocation (bounded work). */
const DEFAULT_LIMIT = 10;

async function handle(req: Request): Promise<Response> {
  const authResult = verifyCronAuth(req);
  if (!authResult.ok) {
    if (authResult.reason === "not_configured") {
      return Response.json(
        { error: "internal_error", message: "CRON_SECRET not configured" },
        { status: 500 },
      );
    }
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 50)
      : DEFAULT_LIMIT;

  const result = await withCronRun(JOB, () => dispatchPending(limit));

  // WP3-1 · Self-chain (two guarantees, one condition). When this batch made
  // forward progress AND more work remains (`hasMoreWork`), we chain the next
  // batch so runs go back-to-back instead of waiting up to 2 min for the next
  // cron tick. Two independent mechanisms carry the chain:
  //   1. A direct kickDispatch() fetch — now AWAITED inside after() (WP3-1) so
  //      the invocation stays alive until the kick actually sends (a bare
  //      fire-and-forget could be dropped if the invocation freezes first).
  //   2. A Boxly re-kick job — the worker RETRIES delivery, so even if the
  //      direct kick's hop is dropped, the chain survives. Logs the degraded
  //      path (worker unset) so the operator sees it fell back to the every-2-min cron.
  // `hasMoreWork` requires forward progress, so a fully-blocked / all-failing
  // state can't tight-loop — it falls back to the every-2-min cron cadence (WP3-6).
  // Guarded (after() throws outside a request scope).
  if (result.hasMoreWork) {
    try {
      after(async () => {
        await enqueueRekickDispatch(); // worker-retried delivery (guaranteed hop)
        await kickDispatch(); // direct kick (fast path), now awaited
      });
    } catch {
      /* no request scope — the every-2-min cron drains the rest */
    }
  }

  return Response.json({ ok: true, ...result });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
