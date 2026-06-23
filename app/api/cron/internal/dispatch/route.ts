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

import { withCronRun } from "@/lib/cost/cost-counter";
import { dispatchPending } from "@/modules/enrichment/dispatch";

const JOB = "enrichment:dispatch";

/** Max PENDING rows of each kind to drain per invocation (bounded work). */
const DEFAULT_LIMIT = 10;

async function handle(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "internal_error", message: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 50)
      : DEFAULT_LIMIT;

  const result = await withCronRun(JOB, () => dispatchPending(limit));
  return Response.json({ ok: true, ...result });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
