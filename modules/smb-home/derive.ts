/**
 * SMB overview · quick-win derivation (pure).
 *
 * `deriveOverviewFixes` reads the 5 section (pillar) scores + a couple of
 * raw signals and produces the prioritised quick-win list the right rail
 * renders — one fix per section at most, the highest-leverage first.
 *
 * Pillar-aligned by design: every fix maps to the section page Maria opens
 * to act on it (no legacy 6-dimension sub-scores). Pure (no IO) so the unit
 * tests run it against synthetic fixtures.
 *
 * IMPACT is MODEL-DERIVED, not guessed. The master Mapsly Score is a weighted
 * average over the MEASURED pillars, renormalised by their weight sum
 * (`modules/scoring/pillars.ts:372-380`), so a single pillar move lifts the
 * master by `Δpillar × PILLAR_WEIGHTS[p] / weightTotal`. We project each fix's
 * realistic pillar gain through that exact relation, clamp it to the pillar's
 * headroom, and label it "est." — so the number is reachable and consistent
 * with the score the page already shows (it never claims a physically
 * impossible lift, the way the old hard-coded constants did).
 *
 * Voice is Maria-first per `.claude/rules/copy-voice.md` — plain English,
 * outcome-first, no MSI / LCP / schema / NAP jargon.
 */

import { PILLAR_SCORE_MAX, PILLAR_WEIGHTS } from "@/modules/scoring";

import type { SmbOverviewFix } from "./types";
import { MAX_FIXES } from "./types";

/** A section scoring ≥ 7 is "Looking strong" (matches the pillar-tile state
 * labels). Below that — "Room to grow" (4–7) or "Needs attention" (< 4) — we
 * surface a quick win for it. So every not-yet-strong section gets advice;
 * the priority order + MAX_FIXES cap keep the highest-leverage ones on top. */
const STRONG_SCORE = 7;

/** Owner reply rate is `responsiveness`, weighted 0.25 of the reputation
 * pillar — a linear pass-through of the 0–1 reply rate
 * (`modules/scoring/pillars.ts` computeReputationPillar). Replying to every
 * review moves it to 1.0, so the reputation gain caps at `0.25 × 10`. */
const RESPONSIVENESS_WEIGHT = 0.25;

/** When we don't yet know the owner's reply rate, assume a middling 50% so the
 * reputation estimate is conservative (never the overstated "reply to all"
 * max). Scored businesses carry a real `replyRate` in `signalsJson`. */
const ASSUMED_REPLY_RATE = 0.5;

/** Input — the section scores + the raw signals that sharpen a fix. */
export interface OverviewFixInput {
  reputation: number | null;
  visibility: number | null;
  profile: number | null;
  website: number | null;
  advertising: number | null;
  adsApplicable: boolean | null;
  /** Reviews with no owner reply — makes the reputation fix concrete. */
  unansweredReviewCount: number | null;
  /** Current owner reply rate 0–1 (the scoring model's `signalsJson.replyRate`)
   * — drives the EXACT reputation lift from replying to every review. Null when
   * not yet measured (we then assume {@link ASSUMED_REPLY_RATE}). */
  replyRate: number | null;
}

type Candidate = Omit<SmbOverviewFix, "rank"> & { priority: number };

/** Sum of weights of the MEASURED pillars — the denominator the scoring pass
 * renormalises by. Advertising counts only when applicable
 * (`pillars.ts:369`); a null pillar is unmeasured and excluded. */
function measuredWeightTotal(input: OverviewFixInput): number {
  let wt = 0;
  if (input.reputation != null) wt += PILLAR_WEIGHTS.reputation;
  if (input.visibility != null) wt += PILLAR_WEIGHTS.visibility;
  if (input.profile != null) wt += PILLAR_WEIGHTS.profile;
  if (input.website != null) wt += PILLAR_WEIGHTS.website;
  if (input.adsApplicable === true && input.advertising != null) {
    wt += PILLAR_WEIGHTS.advertising;
  }
  return wt;
}

/** Format a master-score lift as "+X.X", floored at +0.1 so a real-but-small
 * gain still reads as a win (and never renders "+0.0"). */
function fmtLift(deltaMaster: number): string {
  const v = Math.max(0.1, Math.round(deltaMaster * 10) / 10);
  return `+${v.toFixed(1)}`;
}

export function deriveOverviewFixes(input: OverviewFixInput): SmbOverviewFix[] {
  const candidates: Candidate[] = [];

  const weightTotal = measuredWeightTotal(input);
  /** Master-score lift from moving pillar `p` by `deltaPillar`. */
  const masterLift = (deltaPillar: number, weight: number): number =>
    weightTotal > 0 ? (deltaPillar * weight) / weightTotal : 0;
  const headroom = (p: number): number => Math.max(0, PILLAR_SCORE_MAX - p);

  // Reputation — the highest-leverage, fastest-acting lever Maria controls.
  const unanswered = input.unansweredReviewCount ?? 0;
  if (unanswered > 0 && input.reputation != null) {
    // Replying to every review → responsiveness 1.0. Δreputation =
    // (1 − replyRate) × 0.25 × 10, clamped to the pillar's remaining headroom.
    const currentReply = input.replyRate ?? ASSUMED_REPLY_RATE;
    const deltaRep = Math.min(
      headroom(input.reputation),
      Math.max(0, 1 - currentReply) * RESPONSIVENESS_WEIGHT * PILLAR_SCORE_MAX,
    );
    const lift = masterLift(deltaRep, PILLAR_WEIGHTS.reputation);
    if (lift > 0.04) {
      candidates.push({
        priority: 1,
        section: "reputation",
        action: `Reply to ${unanswered} unanswered review${unanswered === 1 ? "" : "s"}`,
        meta: "Most businesses reply to about 89% · ~5 min each",
        impact: fmtLift(lift),
        impactSub: "est. Mapsly Score",
        tone: "good",
      });
    }
  } else if (input.reputation != null && input.reputation < STRONG_SCORE) {
    // No unanswered backlog, but reputation still soft — grow reviews. A
    // realistic ask closes ~half the remaining reputation gap.
    const lift = masterLift(
      headroom(input.reputation) / 2,
      PILLAR_WEIGHTS.reputation,
    );
    candidates.push({
      priority: 3,
      section: "reputation",
      action: "Ask your last 10 happy customers for a review",
      meta: "A steady trickle of fresh reviews lifts your reputation score",
      impact: fmtLift(lift),
      impactSub: "est. Mapsly Score",
      tone: "good",
    });
  }

  // Advertising — live-today growth when she isn't running ads. Qualitative on
  // purpose (the lift depends on spend + creative, which we don't model here).
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

  // Profile — cheap, self-serve completeness wins (≈ half the gap to strong).
  if (input.profile != null && input.profile < STRONG_SCORE) {
    candidates.push({
      priority: 4,
      section: "profile",
      action: "Fill in the missing parts of your Google profile",
      meta: "Photos, hours, and services help people find you · 10 min",
      impact: fmtLift(
        masterLift(headroom(input.profile) / 2, PILLAR_WEIGHTS.profile),
      ),
      impactSub: "est. Mapsly Score",
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
      impact: fmtLift(
        masterLift(headroom(input.visibility) / 2, PILLAR_WEIGHTS.visibility),
      ),
      impactSub: "est. Mapsly Score",
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
      impact: fmtLift(
        masterLift(headroom(input.website) / 2, PILLAR_WEIGHTS.website),
      ),
      impactSub: "est. Mapsly Score",
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
