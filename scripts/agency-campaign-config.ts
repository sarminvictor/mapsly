// scripts/agency-campaign-config.ts
//
// Side-effect-free shared constants for the Phase-1 agency campaign scripts.
// MUST NOT run any top-level code / process.exit — it's imported by
// agency-campaign-setup, agency-enroll, preview-agency-emails, and
// agency-test-send. (The bug this fixes: importing these from
// agency-campaign-setup.ts ran that file's main()+process.exit on import,
// killing the importing script before its own main().)

import type { ColdStepSeed } from "@/modules/cold/default-campaign";

export const AGENCY_CAMPAIGN_NAME =
  "Agency outreach · dental+medspa wave 1 (US)";

/**
 * The upgrade promo — lives ONLY in warm reply threads (the fulfillment
 * reply text), NEVER in the cold sequence bodies (deliverability: promo/$
 * language is a spam fingerprint on a warming domain). Created in Stripe
 * by Viktor 2026-07-22: $100 off, duration once, first-order-only, 50 max.
 */
export const PROMO = {
  code: "JULY26",
  /** Honest across all plans ($49–499): $100 off; ≤$100 plans → first month free. */
  line: "$100 off your first month",
} as const;

/**
 * v2 sequence (2026-07-22, after Viktor's copy review):
 * ONE focused message — "we already did your prospecting research; here is a
 * live audit as proof" — value shown, not promised. 3 touches:
 *   T1 (day 0)  proof: one real audit link + the market stat.
 *   T2 (+3d)    second audit + the offer (full market free for feedback).
 *   T3 (+8d)    breakup.
 * The deliverable behind "the full market" is real: on reply we comp the
 * agency's workspace (scripts/agency-comp.ts) so Target mode opens the seeded
 * market at $0.
 *
 * Tokens from ColdRecipient.context (v0.19.42): {{firstName}} {{agencyName}}
 * {{vertical}} {{marketLabel}} {{marketCity}} {{scoredCount}} {{evidenceLine}}
 * {{cellStats}} {{proofName1}} {{proofLine1}} {{proofUrl1}} {{proofName2}}
 * {{proofLine2}} {{proofUrl2}}. Spintax {{a|b}} varies bodies; tokens stay
 * OUTSIDE spin blocks. URLs sit on their own line (linkify requirement —
 * modules/cold/template.ts).
 */
export const AGENCY_STEPS: ColdStepSeed[] = [
  {
    stepOrder: 0,
    delayDays: 0,
    delayHours: 0,
    subjectTemplate:
      "scored {{scoredCount}} {{vertical}} businesses in {{marketCity}}",
    bodyTemplate: `{{Hi|Hey}} {{firstName}},

{{Last week I|I just}} scored every {{vertical}} business in {{marketCity}} — reviews, site speed, search rank, tech stack. Live data, not estimates.

One of them: {{proofName1}} — {{proofLine1}}. Here's the actual audit, no login:
{{proofUrl1}}

{{evidenceLine}} Every one of those is a warm opening for an agency like {{agencyName}}.

Worth a look at the rest?

{{senderFirstName}} · Mapsly`,
  },
  {
    // v3 (2026-07-24, after the wave-1 judge panel): OFFER-FIRST. The ask was
    // buried in paragraph 4 behind a demo of someone else's market; T1 already
    // spent the attention, so T2 leads with the deliverable and puts proof
    // underneath. Subject is fresh + one-word-answerable — the old
    // "re: {City} — the second audit" threaded onto a T1 most recipients never
    // opened (plausible-human open 6/35) and reads as fake-thread manipulation
    // to a marketer audience. Adds a national-agency fallback: many of these
    // shops sell across metros, and "which city" doesn't compute for them.
    stepOrder: 1,
    delayDays: 3,
    delayHours: 0,
    subjectTemplate: "{{agencyName}} — which city do you hunt in?",
    bodyTemplate: `{{Hi|Hey}} {{firstName}},

Straight to it: reply with the city you hunt in and I'll have every {{vertical}} business in it scored the same way — reviews, site speed, search rank, ads, contacts — inside Mapsly within a day. No call, no card. One word is enough.

{{Work nationally? Name the kind of practice you close best and I'll pull them across metros instead.|Sell nationally? Tell me the practice profile you close best and I'll pull those across metros instead.}}

{{marketCity}} was just the demo — one more from it: {{proofName2}} — {{proofLine2}}
{{proofUrl2}}

I can turn around about five of these this week.

{{senderFirstName}} · Mapsly`,
  },
  {
    stepOrder: 2,
    delayDays: 5,
    delayHours: 0,
    subjectTemplate: "last note, {{firstName}}",
    bodyTemplate: `{{Hi|Hey}} {{firstName}},

Last note — the offer stands: {{name the city you hunt in|one line with your target city}}, and every {{vertical}} business in it gets scored in Mapsly within a day: reviews, site speed, search rank, ads, contacts.

{{If you'd rather poke around first, a free account gets you 50 leads with contacts, no card|Or just try it yourself — free account, 50 leads with contacts, no card}}:
https://www.mapsly.ai/for-agencies

{{If prospecting isn't on the menu this quarter, ignore me — no more emails.|Not the quarter for it? No worries — this is my last note.}}

{{senderFirstName}} · Mapsly`,
  },
];

