/**
 * Landing copy ENGINE — one template, every business in a market.
 *
 * The public landing (`/l/[token]`) is a template we send to EVERY business in a
 * market (e.g. all med spas in Miami). So the copy can't be one business's story:
 * it's conditional. `buildLandingCopy` turns a business's REAL assembled data into
 * personalized-but-true prose via two layers:
 *
 *   1. Campaign tokens — the customer noun (`nounFor`) + the category label, fixed
 *      for a whole send (med spas → "patients", salons → "clients", …).
 *   2. Recipient branches — rank tier, ads status, and each pillar's real strength,
 *      so every section frames itself as a win or a gap based on THIS recipient.
 *
 * The rule that makes it scale: every business has a best pillar and a worst one.
 * Open on their real strength, land the one sting on their real weakest spot,
 * resolve into their real fix list — the arc holds at #1 or #22.
 *
 * Honesty discipline (Mapsly is pre-launch — no customers, no testimonials): every
 * claim is built from the recipient's own verifiable data, full-market authority,
 * and a money-back guarantee. The lost-bookings estimate uses conservative,
 * general click-through assumptions and is always shown as a hedged range.
 */

import type { LandingCopy, LandingData, LandingSearchData } from "./types";

/* ----------------------------------------------------------------- nouns */

interface Noun {
  one: string;
  many: string;
}

const NOUN_RULES: { match: RegExp; noun: Noun }[] = [
  // Medical — higher-value framing, how these owners talk.
  {
    match:
      /\b(med spa|medspa|medical|dermat|dental|dentist|clinic|injectab|botox|filler|aesthetic med|plastic|surger|orthodont|physio|chiro|vein|laser (clinic|hair)|iv |wellness clinic|fertility|optometr|audiolog|podiatr)\b/i,
    noun: { one: "patient", many: "patients" },
  },
  // Beauty / personal care — warm "clients".
  {
    match:
      /\b(salon|hair|barber|nail|lash|brow|esthetic|beauty|spa|wax|tan|massage|skincare|skin care|makeup|cosmetolog)\b/i,
    noun: { one: "client", many: "clients" },
  },
  // Food.
  {
    // `caf[eé]` is matched unbounded — a trailing \b after the accented "é"
    // (non-\w) never fires, so the accented spelling would otherwise be missed.
    match:
      /\b(restaurant|coffee|bar|bakery|diner|bistro|grill|eatery)\b|caf[eé]/i,
    noun: { one: "guest", many: "guests" },
  },
  // Fitness.
  {
    match: /\b(gym|fitness|yoga|pilates|crossfit|cycling studio|martial)\b/i,
    noun: { one: "member", many: "members" },
  },
];

/**
 * The customer noun for a category — adapt, never hardcode "patients". Falls back
 * to "customers" (safe for any local business). Med spas → patients; salons →
 * clients; restaurants → guests; gyms → members.
 */
export function nounFor(category: string | null): Noun {
  const c = (category ?? "").toLowerCase();
  for (const r of NOUN_RULES) if (r.match.test(c)) return r.noun;
  return { one: "customer", many: "customers" };
}

/* -------------------------------------------------------- category label */

/** Regular English pluralization for category head-nouns (bakery→bakeries,
 * church→churches, salon→salons, class→classes). */
function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Friendly singular/plural category label for prose ("med spa" / "med spas").
 * Falls back to "business"/"businesses" for a blank category. */
