// components/marketing/comparisons/comparison-data.ts · WP6-7 positioning data.
//
// The one-liner + the three competitor comparison specs. Copy is in the AGENCY
// voice (tool-y, precise, jargon-OK, numbers over adjectives — see
// .claude/rules/ui-ux-agency.md + copy-voice.md). English-only; no i18n keys
// yet (marked for translation as a follow-up per .claude/rules/i18n.md — this
// is static marketing copy the human reviews).
//
// Each spec hits that camp's DOCUMENTED weakness and shows a
// signal-COMBINATION example the competitor structurally can't produce — the
// moat is combining local-business signals (ads-without-pixel,
// stale-creative + homepage-landing, unanswered-1★ + complaint-theme), not
// any single field.

/** The positioning one-liner — reused as the shared meta/hero backbone. */
export const POSITIONING_ONE_LINER =
  "Apollo tells you a company exists. Mapsly tells you why a local business needs you right now — with the signal combination to prove it.";

export interface ComparisonExample {
  /** The signals combined (rendered as mono chips). */
  signals: string[];
  /** The pitch angle this combination unlocks. */
  title: string;
  /** Why the competitor can't produce it. */
  body: string;
}

export interface ComparisonRow {
  /** Row label (the dimension). */
  dimension: string;
  /** Mapsly's answer. */
  mapsly: string;
  /** The competitor's answer. */
  them: string;
}

export interface ComparisonSpec {
  /** URL slug segment under /compare/. */
  slug: "mapsly-vs-apollo" | "mapsly-vs-gohighlevel" | "mapsly-vs-leadswift-d7";
  /** Competitor display name. */
  competitor: string;
  /** <title> / OG title. */
  metaTitle: string;
  /** Meta description (150–160 chars). */
  metaDescription: string;
  /** Eyebrow chip label. */
  eyebrow: string;
  /** H1. */
  h1: string;
  /** Lede paragraph under the H1. */
  lede: string;
  /** The competitor's documented weakness (callout). */
  weaknessTitle: string;
  weaknessBody: string;
  /** Signal-combination examples the competitor can't produce. */
  examples: ComparisonExample[];
  /** Head-to-head table caption. */
  tableCaption: string;
  /** Head-to-head rows. */
  rows: ComparisonRow[];
  /** CTA heading + sub. */
  ctaTitle: string;
  ctaSub: string;
}

