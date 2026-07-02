// /api/internal/rekick-dispatch · WP3-1 self-chain re-kick target.
//
// The Boxly worker POSTs here (with retry) when a dispatch tick still has more
// work. It just re-fires the dispatch drain — a thin, idempotent hop whose only
// job is to guarantee the self-chain survives a dropped direct kick. The actual
// drain runs in the dispatch route's OWN invocation (its own 300s budget); this
// route returns as soon as the kick is fired.
//
// Auth: EITHER the Boxly worker token (the worker is the normal caller) OR
// CRON_SECRET (so the admin tool / a manual curl can also poke it). Both are
// server-to-server, not rate-limited (.claude/rules/scalability.md).

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { kickDispatch } from "@/modules/enrichment/kick-dispatch";

async function handle(req: Request): Promise<Response> {
  const workerOk = verifyBoxlyWorkerAuth(req.headers.get("authorization"));
  const cronOk = verifyCronAuth(req).ok;
  if (!workerOk && !cronOk) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fire the drain (awaited so this invocation doesn't tear down before the kick
  // flushes — the drain itself continues in its own invocation). Best-effort.
  await kickDispatch();
  return Response.json({ ok: true, rekicked: true }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
