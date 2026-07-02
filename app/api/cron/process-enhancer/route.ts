// Cron · process-enhancer · regenerate .claude/memory/enhance-signals.json
//
// Triggered daily by Vercel cron (vercel.json). Runs the pure detector
// against current incidents.md + build-log.md + .claude/rules/*.md and
// returns the refreshed signals JSON for the dashboard to consume.
//
// Replaces the prior "every loop tick re-detects" pattern from v0.6.27,
// which was wasteful: detector input changes only when an INC is added
// or a rule file lands, not every 5 min. Daily cadence is more than enough.

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { detectFromDisk } from "@/lib/process-enhancer/detect-patterns";

export async function GET(req: Request) {
  // Preserve the existing shape: a plain-text 401 on any auth failure
  // (including a missing CRON_SECRET, which the original compare also rejected).
  if (!verifyCronAuth(req).ok) {
    return new Response("unauthorized", { status: 401 });
  }

  const { signals, incidents, buildLog } = detectFromDisk({
    incidentsPath: ".claude/memory/incidents.md",
    buildLogPath: ".claude/memory/build-log.md",
    ctx: { rulesDir: ".claude/rules" },
  });

  return Response.json({
    detectedAt: new Date().toISOString(),
    incidentsParsed: incidents.length,
    citationsTotal: buildLog.total,
    signalsCount: signals.length,
    signals,
  });
}
