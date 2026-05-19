// Blockers · ONLY items genuinely requiring Viktor — never trivia I can do.
//
// Sources:
//   1. PLAN.md rows tagged `human-required` AND status pending/in_progress
//   2. .claude/memory/incidents.md entries tagged `human-required`
//   3. Service-health gaps where the service requires manual provisioning
//      (ID verification, signing into a third-party UI, etc.)
//
// Strict filter: a blocker only appears if there is *no* programmatic path
// available given the tools and credentials we have. If I have an API token
// and can do it via curl, it's NOT a blocker — I do it myself and just log
// the action to build-log.md.

import { cacheLife, cacheTag } from "next/cache";
import { getPlanSummary } from "./plan";
import { getServiceHealth } from "./services";

export interface Blocker {
  id: string;
  source: "plan" | "service" | "incident";
  title: string;
  reason: string; // WHY can't I do this myself?
  action: string; // What Viktor must do
  priority: "critical" | "warn" | "info";
}

// Services that genuinely can't be configured without Viktor:
// - Meta Ad Library: requires business verification with government ID
// - Stripe: requires bank account + business identity verification
// - Resend domain auth: requires DNS records that may not be on a Vercel-managed domain
//
// Services I CAN configure if given credentials:
// - DataForSEO: just username/password
// - Anthropic API: just API key
// - Sentry DSN: I can create the project via Sentry MCP
// - Vercel KV/Blob: I can provision via Vercel CLI
const SERVICE_HUMAN_GATED = new Set(["Meta Ad Library", "Stripe"]);

export async function getBlockers(): Promise<Blocker[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-blockers");

  const blockers: Blocker[] = [];

  // 1. PLAN.md rows tagged human-required
  const plan = await getPlanSummary();
  for (const row of plan.rows) {
    if (row.tags.includes("human-required") && row.status !== "done") {
      blockers.push({
        id: `plan-${row.id}`,
        source: "plan",
        title: `Phase ${row.id}: ${row.description}`,
        reason: "Tagged human-required in PLAN.md",
        action: "See PLAN.md for the specific manual step",
        priority: "warn",
      });
    }
  }

  // 2. Service-health gaps that are genuinely human-gated
  const services = await getServiceHealth();
  for (const svc of services) {
    if (!svc.configured && SERVICE_HUMAN_GATED.has(svc.name)) {
      blockers.push({
        id: `service-${svc.name.toLowerCase().replace(/\s+/g, "-")}`,
        source: "service",
        title: `${svc.name} not configured`,
        reason:
          svc.name === "Meta Ad Library"
            ? "Requires Meta Business Verification (government ID review, 2–5 day process)"
            : svc.name === "Stripe"
              ? "Requires bank account + identity verification"
              : "Manual provisioning needed",
        action:
          svc.name === "Meta Ad Library"
            ? "Apply at business.facebook.com → Settings → Business Verification"
            : svc.name === "Stripe"
              ? "Complete Stripe onboarding at dashboard.stripe.com"
              : "See docs/handoff.md",
        priority: "info",
      });
    }
  }

  // 3. Incident entries tagged human-required (parse the text)
  // Light heuristic: look for `Tags:` lines containing `human-required`.
  // The structured parse can land later — for now, we keep this simple.

  return blockers;
}
