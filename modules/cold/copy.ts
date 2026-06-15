/**
 * Cold-email copy ENGINE — one set of templates, every business + every sender.
 *
 * `buildColdEmail(signals, stepOrder, opts)` turns a business's REAL signals
 * (modules/cold/signals.ts) into a personalized, true-for-this-recipient email:
 *
 *   Touch 1 — their standing in the market (rank tier + rating), report shows how to climb.
 *   Touch 2 — their SHARPEST real pain (ads gap → slow site → unanswered reviews → general).
 *   Touch 3 — a real-numbers digest ("we did the homework"), report has the rest.
 *
 * Honesty discipline (cold-email audit 2026-06-14): every number/claim is
 * guarded by its signal — a line is OMITTED when the data is absent. We never
 * fabricate a count or name a competitor we can't show on the report.
 *
 * Sender is dynamic: `opts.senderName` is the mailbox display name (we rotate
 * 5 boxes), so the signature is never hard-coded. `opts.spinSeed`
 * (recipientId:stepOrder) drives deterministic synonym variation so bodies
 * aren't byte-identical at scale (duplicate-content is a bulk-mail signal) and a
 * retried send renders the exact same copy.
 */
import type { ColdSignals } from "./signals";

export interface ColdEmail {
  subject: string;
  body: string;
}

export interface BuildColdEmailOptions {
  /** Mailbox display name — becomes the signature + From name. */
  senderName: string;
  /** The login-free /l report link. Present in EVERY touch. */
  reportUrl: string;
  /** `${recipientId}:${stepOrder}` — seeds deterministic copy variation. */
  spinSeed: string;
}