// ── Signal-based evidence phrasing (v3 · Viktor: "use our Signals, not raw") ──
//
// Each phrase renders ONE market-level signal count in agency language. The
// composer picks the top-priority phrases whose fire-rate is credible (a
// signal firing for ~100% of a market reads as fishy — except no_booking,
// where near-total absence is the true, valuable story).

export interface SignalPhrase {
  key: string;
  /** Lower = more valuable to an agency pitch. */
  priority: number;
  /** Skip when fired/applicable exceeds this (default 0.9). */
  maxRatio?: number;
  phrase: (n: number) => string;
}

export const SIGNAL_PHRASES: SignalPhrase[] = [
  {
    key: "unanswered_1star",
    priority: 1,
    phrase: (n) => `${n} have 1★ reviews sitting unanswered`,
  },
  {
    key: "reputation_slipping",
    priority: 2,
    phrase: (n) => `${n} have ratings actively slipping`,
  },
  {
    key: "not_advertising",
    priority: 3,
    phrase: (n) => `${n} run zero ads while competitors in the market do`,
  },
  {
    key: "no_booking",
    priority: 4,
    maxRatio: 1.0,
    phrase: (n) => `${n} take no online bookings`,
  },
  {
    key: "low_reply_rate",
    priority: 5,
    phrase: (n) => `${n} barely reply to reviews`,
  },
  {
    key: "slow_site",
    priority: 6,
    phrase: (n) => `${n} have sites loading 4s+ on mobile`,
  },
  {
    key: "flying_blind",
    priority: 7,
    phrase: (n) => `${n} run no analytics or ad pixel at all`,
  },
  {
    key: "reviews_slowing",
    priority: 8,
    phrase: (n) => `${n} have review flow drying up`,
  },
  {
    key: "not_in_local_pack",
    priority: 9,
    maxRatio: 0.85,
    phrase: (n) => `${n} never show in the local 3-pack`,
  },
  {
    key: "stale_reviews",
    priority: 10,
    phrase: (n) => `${n} haven't seen a review in months`,
  },
];

