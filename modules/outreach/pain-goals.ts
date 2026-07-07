// modules/outreach/pain-goals.ts · GOAL → PAIN-THEME bridge (A8, touchpoints
// audit 2026-07-07). The discover flow's goal step picks OUTCOME GROUPS of
// signals ("Reputation at risk", "Weak online presence", …); touch generation
// picks PAIN THEMES (unanswered_negative, slow_site, …). Before this module the
// two never met — a reputation-goal research generated slow-site openers. This
// maps each outcome group to the pain themes that PITCH that outcome, so a
// discovery's goal becomes the default pain allowlist (an explicit user
// selection always wins; see actions.ts).
//
// Pure + client-safe (no prisma): the WP5-1 overlay (agent B) imports
// `PAIN_KEYS_BY_OUTCOME_GROUP` / `defaultPainKeysForSignals` to pre-check the
// goal-derived themes; the server action derives the same defaults
// independently (never trusts the client selection's provenance).
//
// See:
//   - modules/agency-portal/discover/goal-templates.ts — OUTCOME_GROUPS / SIG_META
//   - modules/outreach/first-touch.ts — PAIN_THEMES (the theme catalog)

import type { OutcomeGroup } from "@/modules/agency-portal/discover/goal-templates";
import { SIG_META } from "@/modules/agency-portal/discover/goal-templates";
import { PAIN_THEMES, type PainThemeKey } from "./first-touch";

/** Every pain-theme key, catalog order (the canonical "no restriction" set). */
export const ALL_PAIN_KEYS: readonly PainThemeKey[] = PAIN_THEMES.map(
  (t) => t.key,
);

/**
 * Outcome group → the pain themes that pitch it. Reasoning per group:
 *
 *   - reputation · review-facing pains only. A reputation agency handed a
 *     HIPAA-pixel or slow-LCP hook is off-pitch.
 *   - weak-web   · site problems: slow load + no way to book from the site.
 *   - wasting    · ad-spend problems: paying for ads with no booking page, or
 *     rivals advertising while the prospect is absent. Plain `no_booking` is
 *     EXCLUDED: its present-gate requires runsAds !== true, which contradicts
 *     the group's "spending blind on ads" premise (it would never fire on a
 *     wasting-matched lead anyway).
 *   - growing    · targets WHO (momentum, worth the pitch), not a problem —
 *     any grounded pain is a fair opener, so no restriction.
 *   - under      · "flying blind" spans instrumentation, booking, AND privacy
 *     (the compliance signals live in this group) — restricting would drop the
 *     sharpest hooks, so no restriction.
 *   - other      · user-assembled criteria with no shared problem domain — no
 *     restriction.
 *
 * A theme key here still only fires when its SIGNAL is present on the lead
 * (first-touch's presence gates) — this narrows, never fabricates.
 */
export const PAIN_KEYS_BY_OUTCOME_GROUP: Record<
  OutcomeGroup,
  readonly PainThemeKey[]
> = {
  reputation: ["unanswered_negative", "review_decline"],
  "weak-web": ["slow_site", "no_booking"],
  wasting: ["ads_no_booking", "competitor_ads"],
  growing: ALL_PAIN_KEYS,
  under: ALL_PAIN_KEYS,
  other: ALL_PAIN_KEYS,
};

/**
 * Derive the default pain-theme allowlist from a discovery's active goal-signal
 * keys (the SIG_META keys persisted on `Discovery.signalsJson` — see
 * discovery-signals.ts). Each key resolves to its SIG_META outcome group; the
 * result is the UNION of the groups' theme sets, in PAIN_THEMES catalog order.
 *
 * Returns `null` for "no restriction" when:
 *   - no keys resolve to a known SIG_META group (empty / legacy / malformed), or
 *   - any resolved group is unrestricted (growing/under/other), or
 *   - the union covers every theme anyway.
 *
 * Callers MUST treat null as "don't restrict" — never as "restrict to nothing"
 * (A8: do NOT hard-restrict when derivation returns null).
 */
export function defaultPainKeysForSignals(
  signalKeys: string[],
): string[] | null {
  const union = new Set<PainThemeKey>();
  let resolved = 0;
  for (const key of signalKeys) {
    const group = SIG_META[key]?.group;
    if (!group) continue; // unknown key — ignore, never guess
    resolved += 1;
    for (const theme of PAIN_KEYS_BY_OUTCOME_GROUP[group]) union.add(theme);
  }
  if (resolved === 0) return null;
  if (union.size >= ALL_PAIN_KEYS.length) return null; // covers all → no restriction
  // Catalog order keeps the output deterministic regardless of input order.
  return ALL_PAIN_KEYS.filter((k) => union.has(k));
}