export const COMPARISONS: Record<ComparisonSpec["slug"], ComparisonSpec> = {
  "mapsly-vs-apollo": {
    slug: "mapsly-vs-apollo",
    competitor: "Apollo",
    metaTitle: "Mapsly vs Apollo — local-business intent Apollo can't see",
    metaDescription:
      "Apollo has 275M B2B contacts but no local signals. Mapsly finds local businesses by ads-without-pixel, slow LCP, unanswered 1★ reviews — with proof.",
    eyebrow: "Mapsly vs Apollo",
    h1: "Apollo finds companies. Mapsly finds a reason to call.",
    lede: "Apollo is a B2B contact database — 275M+ records, firmographics, org charts. For a local-marketing agency that's the wrong shape: it tells you a med-spa exists, not that its site loads in 6.2s, its Meta ads run with no pixel, and its last three 1★ reviews all cite the same front-desk complaint.",
    weaknessTitle: "Apollo's blind spot: it has no local signal layer",
    weaknessBody:
      "Apollo indexes companies for SDRs selling software — job titles, headcount, tech stack at the corporate level. It has no view of a local business's Google reviews, local-pack rank, Lighthouse performance, or live Meta ad creative. You can buy the owner's email; you can't tell why they'd switch agencies this month.",
    examples: [
      {
        signals: ["runs_meta_ads = true", "has_pixel = false"],
        title: "Paying for ads, tracking nothing",
        body: "A business actively running Meta ads with no pixel installed is burning spend blind — a measurement retainer that closes itself. Apollo sees neither the ads nor the pixel.",
      },
      {
        signals: ["ad_creative_age > 90d", "landing = homepage"],
        title: "Stale creative pointed at the homepage",
        body: "Ads older than 90 days landing on the homepage (not a dedicated LP) is a conversion audit you can quantify. Apollo has no ad-library or landing-page data.",
      },
      {
        signals: ["unanswered_1star ≥ 3", "complaint_theme = repeat"],
        title: "A reputation leak with a theme",
        body: "Three-plus unanswered 1★ reviews clustering on one complaint is a reputation-management pitch with evidence. Apollo carries no review data at all.",
      },
    ],
    tableCaption:
      "Head-to-head for a local-marketing agency's prospecting job.",
    rows: [
      {
        dimension: "Core data shape",
        mapsly:
          "Local-business signals — reviews, local SEO, ads, website, profile",
        them: "B2B firmographics + contact database",
      },
      {
        dimension: "Google review signals",
        mapsly: "Rating trend, reply rate, unanswered 1★, complaint themes",
        them: "None",
      },
      {
        dimension: "Live ad intelligence",
        mapsly: "Meta ad-library creatives, pixel presence, landing-page type",
        them: "None",
      },
      {
        dimension: "Website / performance",
        mapsly: "Lighthouse LCP/CLS, schema, booking tool, tech fingerprint",
        them: "Corporate tech stack only",
      },
      {
        dimension: "Signal combinations",
        mapsly: "60+ filters combinable into a single qualified list",
        them: "Firmographic filters only",
      },
      {
        dimension: "What you pay for",
        mapsly: "Delivered leads only · free discovery · top-ups never expire",
        them: "Per-contact credits · overage billing",
      },
    ],
    ctaTitle: "Map a market free. See the signals Apollo can't.",
    ctaSub:
      "Pick a category and metro, map it in seconds, and see 50 leads with evidence — no card.",
  },

  "mapsly-vs-gohighlevel": {
    slug: "mapsly-vs-gohighlevel",
    competitor: "GoHighLevel Prospecting",
    metaTitle: "Mapsly vs GoHighLevel Prospecting — evidence, not a scan score",
    metaDescription:
      "GoHighLevel's prospecting tool scores a site; Mapsly proves the gap. Filter local businesses by ads-without-pixel, stale creative, unanswered 1★ — with sources.",
    eyebrow: "Mapsly vs GoHighLevel",
    h1: "GoHighLevel scores a site. Mapsly hands you the evidence.",
    lede: "GoHighLevel's prospecting add-on runs a quick site audit and spits out a number to open a conversation. It's a demo prop, not a prospecting engine — you can't query 2,000 businesses by a combination of live signals, and the 'score' isn't backed by citable proof you can put in a pitch.",
    weaknessTitle: "GoHighLevel's gap: a score, not a queryable signal layer",
    weaknessBody:
      "The GHL prospecting widget audits one URL at a time and reports a composite grade. There's no way to say 'show me every dentist in Austin running Meta ads with no pixel and an unanswered 1★ cluster' — the filter vocabulary and the underlying multi-source data aren't there. Great for a walkthrough; thin for building a book of qualified prospects.",
    examples: [
      {
        signals: ["runs_meta_ads = true", "has_pixel = false", "lcp > 4s"],
        title: "Three problems, one lead",
        body: "Running ads with no pixel AND a slow site is a stacked pitch — measurement + performance in one call. GHL's single-URL score flattens this into one number with no sources.",
      },
      {
        signals: ["ad_creative_age > 90d", "landing = homepage"],
        title: "Stale creative → homepage",
        body: "A dedicated conversion audit needs the ad's age and where it lands. Mapsly pulls both from the ad library; GHL's audit never looks at live ads.",
      },
      {
        signals: ["unanswered_1star ≥ 3", "reply_rate < 25%"],
        title: "A reputation retainer, sourced",
        body: "Low reply rate plus unanswered negatives is a recurring retainer — and Mapsly shows the exact reviews as evidence. A GHL grade is a black box.",
      },
    ],
    tableCaption:
      "Head-to-head for building a qualified prospect list at scale.",
    rows: [
      {
        dimension: "Scope",
        mapsly: "Query a whole market (2.1M businesses) by signal",
        them: "Audit one URL at a time",
      },
      {
        dimension: "Output",
        mapsly: "A filtered list + per-lead evidence with sources",
        them: "A single composite score",
      },
      {
        dimension: "Signal vocabulary",
        mapsly: "60+ combinable filters across 8 categories",
        them: "Fixed audit checklist",
      },
      {
        dimension: "Ad intelligence",
        mapsly: "Meta ad-library creatives + pixel + landing-page type",
        them: "None",
      },
      {
        dimension: "Client-ready artifact",
        mapsly: "Agency-branded one-pager with cited evidence",
        them: "Screenshot of a score",
      },
      {
        dimension: "Data freshness",
        mapsly: "Weekly refresh, source + date on every finding",
        them: "On-demand single scan",
      },
    ],
    ctaTitle: "Stop demoing a score. Start shipping evidence.",
    ctaSub:
      "Map any market free and pull 50 leads with the proof already attached — no card.",
  },

  "mapsly-vs-leadswift-d7": {
    slug: "mapsly-vs-leadswift-d7",
    competitor: "LeadSwift / D7",
    metaTitle: "Mapsly vs LeadSwift & D7 Lead Finder — signal, not a scrape",
    metaDescription:
      "LeadSwift and D7 scrape contacts + a website flag. Mapsly qualifies local businesses by ads-without-pixel, stale creative, unanswered 1★ — with evidence.",
    eyebrow: "Mapsly vs LeadSwift / D7",
    h1: "LeadSwift and D7 scrape lists. Mapsly qualifies them.",
    lede: "LeadSwift and D7 Lead Finder are fast scrapers: they pull business contacts and a handful of coarse flags (no website, no SSL, has Facebook). Volume is easy; qualification is the problem. You still can't tell which of 800 scraped roofers is actually worth a pitch this week.",
    weaknessTitle: "LeadSwift / D7's gap: coarse flags, no signal depth",
    weaknessBody:
      "Their flags are binary and surface-level — 'no website', 'not mobile-friendly', 'no Google Ads'. There's no live ad-creative analysis, no review-theme detection, no Lighthouse depth, and no way to combine signals into a real qualification. You get a big list and a lot of manual triage.",
    examples: [
      {
        signals: ["runs_meta_ads = true", "has_pixel = false"],
        title: "Ads without a pixel",
        body: "A scraper's 'has ads' flag can't tell measured from unmeasured spend. Mapsly reads the pixel too — the difference between a real pitch and a guess.",
      },
      {
        signals: ["ad_creative_age > 90d", "landing = homepage"],
        title: "Stale creative, homepage landing",
        body: "This needs the ad's launch date and its destination. LeadSwift/D7 don't touch the ad library, so the whole angle is invisible to them.",
      },
      {
        signals: ["unanswered_1star ≥ 3", "complaint_theme = repeat"],
        title: "A themed reputation leak",
        body: "Coarse scrapers report a star rating at best. Mapsly clusters the actual complaints so the pitch names the problem the owner already knows about.",
      },
    ],
    tableCaption:
      "Head-to-head for turning a scraped list into qualified prospects.",
    rows: [
      {
        dimension: "Approach",
        mapsly: "Signal-driven qualification with evidence",
        them: "Contact scrape + coarse flags",
      },
      {
        dimension: "Review depth",
        mapsly: "Rating trend, reply rate, unanswered 1★, complaint themes",
        them: "Star rating (if any)",
      },
      {
        dimension: "Ad intelligence",
        mapsly: "Live creatives, pixel, landing-page type",
        them: "'Runs ads' flag (or none)",
      },
      {
        dimension: "Website depth",
        mapsly: "Lighthouse LCP/CLS, schema, booking tool, tech fingerprint",
        them: "'Has website / mobile-friendly' flag",
      },
      {
        dimension: "Signal combinations",
        mapsly: "60+ filters combinable into one qualified list",
        them: "A few independent flags",
      },
      {
        dimension: "Per-lead proof",
        mapsly: "Cited evidence + agency-branded one-pager",
        them: "Raw contact row",
      },
    ],
    ctaTitle: "Trade a scraped pile for a qualified list.",
    ctaSub:
      "Map a market free, filter by real signals, and export 50 qualified leads with evidence — no card.",
  },
};

/** Ordered slugs for cross-linking between the sibling comparison pages. */
export const COMPARISON_SLUGS = Object.keys(
  COMPARISONS,
) as ComparisonSpec["slug"][];