/** Compose evidenceLine + cellStats from market signal counts. */
export function composeSignalEvidence(ev: {
  total: number;
  fired: Record<string, number>;
  applicable: Record<string, number>;
}): { evidenceLine: string; cellStats: string } | null {
  const picks: { phrase: string; short: string }[] = [];
  for (const p of [...SIGNAL_PHRASES].sort((a, b) => a.priority - b.priority)) {
    const n = ev.fired[p.key] ?? 0;
    const app = ev.applicable[p.key] ?? 0;
    if (n < 3 || app === 0) continue;
    if (n / app > (p.maxRatio ?? 0.9)) continue;
    // "zero ads while competitors do" is only TRUE where competitors actually
    // advertise (Boise: 0 advertisers → the phrase would be a lie there).
    if (
      p.key === "not_advertising" &&
      (ev.fired["competitors_advertising"] ?? 0) < 3
    )
      continue;
    picks.push({ phrase: p.phrase(n), short: p.phrase(n) });
    if (picks.length === 3) break;
  }
  if (picks.length === 0) return null;
  const list = picks.map((p) => p.phrase);
  const evidenceLine =
    `Of ${ev.total} scored: ` +
    (list.length === 1
      ? `${list[0]}.`
      : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}.`);
  const cellStats = `${ev.total} businesses scored · ${list.join(" · ")}`;
  return { evidenceLine, cellStats };
}

/** Per-market proof businesses — fired SIGNALS verified via the product's own
 *  signal engine (scripts/agency-signal-evidence.ts CLI, 2026-07-22) so every
 *  claim matches the verdicts the linked pack renders. Raw anchors (review
 *  counts, load times) verified on the live /s/ pages. */
export interface MarketProof {
  name: string;
  url: string;
  line: string;
}

export const MARKET_PROOFS: Record<string, [MarketProof, MarketProof]> = {
  Scottsdale: [
    {
      // fired: low_reply_rate, unanswered_1star, reviews_slowing,
      // reputation_slipping, no_booking, not_in_local_pack
      name: "CraftMD Aesthetics/Wellness",
      url: "https://www.mapsly.ai/s/6430772897658915",
      line: "4.9★ with 274 reviews, but the owner replies to 7%, 1★ reviews sit unanswered, review flow is slowing, and there's no online booking",
    },
    {
      // fired: unanswered_1star, reputation_slipping, no_booking, no_tracking_pixel
      name: "Beautify Spa",
      url: "https://www.mapsly.ai/s/6321363315897087",
      line: "377 reviews, but the rating is slipping, 1★ reviews sit unanswered, and the site runs no ad pixel",
    },
  ],
  Boise: [
    {
      // fired: slow_site, overdue_redesign, not_in_local_pack
      name: "Spa 35 Med Spa",
      url: "https://www.mapsly.ai/s/6199285313089507",
      line: "729 reviews, but the site scores 29/100 on mobile, takes 21s to load, and the business never shows in the local 3-pack",
    },
    {
      // fired: unanswered_1star, reputation_slipping, no_booking, not_in_local_pack
      name: "Dermatology Clinic of Idaho",
      url: "https://www.mapsly.ai/s/8453188494881221",
      line: "1,667 reviews, but the rating is slipping, 1★ reviews sit unanswered, and there's no online booking",
    },
  ],
  Miami: [
    {
      // fired: unanswered_1star, reputation_slipping, slow_site, not_in_local_pack
      name: "Dermaclinic Miami",
      url: "https://www.mapsly.ai/s/2568231148981892",
      line: "1,054 reviews, but the rating is slipping, 1★ reviews sit unanswered, and the site takes 30s to load on a phone",
    },
    {
      // fired: unanswered_1star, reputation_slipping, slow_site, not_in_local_pack
      name: "Spectrum Aesthetics",
      url: "https://www.mapsly.ai/s/8633039370556510",
      line: "3,494 reviews, but the rating is slipping, 1★ reviews sit unanswered, and mobile performance scores 38/100",
    },
  ],
  Austin: [
    {
      // fired: unanswered_1star, reputation_slipping, no_booking,
      // not_in_local_pack, no_tracking_pixel (slow_site did NOT fire — don't claim it)
      name: "Austin Emergency Dental",
      url: "https://www.mapsly.ai/s/3475001887790163",
      line: "756 reviews, but 1★ reviews sit unanswered, the rating is slipping, there's no online booking and no ad pixel",
    },
    {
      // fired: unanswered_1star, reputation_slipping, slow_site,
      // no_booking, not_in_local_pack, no_tracking_pixel
      name: "TRU Dentistry Austin",
      url: "https://www.mapsly.ai/s/9903602974196407",
      line: "494 reviews, but the site takes 18s to load, there's no online booking, no ad pixel, and the rating is slipping",
    },
  ],
  Frisco: [
    {
      // fired: low_reply_rate, unanswered_1star, reputation_slipping,
      // no_booking, no_tracking_pixel, flying_blind + LH 2026-07-22: lcp 34.9s
      name: "Celina Family Dentistry",
      url: "https://www.mapsly.ai/s/5952229165195909",
      line: "650 reviews, but the owner replies to about 1 in 10, the site takes 35 seconds to load on a phone, and there's no online booking",
    },
    {
      // fired: low_reply_rate, reputation_slipping, not_in_local_pack
      name: "Frisco Smiles Dentistry",
      url: "https://www.mapsly.ai/s/8735555934358913",
      line: "387 reviews without a single owner reply, and the rating is slipping",
    },
  ],
};
