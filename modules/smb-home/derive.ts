/**
 * SMB overview · quick-win derivation (pure).
 *
 * `deriveOverviewFixes` reads the 5 section (pillar) scores + a couple of
 * raw counts and produces the prioritised quick-win list the right rail
 * renders — one fix per section at most, the highest-leverage first.
 *
 * Pillar-aligned by design: every fix maps to the section page Maria opens
 * to act on it (no legacy 6-dimension sub-scores). Pure (no IO) so the unit
 * tests run it against synthetic fixtures.
 *
 * Voice is Maria-first per `.claude/rules/copy-voice.md` — plain English,
 * outcome-first, no MSI / LCP / schema / NAP jargon.
 */

import type { SmbOverviewFix } from "./types";
import { MAX_FIXES } from "./types";

/** A section scoring ≥ 7 is "Looking strong" (matches the pillar-tile state
 * labels). Below that — "Room to grow" (4–7) or "Needs attention" (< 4) — we
 * surface a quick win for it. So every not-yet-strong section gets advice;
 * the priority order + MAX_FIXES cap keep the highest-leverage ones on top. */
const STRONG_SCORE = 7;

/** Input — the section scores + the two raw signals that sharpen a fix. */
export interface OverviewFixInput {
  reputation: number | null;
  visibility: number | null;
  profile: number | null;
  website: number | null;
  advertising: number | null;
  adsApplicable: boolean | null;
  /** Reviews with no owner reply — makes the reputation fix concrete. */
  unansweredReviewCount: number | null;
}

type Candidate = Omit<SmbOverviewFix, "rank"> & { priority: number };

export function deriveOverviewFixes(input: OverviewFixInput): SmbOverviewFix[] {
  const candidates: Candidate[] = [];

  // Reputation — the highest-leverage, fastest-acting lever Maria controls.
  const unanswered = input.unansweredReviewCount ?? 0;
  if (unanswered > 0) {
    const lift = Math.min(0.9, 0.1 + 0.07 * unanswered).toFixed(1);
    candidates.push({
      priority: 1,
      section: "reputation",
      action: `Reply to ${unanswered} unanswered review${unanswered === 1 ? "" : "s"}`,
      meta: "Most businesses reply to about 89% · ~5 min each",
      impact: `+${lift}`,
      impactSub: "Mapsly Score",
      tone: "good",
    });
  } else if (input.reputation != null && input.reputation < STRONG_SCORE) {
    candidates.push({
      priority: 3,
      section: "reputation",
      action: "Ask your last 10 happy customers for a review",
      meta: "A quick ask after a good visit lifts your rating 0.2–0.3 points",
      impact: "+0.3",
      impactSub: "rating points",
      tone: "good",
    });
  }

  // Advertising — live-today growth when she isn't running ads.
  if (input.adsApplicable === false) {
    candidates.push({
      priority: 2,
      section: "advertising",
      action: "Turn on Google or Meta ads",
      meta: "Rivals near you run them · you can be live today",
      impact: "Fast",
      impactSub: "boost this week",
      tone: "good",
    });
  }

  // Profile — cheap, self-serve completeness wins.
  if (input.profile != null && input.profile < STRONG_SCORE) {
    candidates.push({
      priority: 4,
      section: "profile",
      action: "Fill in the missing parts of your Google profile",
      meta: "Photos, hours, and services help people find you · 10 min",
      impact: "+0.4",
      impactSub: "Mapsly Score",
      tone: "good",
    });
  }

  // Visibility — longer game; surface it as a steady-improvement nudge.
  if (input.visibility != null && input.visibility < STRONG_SCORE) {
    candidates.push({
      priority: 5,
      section: "visibility",
      action: "Climb the Google Maps results near you",
      meta: "Fresh photos, Sunday hours, and a weekly post are signals Google reads",
      impact: "+0.3",
      impactSub: "Mapsly Score",
      tone: "good",
    });
  }

  // Website — advisory (often a job for whoever built the site).
  if (input.website != null && input.website < STRONG_SCORE) {
    candidates.push({
      priority: 6,
      section: "website",
      action: "Speed up your website and fix what Google sees",
      meta: "A faster homepage keeps more first-time visitors from leaving",
      impact: "+0.3",
      impactSub: "Mapsly Score",
      tone: "good",
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);

  return candidates.slice(0, MAX_FIXES).map((c, i) => ({
    rank: i + 1,
    section: c.section,
    action: c.action,
    meta: c.meta,
    impact: c.impact,
    impactSub: c.impactSub,
    tone: c.tone,
  }));
}
