// Blockers · the never-bother-Viktor-with-trivia rule.
//
// A blocker surfaces ONLY when ALL of these are true:
//   1. The work cannot proceed without it
//   2. There is no programmatic path I have access to
//   3. The state is verifiably not-done (we re-check the resource itself,
//      not just a tag in a markdown file)
//
// Rules:
//   - If I have an API token / CLI / MCP that can do it → I do it myself.
//     Logged to build-log.md, never surfaced as a blocker.
//   - PLAN.md tags are HINTS, not truth. Always verify the actual state.
//   - When in doubt, attempt programmatically first. Only after a real
//     failure (auth denied, no API exists) does it become a blocker.

import { cacheLife, cacheTag } from "next/cache";
import { getServiceHealth } from "./services";

export interface Blocker {
  id: string;
  source: "plan" | "service" | "incident";
  title: string;
  reason: string;
  action: string;
  priority: "critical" | "warn" | "info";
}

// Services that genuinely require Viktor — based on real-world API access:
// - Stripe: account creation requires bank + identity verification (human-gated)
// - Meta Ad Library: ads_archive requires Business Verification (gov ID review)
// Everything else (DataForSEO, Anthropic, Sentry, KV, Blob, Resend domain) can
// be set up programmatically given the right credentials or via CLI.
const SERVICE_HUMAN_GATED = new Set(["Stripe", "Meta Ad Library"]);

function describeBlocker(name: string): { reason: string; action: string } {
  switch (name) {
    case "Stripe":
      return {
        reason:
          "Account creation requires a real bank account + business identity verification — no API path.",
        action:
          "Complete onboarding at dashboard.stripe.com. Once `STRIPE_SECRET_KEY` lands in Vercel env, this blocker auto-clears.",
      };
    case "Meta Ad Library":
      return {
        reason:
          "`ads_archive` access requires Meta Business Verification — government ID review (2–5 day human process).",
        action:
          "Apply at business.facebook.com → Settings → Business Verification. Once `META_AD_LIBRARY_ACCESS_TOKEN` lands in Vercel env, this blocker auto-clears.",
      };
    default:
      return {
        reason: `${name} requires manual setup`,
        action: "See docs/handoff.md",
      };
  }
}

export async function getBlockers(): Promise<Blocker[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-blockers");

  const blockers: Blocker[] = [];

  // Service-health gaps that are genuinely human-gated AND not yet configured.
  // If the env var is present, the service is considered set up and is no
  // longer a blocker — even if its ping fails (that's a runtime issue, not a
  // setup issue).
  const services = await getServiceHealth();
  for (const svc of services) {
    if (!svc.configured && SERVICE_HUMAN_GATED.has(svc.name)) {
      const { reason, action } = describeBlocker(svc.name);
      blockers.push({
        id: `service-${svc.name.toLowerCase().replace(/\s+/g, "-")}`,
        source: "service",
        title: `${svc.name} not configured`,
        reason,
        action,
        priority: "info",
      });
    }
  }

  // PLAN.md `human-required` rows are NOT auto-promoted into blockers anymore.
  // Reason: most of those tags were stale (set during scaffold). The loop's
  // own discipline already skips human-required rows when picking work; we
  // don't need to also nag Viktor about them on the dashboard. If a phase is
  // genuinely waiting on Viktor, the relevant service-gap above surfaces it.

  return blockers;
}