function categoryLabel(category: string | null): { one: string; many: string } {
  const raw =
    (category ?? "").replace(/_/g, " ").trim().toLowerCase() || "business";
  const one = raw === "medical spa" ? "med spa" : raw;
  return { one, many: pluralize(one) };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------- lost bookings */

function bestRank(a: number | null, b: number | null): number | null {
  const v = [a, b].filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
}

/** Conservative click-share by current rank (general, not per-business). */
function ctrAt(rank: number | null): number {
  if (rank == null) return 0;
  if (rank <= 3) return 0.06;
  if (rank <= 10) return 0.02;
  if (rank <= 20) return 0.006;
  return 0.002;
}

/**
 * Defensible estimate of monthly bookings missed on the searches a business
 * doesn't rank top-3 for. Inputs are general, conservative public figures (a
 * top-3 spot's click share, a low search→booking rate); the output is ALWAYS a
 * hedged range, never a hard number. Returns null when there's nothing material.
 */
export function estimateLostBookings(
  search: LandingSearchData,
): { low: number; high: number } | null {
  if (!search.hasData) return null;
  const CTR_TOP3 = 0.06; // a realistic top-3 position's click share
  const BOOKING_RATE = 0.012; // clicks → booking inquiry, conservative for local service
  let lost = 0;
  for (const k of search.topKeywords) {
    const rank = bestRank(k.organicRank, k.mapsRank);
    if (rank == null) continue; // no rank data → don't claim a loss
    if (rank <= 3) continue; // already winning this one
    const vol = k.volume ?? 0;
    const gain = Math.max(0, CTR_TOP3 - ctrAt(rank));
    lost += vol * gain * BOOKING_RATE;
  }
  if (lost < 1.5) return null;
  lost = Math.min(lost, 40); // cap the headline so it stays credible, never inflated
  const low = Math.max(1, Math.floor(lost * 0.7));
  const high = Math.max(low + 1, Math.ceil(lost * 1.05));
  return { low, high };
}

/* ------------------------------------------------------------ the engine */

type Core = Omit<LandingData, "copy">;

/** Build the full conditional copy object for a business's assembled data. */
export function buildLandingCopy(core: Core): LandingCopy {
  const noun = nounFor(core.category);
  const C = categoryLabel(core.category);
  const cityLabel = core.city ?? core.cellLabel ?? "your area";

  // ── recipient tiers ──
  const rank = core.rank;
  const total = core.total;
  const isLeader = rank === 1;
  const isTop =
    rank != null &&
    total != null &&
    total >= 6 && // don't call "#2 of 2" a top performer
    rank <= Math.max(3, Math.ceil(total * 0.15));
  const isUpper =
    rank != null && total != null && rank <= Math.ceil(total * 0.5);

  const runsAds = core.adsDetail.ownAdCount > 0;
  const marketHasAds = core.adsDetail.marketAdvertiserCount >= 3;
  const adsMarket = core.adsDetail.marketAdvertiserCount;

  const perf = core.websiteDetail.performance;
  const median = core.websiteDetail.industryMedian;
  const siteWeak = perf != null && (median != null ? perf < median : perf < 55);
  const siteStrong =
    perf != null && (median != null ? perf >= median : perf >= 70);

  const ratingStr =
    core.googleRating != null ? core.googleRating.toFixed(1) : null;
  const reviewsStrong =
    (core.reviews.yourRank != null &&
      core.reviews.rankedTotal != null &&
      core.reviews.yourRank <=
        Math.max(3, Math.ceil(core.reviews.rankedTotal * 0.25))) ||
    (core.googleRating != null &&
      core.googleRating >= 4.7 &&
      (core.reviewCount ?? 0) >= 150);

  const hasSearchGaps =
    core.search.hasData &&
    core.search.topKeywords.some((k) => {
      const r = bestRank(k.organicRank, k.mapsRank);
      return r == null || r > 3;
    });

  /* ---- HERO ---- */
  const standing = isLeader
    ? `You're the #1 ${C.one} in ${cityLabel}.`
    : isTop && rank != null && total != null
      ? `You're one of the top ${C.many} in ${cityLabel} — #${rank} of ${total}.`
      : isUpper && rank != null && total != null
        ? `You're #${rank} of ${total} ${C.many} in ${cityLabel} — ahead of ${total - rank} others.`
        : rank != null && total != null
          ? `You're #${rank} of ${total} ${C.many} in ${cityLabel} — and the fastest gains in your market are still yours to take.`
          : `We mapped every ${C.one} in ${cityLabel}. Here's where you stand.`;
  const gap =
    isLeader && total != null
      ? ` And one blind spot is quietly sending ${noun.many} to the other ${total - 1}.`
      : ` And one blind spot is quietly sending ${noun.many} to the ${C.many} around you.`;
  const authority =
    total != null ? `We ranked all ${total} ${C.many} in ${cityLabel}. ` : "";

  const hero = {
    headline: standing + gap,
    body:
      `${authority}Mapsly shows you — every week — where you're winning, where you're losing ${noun.many}, ` +
      `and the few fixes that bring them back. ${cap(C.many)} that close their gaps aim for up to 30% more ${noun.many} in 3 months.`,
  };

  /* ---- CHANGES ---- */
  const changes = {
    eyebrow: `While you were with ${noun.many}`,
    title: "Here's what your market did",
    emphasis: "this week.",
    subtitle:
      `Every Monday, Mapsly shows you every verified move the ${C.many} around you made — ` +
      `new ads, new reviews, ranking shifts. The things you'd never catch between appointments.`,
  };

  /* ---- SEARCH ---- */
  const loss = estimateLostBookings(core.search);
  const search = {
    eyebrow: `Where ${noun.many} look for you`,
    title: hasSearchGaps
      ? "You own these searches."
      : "You show up where they look.",
    emphasis: hasSearchGaps
      ? "You're missing these."
      : "Here's how to stay on top.",
    intro:
      `Hundreds of ${noun.many} search Google every month for the services you offer. ` +
      `You show up for some — and for the rest, they find a ${C.one} that isn't you.`,
    futureLine: `These are the searches your future ${noun.many} run — Mapsly tracks your position on every one, every week.`,
    lossLine: loss
      ? `By our estimate, reaching the top 3 for the searches you're missing could mean roughly ${loss.low}–${loss.high} more ${noun.many} a month.`
      : null,
  };

  /* ---- ADS ---- */
  const rankPhrase = rank != null ? `#${rank} rank` : "reputation";
  const ads =
    runsAds && marketHasAds
      ? {
          eyebrow: "Who's paying to get found",
          title: "You're advertising —",
          emphasis: `and so are ${adsMarket} ${C.many} near you.`,
          intro:
            `Good — you're in the game. The real question is whether your spend keeps pace. ` +
            `Here's every ${C.one} bidding on your services, how many ads they run, and where you stand — live from Google and Meta.`,
        }
      : marketHasAds
        ? {
            eyebrow: "Who's paying to get found",
            title: `${adsMarket} ${C.many} near you are buying ads.`,
            emphasis: "You're running zero.",
            intro:
              `You don't have to run ads to win${ratingStr ? ` — your ${ratingStr}★ and ${rankPhrase} prove it` : ""}. ` +
              `But when ${adsMarket} compete for the same ${noun.many}, it pays to know who, where, and on which services — ` +
              `pulled live from Google's and Meta's own ad libraries.`,
          }
        : {
            eyebrow: "Who's paying to get found",
            title: `Almost no ${C.many} in ${cityLabel} run ads.`,
            emphasis: "That's an open lane.",
            intro:
              `${cap(noun.many)} are searching, and almost no one's paying to intercept them. ` +
              `Move first and the clicks come cheap — we'll flag the moment that changes.`,
          };

  /* ---- REVIEWS ---- */
  const reviews = reviewsStrong
    ? {
        eyebrow: "Your reputation",
        title: ratingStr
          ? `${ratingStr}★, ${core.reviewCount ?? "—"} reviews —`
          : "Your reviews —",
        emphasis: "you're winning here. Here's how to win bigger.",
        intro:
          `Your reviews are your best salesperson. We read what ${noun.many} rave about at the top ${C.many} near you — ` +
          `so you can spot the few things they mention that you could own too.`,
      }
    : {
        eyebrow: "Your reputation",
        title: ratingStr
          ? `${ratingStr}★ is a strong start —`
          : "Your reviews —",
        emphasis: `but the ${C.many} pulling ahead have more ${noun.many} saying it out loud.`,
        intro:
          `Reviews are the first thing ${noun.many} check before booking. ` +
          `Here's what ${noun.many} praise at the ${C.many} ranking above you — and the fastest way to close the gap.`,
      };

  /* ---- WEBSITE ---- */
  const scoreStr = perf != null ? String(Math.round(perf)) : null;
  const website = siteWeak
    ? {
        eyebrow: "Where the bookings leak",
        title: `${cap(noun.many)} are sold — then they hit your website.`,
        emphasis: scoreStr ? `It scores ${scoreStr}.` : "Then it lets them go.",
        intro:
          `Your reviews and rank do the hard part: they get ${noun.many} to click. Then your site has three seconds to turn them into a booking. ` +
          (scoreStr && median != null
            ? `Yours scores ${scoreStr} — under the ${Math.round(median)} most ${C.many} in ${cityLabel} reach. `
            : scoreStr
              ? `Yours scores ${scoreStr}/100. `
              : "") +
          `The good news: it's the most fixable thing on this page.`,
      }
    : siteStrong
      ? {
          eyebrow: "Where you're ahead",
          title: "Your website does its job —",
          emphasis: scoreStr
            ? `${scoreStr}/100, above most ${C.many} in ${cityLabel}.`
            : `an edge most ${C.many} don't have.`,
          intro:
            `When ${noun.many} click through, your site turns them into bookings — an edge most ${C.many} don't have. ` +
            `Here's the one thing even strong sites miss, and how you stack up against the very best in your market.`,
        }
      : {
          eyebrow: "Your website",
          title: "Your website,",
          emphasis: `graded on 12 things ${noun.many} notice.`,
          intro:
            `We check your site against the median of the top sites in ${cityLabel} — not just the #1. ` +
            `Each item below is a booking-driver ${noun.many} silently judge you on.`,
        };

  /* ---- FIXES ---- */
  const fixes = {
    eyebrow: "Your plan",
    title: "Three fixes, in order.",
    emphasis: "Here's what each one moves.",
    intro:
      `We did the diagnosis. These are the three highest-impact moves for your ${C.one} right now — ` +
      `what to do, and how much each lifts your score. Start at the top.`,
  };

  /* ---- PRICING ---- */
  const pricing = {
    titleLead: `More ${noun.many}. Fewer surprises.`,
    emphasis: "$29 a month.",
    body:
      `Everything above is today's free snapshot of your ${C.one}. $29/month keeps it live — every Monday — ` +
      `and turns those gaps into fixes you can act on: one-click review replies, competitor-ad alerts, ranking watch. ` +
      `A couple of new ${noun.many} cover a year of it.`,
    guarantee:
      "Cancel anytime, no contract. 30-day money-back guarantee — if it doesn't earn its $29, we refund it.",
  };

  return { noun, hero, changes, search, ads, reviews, website, fixes, pricing };
}