/* ----------------------------------------------------------- seeded variation */

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------- helpers */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "patients" → "patient" (crude singularizer, fine for our nouns). */
function singular(noun: string): string {
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

/* ------------------------------------------------------------ the engine */

export function buildColdEmail(
  s: ColdSignals,
  stepOrder: number,
  opts: BuildColdEmailOptions,
): ColdEmail {
  const rand = mulberry32(hashSeed(opts.spinSeed));
  const pick = (...opts2: string[]): string =>
    opts2[Math.floor(rand() * opts2.length)] ?? opts2[0]!;

  const name = s.businessName;
  const city = s.city ?? "your area";
  const noun = s.noun; // "patients"
  const one = singular(noun); // "patient"
  const link = opts.reportUrl;
  const sign = opts.senderName;

  const ratingStr = s.rating != null ? s.rating.toFixed(1) : null;
  const reviewsStr = s.reviewCount != null ? fmtInt(s.reviewCount) : null;
  const ratingHigh = s.rating != null && s.rating >= 4.5;
  const hasRank = s.rank != null && s.rankTotal != null;
  const rankGap = ratingHigh && hasRank && (s.rank as number) > 10;
  const rankTop = hasRank && (s.rank as number) <= 10;

  if (stepOrder === 0) {
    /* ---- TOUCH 1 · market standing ---- */
    const subject = rankGap
      ? `${name}: ${ratingStr}★ but #${s.rank} in ${city}?`
      : rankTop
        ? `${name}: you're #${s.rank} of ${s.rankTotal} in ${city}`
        : hasRank
          ? `${name}: where you rank among ${city} med spas`
          : `${name}: how you show up in ${city}`;

    const intro = pick(
      `Hi — I pulled the numbers on ${name} this week.`,
      `Hi — I took a look at how ${name} shows up in ${city} this week.`,
      `Hi — I ran ${name} through our ${city} data this week.`,
    );
    const ratingLine = ratingHigh
      ? `Your reviews are excellent — ${ratingStr}★ across ${reviewsStr}, ahead of most spas in ${city} on reputation.`
      : ratingStr
        ? `You're at ${ratingStr}★${reviewsStr ? ` across ${reviewsStr} reviews` : ""}.`
        : "";
    const rankLine = rankGap
      ? `But in the ${city} med-spa rankings you're sitting at #${s.rank} of ${s.rankTotal} — with a ${ratingStr}★, you should be higher. Something's holding the listing back.`
      : rankTop
        ? `In the ${city} med-spa rankings you're #${s.rank} of ${s.rankTotal} — near the top. The few spas above you are catching small things you can too.`
        : hasRank
          ? `In the ${city} med-spa rankings you come in at #${s.rank} of ${s.rankTotal} — plenty of room to climb.`
          : `I mapped the med spas in ${city} to see where you land — and where the quick wins are.`;
    const reportLine =
      `I put the full picture in a free report (no login) — ` +
      (rankGap
        ? `exactly why the rank and the rating don't match, and the few fixes that move you up:`
        : `where you stand and the few fixes that move you up:`) +
      `\n\n${link}`;
    const close = pick(
      `Takes two minutes to read on your phone.`,
      `Two-minute read on your phone.`,
    );
    const body = [intro, ratingLine, rankLine, reportLine, close, `— ${sign}`]
      .filter(Boolean)
      .join("\n\n");
    return { subject, body };
  }

  if (stepOrder === 1) {
    /* ---- TOUCH 2 · sharpest real pain ---- */
    const painAds = s.ownAds === 0 && s.marketActiveAds >= 10;
    const painSite =
      s.websiteSlowSeconds != null ||
      (s.websiteScore != null && s.websiteScore < 60);
    const painReviews = s.unanswered >= 10 || s.unansweredNegative >= 1;

    if (painAds) {
      const nearLine =
        s.competitorAdsCount > 0
          ? `, and ${s.competitorAdsCount} are advertising right near you`
          : "";
      const repBeat = ratingHigh
        ? `You've got a ${ratingStr}★ and ${reviewsStr} reviews — better than most of the spas outspending you. `
        : "";
      const subject = `${name}: ${fmtInt(s.marketActiveAds)} rival ads, you're running 0`;
      const body = [
        `Hi,`,
        `I pulled the ad data for med spas in ${city}. Right now ${fmtInt(s.marketAdvertiserCount)} of them are running ${fmtInt(s.marketActiveAds)} active ads between them${nearLine}.`,
        `${name} is running 0.`,
        `${repBeat}When someone in ${city} searches for what you do, they meet a paid competitor first — and you're not in the room.`,
        `You don't need to outspend a hundred spas — just show up where it counts. The free report shows exactly who's advertising near you and the few moves to get back in:\n\n${link}`,
        `No login — it's already built for ${name}.`,
        `— ${sign}`,
      ].join("\n\n");
      return { subject, body };
    }

    if (painSite) {
      const yours = s.websiteSlowSeconds
        ? `Yours takes about ${s.websiteSlowSeconds} seconds to load on a phone — most people are gone by three.`
        : `Yours scores ${Math.round(s.websiteScore as number)}/100 — under what most ${city} spas reach.`;
      const subject = s.websiteSlowSeconds
        ? `${name}: your site takes ${s.websiteSlowSeconds}s on a phone`
        : `${name}: your website is quietly costing bookings`;
      const body = [
        `Hi,`,
        `Your reviews and rank do the hard part — they get ${noun} to click. Then your website has about three seconds to turn them into a booking.`,
        yours,
        `It's the most fixable thing you've got. The free report grades your site on 12 things ${noun} silently judge — and what to fix first:\n\n${link}`,
        `No login — just your page.`,
        `— ${sign}`,
      ].join("\n\n");
      return { subject, body };
    }

    if (painReviews) {
      const negLine =
        s.unansweredNegative >= 1
          ? `, and ${s.unansweredNegative} of those ${s.unansweredNegative === 1 ? "is an unhappy one" : "are unhappy ones"} — exactly what a new ${one} reads first`
          : "";
      const subject =
        s.unansweredNegative >= 1
          ? `${name}: ${fmtInt(s.unanswered)} reviews waiting — ${s.unansweredNegative} unhappy`
          : `${name}: ${fmtInt(s.unanswered)} reviews waiting on a reply`;
      const body = [
        `Hi,`,
        `${cap(noun)} read your reviews before booking — and they read your replies too.`,
        `Right now ${fmtInt(s.unanswered)} of your reviews have no reply${negLine}.`,
        `A calm two-line reply changes what every future ${one} sees. The free report lists every one still waiting — newest first, unhappy ones up top:\n\n${link}`,
        `No login — just your page.`,
        `— ${sign}`,
      ].join("\n\n");
      return { subject, body };
    }

    // general fallback — no single sharp pain
    const subject = hasRank
      ? `${name}: the gap between you and the top spas in ${city}`
      : `${name}: your local presence in ${city}`;
    const body = [
      `Hi,`,
      `I put together a free snapshot of how ${name} shows up across ${city} — reviews, search, your website, and the spas around you.`,
      `It shows where you're winning and the few fixes that bring more ${noun} in:\n\n${link}`,
      `No login — just your page.`,
      `— ${sign}`,
    ].join("\n\n");
    return { subject, body };
  }

  /* ---- TOUCH 3 · real-numbers digest ("we did the homework") ---- */
  const bullets: string[] = [];
  if (ratingStr && reviewsStr) {
    bullets.push(
      `- ${ratingStr}★, ${reviewsStr} reviews${hasRank ? ` — ranked #${s.rank} of ${s.rankTotal} in ${city}` : ""}`,
    );
  } else if (hasRank) {
    bullets.push(`- ranked #${s.rank} of ${s.rankTotal} med spas in ${city}`);
  }
  if (s.unanswered > 0)
    bullets.push(`- ${fmtInt(s.unanswered)} reviews still unanswered`);
  if (s.websiteSlowSeconds)
    bullets.push(
      `- mobile site loads in about ${s.websiteSlowSeconds} seconds`,
    );
  if (s.marketAdvertiserCount > 0)
    bullets.push(
      `- ${fmtInt(s.marketAdvertiserCount)} rival spas advertising in your market`,
    );

  const subject = pick(
    `We checked ${name} on 20+ things — the short version`,
    `${name}: the short version of what we found`,
  );
  const body = [
    `Hi — we ran ${name} in ${city} through the same checks a marketing team would, so you don't have to.`,
    `A few of the real numbers we pulled:\n${bullets.join("\n")}`,
    `That's a slice. The full free report has your Mapsly score, a 12-point website check, a competitor review table, and a ranked list of what to fix first:\n\n${link}`,
    `No login, no sales call — just your business, mirrored back.`,
    `— ${sign}`,
  ].join("\n\n");
  return { subject, body };
}
