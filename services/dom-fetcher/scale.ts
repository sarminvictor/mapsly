// services/dom-fetcher/scale.ts · centralized scale + cost config.
//
// One source of truth for every tunable in the contact / DOM / Lighthouse
// enrichment subsystem. Before this module the chunk size, memory tiers,
// freshness windows, and per-run ceilings were magic numbers scattered across
// fetcher.ts, enrich-contacts.ts, and the crons. They're collected here so a
// scale change (e.g. raising the walled-Lighthouse cap, or a tighter run
// budget) is a single edit that every consumer picks up.
//
// Sizing comes from docs/scraper-scaling.md (measured Apify costs):
//   - DOM contacts:        ~$0.0027/lead batched (the ~6× saving)
//   - DfS Lighthouse:      $0.00425/audit (junk on Cloudflare-walled sites)
//   - actor Lighthouse:    ~$0.06/run @ 4 GB, maxConcurrency 1 — on-demand only
//
// Consumers: fetcher.ts (chunk + memory), enrich-contacts.ts (freshness +
// run ceiling), enrich-lighthouse.ts (walled cap + Lighthouse ceiling).

/** Per-run URL chunk for `fetchDomsForCell`. 250 URLs is a comfortable batch
 *  for a 2 GB run at maxConcurrency ~10; larger cells fan out across runs. */
export const DOM_CHUNK_SIZE = 250;

/**
 * Apify run memory tiers (MB). Playwright + Chrome is memory-bound, so the tier
 * is the difference between cheap and thrashing (512 MB → ~180s/$0.019 a lead).
 * Rule of thumb: maxConcurrency ≈ memoryGB.
 *
 *   - single:     1 GB — one URL, the sweet spot (512 MB thrashes).
 *   - batch:      2 GB — a ≤250-URL cell at ~10 parallel browsers.
 *   - bigCell:    8 GB — a ~500-URL cell at ~30–40 parallel browsers.
 *   - lighthouse: 4 GB — actor-Lighthouse forces maxConcurrency 1 and needs the
 *                 headroom for the in-browser Lighthouse pass.
 */
export const DOM_MEMORY_MB = {
  single: 1024,
  batch: 2048,
  bigCell: 8192,
  lighthouse: 4096,
} as const;

/** Parallel browsers inside a batched run (~1 per GB of memory). */
export const DOM_MAX_CONCURRENCY = 10;

/** Contacts are considered fresh for 90 days (per ENRICHMENT_PRICES.contacts). */
export const CONTACTS_FRESHNESS_DAYS = 90;

/** Lighthouse audits are considered fresh for 30 days — CWV drifts slowly and
 *  the actor pass is the most expensive single call in the stack. */
export const LIGHTHOUSE_FRESHNESS_DAYS = 30;

/**
 * Hard cap on Cloudflare-WALLED actor-Lighthouse runs per enrichment invocation.
 * Each walled run is ~$0.06 (a real browser running Lighthouse at 4 GB,
 * maxConcurrency 1), so it must NEVER run in bulk. Open sites use the cheap DfS
 * audit ($0.00425) with no cap; walled sites queue past this number are skipped
 * and counted (`skippedWalledOverCap`) for a later, deliberate pass.
 */
export const WALLED_LIGHTHOUSE_LIMIT = 10;

/**
 * Default cumulative-cost ceiling (USD) for one `fetchDomsForCell` invocation.
 * Once the running Apify usage reaches this, no further chunks launch — the
 * function returns what completed and logs a structured `cost-ceiling.hit`
 * (no silent truncation). A 250-URL batch is ~$0.7, so $10 is ~14 chunks /
 * ~3,500 URLs of headroom — comfortably above a 1,400-lead cell but a hard
 * backstop against a runaway misconfigured run.
 */
export const DOM_RUN_COST_CEILING_USD = 10;

/**
 * Default cumulative-cost ceiling (USD) for one `enrichLighthouseForBusinesses`
 * invocation. Open-site DfS audits are cheap; the spend that matters is the
 * walled actor runs ($0.06 each). $2 ≈ 33 walled runs of room on top of the
 * WALLED_LIGHTHOUSE_LIMIT cap — the cap is the primary guard, this is the
 * belt-and-braces backstop.
 */
export const LIGHTHOUSE_RUN_COST_CEILING_USD = 2;
