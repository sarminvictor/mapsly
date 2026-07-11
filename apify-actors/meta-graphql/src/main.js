// Mapsly · Meta (Facebook/Instagram) Ad Library scraper — GraphQL-DIRECT rebuild
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (see docs/meta-actor-forensics-2026-07-10.html):
// The prior actor (mapsly-meta-ad-library) drove a full Playwright browser that
// NAVIGATED each target's Ad Library page with IMAGES ON on a residential proxy.
// In prod that failed 73% of runs and a dead run burned up to $0.90 of
// residential BANDWIDTH over a 280s timeout for ZERO yield — because ~93% of the
// cost is proxy bytes, and every image/CSS/JS asset of every per-target render
// went through the by-the-byte residential lane.
//
// THE FIX (2026 best practice — "browser to mint, HTTP to harvest"):
//   1. Prime ONE page on the PUBLIC Ad Library surface (logged-out, DSA-mandated)
//      to mint the three session artifacts: `datr` cookie + `lsd` CSRF token +
//      the rotating `doc_id` persisted-query hash (harvested fresh, never
//      hardcoded — a stale doc_id is the #1 "suddenly returns zero" cause).
//   2. Harvest every target over HTTP via `page.request.post` to /api/graphql.
//      page.request rides the REAL browser's TLS/JA3 fingerprint + primed cookies
//      (the strongest possible fingerprint — Meta's WAF scores TLS *before*
//      render), but sends only small JSON — a few KB per target, not a full
//      image-laden page render. No per-target navigation. Images never load.
//   3. FAST-FAIL: a block is knowable in ONE ~1KB request, so a bad session is
//      abandoned in seconds (~$0.001), never ground to the 280s wall.
//
// OBSERVABILITY: emits the SAME dataset contract as the old actor — resolution /
// advertiser / target_status records + flat ad rows + a machine-readable
// RUN_SUMMARY with the honest ok/empty_verified/blocked/timeout taxonomy. So the
// existing app adapter (services/apify/meta-ad-library.ts) is a DROP-IN: switching
// is just the META_AD_LIBRARY_ACTOR_ID env var. NEW: each target also reports its
// `mode` (http-direct | intercept-fallback) + `elapsedMs` so the transport mix and
// per-target latency are visible in RUN_SUMMARY.
//
// STRUCTURAL TRUTH (unchanged, no transport fixes it): keyword/cell searches yield
// the advertiser FACET (dynamic_filter_options.pages); ad CREATIVES come only from
// the per-page-id path. This actor captures both when Meta serves them.

import { Actor, log } from "apify";
import { PlaywrightCrawler } from "crawlee";

let _bcN = 0; // hoisted so bc() can be called from the very first module line
let DEBUG = false; // set from input.debug — gates dataset breadcrumbs (KV BC_LAST always on)

await Actor.init();
await bc("init-done");

// Cross-run warm-`datr` persistence is intentionally NOT used: `Actor.openKeyValueStore(name)`
// (a NAMED store) HANGS under this run's LIMITED_PERMISSIONS and jams the SDK's storage
// queue (was the root cause of every 0-record timeout in the first smoke tests). Each run
// primes its own `datr` anyway, so cross-run warming was only a marginal trust win — dropped.
// The dead `warmStore=null` var + the guarded WARM_DATR reload block were removed 2026-07-11.

// ---- Input --------------------------------------------------------------
const input = (await Actor.getInput()) ?? {};
DEBUG = input.debug === true; // opt-in dataset breadcrumbs for diagnostics
await bc("input-read");
const searchTerms = Array.isArray(input.searchTerms)
  ? input.searchTerms.filter(Boolean).map(String)
  : [];
const pageIds = Array.isArray(input.pageIds)
  ? input.pageIds.filter(Boolean).map(String)
  : [];
const pageUrls = Array.isArray(input.pageUrls)
  ? input.pageUrls.filter(Boolean).map(String)
  : [];
const countries = (
  Array.isArray(input.countries) && input.countries.length
    ? input.countries
    : ["CA"]
).map((c) => String(c).toUpperCase());
const activeStatus = ["all", "active", "inactive"].includes(input.activeStatus)
  ? input.activeStatus
  : "all";
const searchType = [
  "keyword_unordered",
  "keyword_exact_phrase",
  "page",
].includes(input.searchType)
  ? input.searchType
  : "keyword_unordered";
const maxItems = Number.isFinite(input.maxItems)
  ? Math.max(1, Math.min(1000, input.maxItems))
  : 100;

// Cost governors (the anti-$0.90-burn levers).
const MAX_CONSECUTIVE_BLOCKS = 3; // fast-fail: abandon after 3 blocked targets in a row
const RUN_WALL_BUDGET_MS = 180_000; // stop launching targets past this — leaves headroom to finalize
const RESOLVE_BUDGET_MS = 45_000; // cap the pageUrls→id resolution phase (walled handles block) so it can't eat the whole handler

if (searchTerms.length === 0 && pageIds.length === 0 && pageUrls.length === 0) {
  throw new Error(
    "Provide at least one of `searchTerms`, `pageIds`, or `pageUrls`.",
  );
}

const country = countries[0];

// Map the proxy exit country to a plausible locale list so the injected
// fingerprint's Accept-Language matches the residential IP's geo.
function localesForCountry(cc) {
  const c = String(cc || "US").toUpperCase();
  if (c === "CA") return ["en-CA", "en-US", "en"];
  if (c === "GB" || c === "UK") return ["en-GB", "en"];
  if (c === "AU") return ["en-AU", "en"];
  return ["en-US", "en"];
}

// ---- Helpers (proven — carried over from mapsly-meta-ad-library) ---------

function buildUrl(target) {
  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", activeStatus);
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", country);
  u.searchParams.set("media_type", "all");
  // Meta's UI sets this on every keyword search; WITHOUT it the results GraphQL
  // never fires (only the shell loads) and the page returns 0 ads.
  u.searchParams.set("is_targeted_country", "false");
  if (target.label === "page") {
    u.searchParams.set("view_all_page_id", target.subject);
    u.searchParams.set("search_type", "page");
  } else {
    u.searchParams.set("q", target.subject);
    u.searchParams.set("search_type", searchType);
  }
  return u.toString();
}

// The prime URL — the first target's Ad Library page, or (pageUrls-only case) a
// generic country search that still loads the search bundle so doc_id surfaces.
function primeUrl() {
  if (targets.length) return buildUrl(targets[0]);
  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", activeStatus);
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", country);
  u.searchParams.set("media_type", "all");
  u.searchParams.set("is_targeted_country", "false");
  u.searchParams.set("q", "marketing");
  u.searchParams.set("search_type", searchType);
  return u.toString();
}

// DIAG breadcrumb — pushed to the DATASET (flushes to Apify immediately, unlike
// block-buffered stdout which is LOST on a SIGKILL timeout). Lets us see exactly
// how far a hung run got. The adapter's safeParse ignores recordType:"debug".
async function bc(step, extra) {
  _bcN += 1;
  const rec = {
    recordType: "debug",
    n: _bcN,
    step,
    t: Date.now(),
    ...(extra ?? {}),
  };
  // KV setValue is an immediate PUT that survives a SIGKILL — BC_LAST always holds
  // the last step reached even if the dataset push is buffered/lost. Always on
  // (one overwritten record, near-zero cost, the key diagnostic).
  // Fire-and-forget: BC_LAST is a best-effort diagnostic; awaiting it serializes a
  // KV round-trip into the proxy-billed run clock on every one of the ~15+ calls.
  void Actor.setValue("BC_LAST", rec).catch(() => {});
  // Full breadcrumb trail to the dataset only when input.debug — keeps a production
  // dataset to the contract records (advertiser/ad/target_status/resolution) the app
  // adapter expects; the adapter's safeParse ignores recordType:"debug" regardless.
  if (!DEBUG) return;
  try {
    await Actor.pushData(rec);
  } catch {
    /* best-effort */
  }
}

function fbPageUrl(handleOrUrl) {
  let h = String(handleOrUrl).trim();
  const m = h.match(/facebook\.com\/([^/?#]+)/i);
  if (m) h = m[1];
  h = h.replace(/^@/, "").replace(/\/+$/, "");
  if (!h || /^profile\.php$/i.test(h)) return null;
  return `https://www.facebook.com/${encodeURIComponent(h)}/`;
}

function extractPageId(text) {
  if (!text) return null;
  const patterns = [
    /"pageID"\s*:\s*"(\d{6,})"/,
    /"delegate_page"\s*:\s*\{[^{}]*?"id"\s*:\s*"(\d{6,})"/,
    /fb:\/\/page\/\??(?:id=)?(\d{6,})/,
    /"page_id"\s*:\s*"?(\d{6,})/,
    /"entity_id"\s*:\s*\{[^{}]*?"id"\s*:\s*"(\d{6,})"/,
    /\/pages\/[^/]+\/(\d{6,})/,
  ];
  for (const re of patterns) {
    const mm = text.match(re);
    if (mm) return mm[1];
  }
  return null;
}

function parseFbJson(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith("for (;;);")) t = t.slice(9);
  try {
    return [JSON.parse(t)];
  } catch {
    /* fall through to NDJSON (@defer streams several objects) */
  }
  const objs = [];
  for (const line of t.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      objs.push(JSON.parse(s));
    } catch {
      /* skip unparseable fragment */
    }
  }
  return objs.length ? objs : null;
}

// A GraphQL body only counts as REACHING Meta's data query if it carries a real
// result marker — NOT merely the `ad_library_main` shell (which a soft-block also
// returns). Require collated_results | ad_archive_id | a NON-EMPTY advertiser facet.
function reachedDataQuery(text) {
  if (!text) return false;
  if (/collated_results|ad_archive_id|adArchiveID/i.test(text)) return true;
  return /"dynamic_filter_options"\s*:\s*\{[^]*?"pages"\s*:\s*\[\s*\{/.test(
    text,
  );
}

// Harvest the per-session `lsd` CSRF token from page HTML / JS bundle.
function extractLsd(html) {
  if (!html) return null;
  const patterns = [
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
    /\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
    /"lsd"\s*:\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

// Scrape the Ad Library search `doc_id` (rotates per JS-bundle deploy) out of the
// loaded bundle at RUNTIME — never hardcode. Prefer a doc_id adjacent to a
// recognizable Ad Library search query name.
function extractSearchDocId(text) {
  if (!text) return null;
  const named = [
    /AdLibrary(?:Search|Mobile|Grid)[A-Za-z]*Query[^]{0,4000}?"doc_id"\s*:\s*"(\d{6,})"/,
    /"doc_id"\s*:\s*"(\d{6,})"[^]{0,4000}?AdLibrary(?:Search|Mobile|Grid)[A-Za-z]*Query/,
    /__relay_internal__[^]{0,2000}?AdLibrary[^]{0,2000}?"doc_id"\s*:\s*"(\d{6,})"/,
  ];
  for (const re of named) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

// Pull lsd + doc_id from the primed page (rendered HTML + any doc_id-bearing
// inline scripts). Called once after the prime; result reused for every target.
async function harvestGraphqlCreds(page) {
  const html = await page.content().catch(() => "");
  let lsd = extractLsd(html);
  let docId = extractSearchDocId(html);
  if (!docId) {
    const scriptText = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("script"))
          .map((s) => s.textContent || "")
          .filter((t) => t.includes("doc_id"))
          .join("\n")
          .slice(0, 800_000),
      )
      .catch(() => "");
    docId = extractSearchDocId(scriptText);
    if (!lsd) lsd = extractLsd(scriptText);
  }
  return { lsd, docId };
}

// Capture the REAL search doc_id + lsd from the page's OWN /api/graphql POST — far
// more reliable than regex-scraping the JS bundle (which whiffs when Meta lazy-loads
// the doc_id into a chunk). The Ad Library search/pagination request form-encodes
// `doc_id`, `lsd`, and `fb_api_req_friendly_name=AdLibrary…Query` in its body; we
// grab them from the first such request the primed page fires. Writes straight to
// `run` so the scrape loop can switch to the cheap HTTP-direct path.
function captureCredsFromRequest(req) {
  try {
    if (req.method() !== "POST") return;
    if (!req.url().includes("/api/graphql")) return;
    const post = req.postData() || "";
    if (!post) return;
    const params = new URLSearchParams(post);
    const friendly = params.get("fb_api_req_friendly_name") || "";
    const docId = params.get("doc_id");
    const lsd = params.get("lsd");
    const variables = params.get("variables") || "";
    // Match any Ad Library SEARCH graphql POST — the INITIAL results query OR the
    // scroll pagination query. Broadened (2026-07-10) from the pagination-only
    // friendly-name match so we ALSO grab the doc_id from the initial query, which
    // fires even for a SPARSE/EMPTY market that never scrolls → directScrape can
    // then POST the explicit search and tell a real empty (well-formed empty
    // response) from a soft-block (error/checkpoint). We still require the
    // search-variables SHAPE so an unrelated AdLibrary query can't hijack the
    // template. graphqlHits still gates on real data (reachedDataQuery), so this
    // capture can't itself self-certify a block as empty.
    if (
      docId &&
      /AdLibrary/i.test(friendly) &&
      /"(searchType|activeStatus|queryString)"/.test(variables)
    ) {
      // Store the FULL request body as a template — Meta's /api/graphql POST needs
      // the whole auth param set (fb_dtsg, av, __user, __req, jazoest, …), not just
      // lsd+doc_id+variables. HTTP-direct replays this template with only `variables`
      // swapped, so every auth token comes from the page's own real request.
      if (!run.reqTemplate) {
        run.reqTemplate = post;
        run.reqFriendly = friendly;
      }
      if (!run.docId) run.docId = docId;
      if (lsd && !run.lsd) run.lsd = lsd;
    }
  } catch {
    /* best-effort */
  }
}

function buildSearchVariables(target, cursor) {
  const isPage = target.label === "page";
  return {
    count: 30,
    cursor: cursor ?? null,
    params: {
      activeStatus: activeStatus.toUpperCase(),
      adType: "ALL",
      countries: [country],
      mediaType: "ALL",
      searchType: isPage ? "PAGE" : searchType.toUpperCase(),
      queryString: isPage ? "" : String(target.subject),
      viewAllPageID: isPage ? String(target.subject) : "0",
      isTargetedCountry: false,
      fetchPageInfo: true,
      fetchSharedDisclaimers: false,
      full_text_search_field: "all",
      sortData: null,
      pageIDs: [],
    },
  };
}

function findPageInfo(json) {
  const stack = Array.isArray(json) ? json.slice() : [json];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (
      cur.page_info &&
      typeof cur.page_info === "object" &&
      ("end_cursor" in cur.page_info || "has_next_page" in cur.page_info)
    ) {
      return cur.page_info;
    }
    for (const k in cur) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function flattenAd(node, target) {
  const snap = node.snapshot ?? {};
  const body =
    (snap.body && (snap.body.text ?? snap.body?.markup?.__html)) ??
    (typeof snap.body === "string" ? snap.body : null);
  const firstCard = Array.isArray(snap.cards) ? snap.cards[0] : null;
  const image =
    (Array.isArray(snap.images) &&
      snap.images[0] &&
      (snap.images[0].original_image_url ??
        snap.images[0].resized_image_url)) ??
    (firstCard &&
      (firstCard.original_image_url ?? firstCard.resized_image_url)) ??
    null;
  const video =
    (Array.isArray(snap.videos) &&
      snap.videos[0] &&
      (snap.videos[0].video_preview_image_url ??
        snap.videos[0].video_sd_url)) ??
    null;
  const id = String(node.ad_archive_id ?? node.adArchiveID ?? "");
  return {
    id,
    pageId: String(node.page_id ?? snap.page_id ?? ""),
    pageName: node.page_name ?? snap.page_name ?? null,
    adCreativeBody: body ?? null,
    linkTitle: snap.title ?? firstCard?.title ?? null,
    linkCaption: snap.caption ?? firstCard?.caption ?? null,
    linkDescription:
      snap.link_description ?? firstCard?.link_description ?? null,
    linkUrl: snap.link_url ?? firstCard?.link_url ?? null,
    ctaText: snap.cta_text ?? firstCard?.cta_text ?? null,
    displayFormat: snap.display_format ?? null,
    imageUrl: image,
    videoUrl: video,
    snapshotUrl: id ? `https://www.facebook.com/ads/library/?id=${id}` : null,
    platforms: node.publisher_platform ?? snap.publisher_platform ?? [],
    startDate: node.start_date
      ? new Date(node.start_date * 1000).toISOString()
      : null,
    endDate: node.end_date
      ? new Date(node.end_date * 1000).toISOString()
      : null,
    isActive: node.is_active ?? null,
    collationCount: node.collation_count ?? null,
    searchTerm: target.label === "search" ? target.subject : null,
    pageQuery: target.label === "page" ? target.subject : null,
    resolvedFromUrl: target.resolvedFrom ?? null,
    country,
    scrapedAt: new Date().toISOString(),
  };
}

// Ingest ONE parsed GraphQL response into the shared `store`: advertiser facet
// (the reliable "who advertises for this term" list) + every ad node.
function ingestJson(json, store) {
  for (const obj of Array.isArray(json) ? json : [json]) {
    const pages = obj?.data?.ad_library_main?.dynamic_filter_options?.pages;
    if (!Array.isArray(pages)) continue;
    for (const p of pages) {
      const pid = String(p?.key ?? "");
      if (pid && !store.advSeen.has(pid)) {
        store.advSeen.add(pid);
        store.advertisers.push({
          pageId: pid,
          pageName: p?.display_name ?? null,
          adCount: typeof p?.count === "number" ? p.count : null,
        });
      }
    }
  }
  collectAds(json, store);
}

function collectAds(json, store) {
  const stack = Array.isArray(json) ? json.slice() : [json];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (cur.ad_archive_id != null || cur.adArchiveID != null) {
      const ad = flattenAd(cur, store.target);
      if (ad.id && !store.seen.has(ad.id)) {
        store.seen.add(ad.id);
        store.ads.push(ad);
      }
      continue;
    }
    for (const k in cur) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

async function dismissCookieBanner(page) {
  const labels = [
    /decline optional cookies/i,
    /only allow essential/i,
    /allow all cookies/i,
    /accept all/i,
  ];
  for (const re of labels) {
    try {
      const btn = page.getByRole("button", { name: re });
      if (await btn.count()) {
        await btn.first().click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {
      /* banner not present */
    }
  }
  return false;
}

// ok → data query fired AND found advertisers/ads; empty_verified → fired but
// genuinely empty; blocked → never fired; timeout → nav/proxy died before data.
function classifyOutcome({ graphqlHits, items, advertisers, navFailed }) {
  if (graphqlHits > 0 || items > 0 || advertisers > 0) {
    return items > 0 || advertisers > 0 ? "ok" : "empty_verified";
  }
  return navFailed ? "timeout" : "blocked";
}

// Best-effort egress IP for attribution (which exit served a block). Tight cap —
// a bad IP is already slow; don't add the full echo timeout on top.
async function currentEgressIp(page) {
  try {
    const res = await page.request.get("https://api.ipify.org?format=json", {
      timeout: 2500,
    });
    const body = await res.json();
    return typeof body?.ip === "string" ? body.ip : null;
  } catch {
    return null;
  }
}

function rotateSession(session, reason) {
  if (session && typeof session.retire === "function") {
    try {
      session.retire();
      log.info(`session retired (${reason}) — next hop gets a fresh IP`);
      return true;
    } catch {
      /* best-effort */
    }
  }
  return false;
}

// Resolve a FB handle/URL → numeric page id via an HTTP GET through the browser
// TLS context (page.request — NO render, NO images). Cheap: one small HTML fetch
// vs a full page.goto. Returns null if walled / no id surfaces.
async function resolvePageIdHttp(page, handleOrUrl) {
  // Free id: a profile.php?id=NNN URL ALREADY carries the numeric page id — no
  // resolve needed. fbPageUrl() rejects profile.php, so extract it here first
  // (Meta blocks the raw HTTP resolve of most handle pages, so any id we can read
  // straight off the URL is a guaranteed win). 2026-07-10.
  const direct = String(handleOrUrl).match(
    /profile\.php\?(?:[^#]*&)?id=(\d{6,})/i,
  );
  if (direct) return direct[1];
  const url = fbPageUrl(handleOrUrl);
  if (!url) return null;
  try {
    const res = await page.request.get(url, { timeout: 8000 });
    const text = await res.text();
    return extractPageId(text);
  } catch (e) {
    log.warning(`resolve GET failed for ${url}: ${e.message}`);
    return null;
  }
}

// ── The HTTP-direct GraphQL harvest — the core of this rebuild ─────────────
// Fire the search query directly from the primed session over page.request.post
// (rides the browser TLS + primed cookies) and cursor-paginate. Feeds the SHARED
// store (facet + ad extraction). Returns:
//   "verified"    — ≥1 POST reached Meta's data query (graphqlHits bumped): a
//                   0-yield here is a REAL empty, not a silent block.
//   "unavailable" — creds missing or every POST 4xx'd/errored: caller may fall
//                   back to a navigation-intercept (do NOT treat as verified-empty).
async function directScrape(page, target, store, creds) {
  const { lsd, docId } = creds;
  // HTTP-direct REQUIRES the page's real captured request template — Meta rejects a
  // hand-built body (wrong variables shape → error payload). No template = fall back.
  if (!lsd || !docId || !run.reqTemplate) return "unavailable";

  // Start from the captured variables (the EXACT shape this doc_id expects) and
  // override only the query + cursor — never guess the shape.
  let baseVars;
  try {
    baseVars = JSON.parse(
      new URLSearchParams(run.reqTemplate).get("variables") || "{}",
    );
  } catch {
    return "unavailable";
  }
  const isPage = target.label === "page";

  let cursor = null;
  let anyReached = false;
  // Follow pagination up to what the caller actually asked for (maxItems), not a
  // fixed 150 (5×30) that silently truncated a page-id target requesting up to 1000.
  const MAX_PAGES = Math.min(50, Math.max(1, Math.ceil(maxItems / 30)));
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum += 1) {
    const vars = JSON.parse(JSON.stringify(baseVars));
    if ("cursor" in vars || cursor) vars.cursor = cursor;
    if (vars.params && typeof vars.params === "object") {
      vars.params.searchType = isPage ? "PAGE" : searchType.toUpperCase();
      vars.params.queryString = isPage ? "" : String(target.subject);
      vars.params.viewAllPageID = isPage ? String(target.subject) : "0";
    }
    const p = new URLSearchParams(run.reqTemplate);
    p.set("variables", JSON.stringify(vars));
    p.set("doc_id", docId);
    const body = p.toString();

    let text = "";
    try {
      const resp = await page.request.post(
        "https://www.facebook.com/api/graphql/",
        {
          data: body,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-fb-lsd": lsd,
            "x-fb-friendly-name":
              run.reqFriendly || "AdLibrarySearchPaginationQuery",
            "x-asbd-id": "129477",
            origin: "https://www.facebook.com",
            referer: buildUrl(target),
          },
          timeout: 20000,
        },
      );
      if (!resp.ok()) {
        log.warning(
          `[direct] POST HTTP ${resp.status()} for "${target.subject}" p${pageNum}`,
        );
        return anyReached ? "verified" : "unavailable";
      }
      text = await resp.text();
    } catch (e) {
      log.warning(`[direct] POST threw for "${target.subject}": ${e.message}`);
      return anyReached ? "verified" : "unavailable";
    }

    if (!reachedDataQuery(text)) {
      // An error payload (`{"errors":[…]}` no data) is a BLOCK, not an empty.
      if (/"errors?"\s*:/.test(text) && !/"data"\s*:/.test(text)) {
        log.warning(
          `[direct] error payload for "${target.subject}" p${pageNum}`,
        );
        return anyReached ? "verified" : "unavailable";
      }
      // A well-formed ad-key-less body still means the server answered — a
      // genuine empty for this page — count it as reached.
      const parsedEmpty = parseFbJson(text);
      if (parsedEmpty) {
        anyReached = true;
        store.graphqlHits += 1;
      }
      break;
    }

    const json = parseFbJson(text);
    if (!json) return anyReached ? "verified" : "unavailable";
    anyReached = true;
    store.graphqlHits += 1;
    ingestJson(json, store);

    const pageInfo = findPageInfo(json);
    if (!pageInfo || !pageInfo.has_next_page || !pageInfo.end_cursor) break;
    if (store.ads.length >= maxItems) break;
    cursor = pageInfo.end_cursor;
  }
  return anyReached ? "verified" : "unavailable";
}

// Fallback ONLY when the direct POST can't run (creds stale mid-run, or the very
// first prime couldn't mint a doc_id). Navigate the target's Ad Library page,
// intercept its own GraphQL, AND re-harvest creds for subsequent direct targets.
// This is the ONLY path that renders a page — kept rare + images-off.
async function navScrapeAndReharvest(page, target, store) {
  const onResponse = async (response) => {
    if (!response.url().includes("/api/graphql")) return;
    let text;
    try {
      text = await response.text();
    } catch {
      return;
    }
    if (!reachedDataQuery(text)) return;
    store.graphqlHits += 1;
    const json = parseFbJson(text);
    if (json) ingestJson(json, store);
  };
  page.on("response", onResponse);
  let navFailed = false;
  try {
    const resp = await page
      .goto(buildUrl(target), { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) => {
        log.warning(`nav failed for "${target.subject}": ${e.message}`);
        navFailed = true;
        return null;
      });
    await dismissCookieBanner(page).catch(() => {});
    // Short wait for the SPA to fire its data query (kept tight — the direct path
    // is primary; this is a safety net, not the main loop).
    const deadline = Date.now() + 6000;
    while (
      Date.now() < deadline &&
      store.graphqlHits === 0 &&
      store.advertisers.length === 0 &&
      store.ads.length === 0
    ) {
      await page.waitForTimeout(400);
    }
    // Re-harvest creds off this real search page for the remaining direct targets.
    const creds = await harvestGraphqlCreds(page);
    if (creds.lsd) run.lsd = creds.lsd;
    if (creds.docId) run.docId = creds.docId;
    return { navFailed, status: resp ? resp.status() : "n/a" };
  } finally {
    page.off("response", onResponse);
  }
}

// Scrape ONE target: direct HTTP first, navigation-intercept fallback if the
// direct POST couldn't run. Emits a target_status record + returns its summary.
async function scrapeTarget(page, target, session) {
  const store = {
    ads: [],
    seen: new Set(),
    advertisers: [],
    advSeen: new Set(),
    target,
    graphqlHits: 0,
  };
  const t0 = Date.now();
  let mode = "http-direct";
  let navFailed = false;

  const direct =
    run.lsd && run.docId
      ? await directScrape(page, target, store, {
          lsd: run.lsd,
          docId: run.docId,
        }).catch((e) => {
          log.warning(`[direct] threw for "${target.subject}": ${e.message}`);
          return "unavailable";
        })
      : "unavailable";

  if (direct === "unavailable") {
    // Creds stale / never minted → one navigation-intercept (also re-harvests creds).
    mode = "intercept-fallback";
    const nav = await navScrapeAndReharvest(page, target, store).catch(() => ({
      navFailed: true,
      status: "n/a",
    }));
    navFailed = nav.navFailed;
  }

  const ads = store.ads.slice(0, maxItems);
  const advertisers = store.advertisers;
  const outcome = classifyOutcome({
    graphqlHits: store.graphqlHits,
    items: ads.length,
    advertisers: advertisers.length,
    navFailed,
  });
  const elapsedMs = Date.now() - t0;
  log.info(
    `${target.label} "${target.subject}" [${country}]: ${ads.length} ads, ` +
      `${advertisers.length} advertisers (outcome=${outcome}, mode=${mode}, ` +
      `graphqlHits=${store.graphqlHits}, ${elapsedMs}ms)`,
  );
  if (outcome === "blocked" || outcome === "timeout") {
    rotateSession(session, `target "${target.subject}" ${outcome}`);
  }

  if (ads.length) await Actor.pushData(ads);
  if (advertisers.length) {
    await Actor.pushData(
      advertisers.map((a) => ({
        recordType: "advertiser",
        pageId: a.pageId,
        pageName: a.pageName,
        adCount: a.adCount,
        searchTerm: target.label === "search" ? target.subject : null,
        country,
      })),
    );
  }
  const ip =
    outcome === "blocked" || outcome === "timeout"
      ? await currentEgressIp(page)
      : null;
  await Actor.pushData({
    recordType: "target_status",
    subject: target.subject,
    label: target.label,
    status: outcome,
    items: ads.length,
    advertisers: advertisers.length,
    graphqlHits: store.graphqlHits,
    mode,
    elapsedMs,
    country,
    ip,
  });
  return {
    subject: target.subject,
    label: target.label,
    status: outcome,
    items: ads.length,
    advertisers: advertisers.length,
    graphqlHits: store.graphqlHits,
    mode,
    elapsedMs,
    ip,
  };
}

// ---- Run state ----------------------------------------------------------
const run = {
  primerOk: false,
  targetStatuses: [],
  lsd: null,
  docId: null,
};

// Targets: searchTerms + pageIds now; resolved pageUrls appended in the handler.
const targets = [
  ...searchTerms.map((term) => ({ label: "search", subject: term })),
  ...pageIds.map((pageId) => ({ label: "page", subject: pageId })),
];

// ---- Crawler ------------------------------------------------------------
await bc("module-proxy-start");
const proxyConfiguration = await Actor.createProxyConfiguration(
  input.proxyConfiguration ?? {
    groups: ["RESIDENTIAL"],
    countryCode: country,
  },
);
await bc("module-proxy-done", {
  hasProxy: Boolean(proxyConfiguration),
});

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency: 1,
  // Crawlee AUTO-NAVIGATES to the start URL (the first target's Ad Library page)
  // BEFORE the handler runs — that navigation IS the prime. Keep a retry budget so
  // a dead start-IP rotates to a fresh one (start-nav death is the one hop the
  // in-handler rotation can't reach). maxRequestRetries kept modest so retries
  // can't themselves eat the whole run budget.
  maxRequestRetries: 3,
  // MUST be < the actor run timeout (we run at 280s) so a slow handler is aborted
  // HERE, crawler.run() returns, and the finalize block writes RUN_SUMMARY + flushes
  // logs BEFORE Apify SIGKILLs the process at the run timeout (else: 0 records, no
  // summary, lost logs — exactly the first smoke-test failure).
  requestHandlerTimeoutSecs: 220,
  navigationTimeoutSecs: 45,
  retryOnBlocked: false,
  useSessionPool: true,
  persistCookiesPerSession: true,
  sessionPoolOptions: { maxPoolSize: 4, blockedStatusCodes: [] },
  browserPoolOptions: {
    retireBrowserAfterPageCount: 50,
    useFingerprints: true,
    fingerprintOptions: {
      fingerprintGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 120 }],
        devices: ["desktop"],
        operatingSystems: ["windows", "macos"],
        locales: localesForCountry(country),
      },
    },
  },
  launchContext: {
    launchOptions: { args: ["--disable-blink-features=AutomationControlled"] },
  },
  // preNavigationHooks receives gotoOptions — FORCE `domcontentloaded` so Crawlee's
  // auto-nav to the heavy Ad Library SPA doesn't wait for a `load` event the SPA
  // never cleanly fires (that hung the first smoke test until the nav timeout, ×
  // retries, burning the whole run before the handler ran). Block ONLY heavy media
  // (video/audio) — images stay, so the one primed page renders like a real browser;
  // creds live in the initial HTML/JS (ready at domcontentloaded), not in images.
  // page.request.get/post calls do NOT pass through page.route, so the HTTP harvest
  // is unaffected by this block.
  preNavigationHooks: [
    async ({ page }, gotoOptions) => {
      await bc("prenav-hook");
      if (gotoOptions) {
        gotoOptions.waitUntil = "domcontentloaded";
        gotoOptions.timeout = 45000;
      }
      // Block ONLY heavy media (video/audio). A live A/B showed blocking IMAGES too
      // flipped a succeeding run to `blocked` — a browser that fetches zero images is
      // a bot-tell, and the cost saving is marginal now that there's ONE nav per run
      // (not per-target). So keep images (look human); the real cost win is the
      // single-nav architecture, not stripping bytes.
      await page.route("**/*", (route) => {
        if (route.request().resourceType() === "media") return route.abort();
        return route.continue();
      });
      await bc("prenav-hook-done");
    },
  ],
  async requestHandler({ page, session }) {
    // The crawler auto-navigated the LIGHT start URL (facebook.com/) — proven to
    // reach the handler. The heavy Ad Library page is navigated HERE, in-handler,
    // under an explicit domcontentloaded goto we control.
    await bc("handler-entry");

    // Capture the real search doc_id + lsd from the page's OWN GraphQL POSTs for
    // the whole session — this is what unlocks the cheap HTTP-direct path.
    page.on("request", captureCredsFromRequest);

    // 1 · (cross-run datr warming removed — each run primes its own datr; see top note)
    await bc("handler-primed-start");

    // 2 · PRIME — navigate the first target's Ad Library page. The prime nav ALSO
    // scrapes target[0]: an interceptor collects the facet/ads Meta embeds in this
    // very page load, so target[0] needs NO second navigation (kills the double-nav).
    const primeTarget = targets.length ? targets[0] : null;
    const primeStore = {
      ads: [],
      seen: new Set(),
      advertisers: [],
      advSeen: new Set(),
      target: primeTarget ?? { label: "search", subject: "marketing" },
      graphqlHits: 0,
    };
    const primeOnResponse = async (response) => {
      if (!response.url().includes("/api/graphql")) return;
      let text;
      try {
        text = await response.text();
      } catch {
        return;
      }
      if (!reachedDataQuery(text)) return;
      primeStore.graphqlHits += 1;
      const json = parseFbJson(text);
      if (json) ingestJson(json, primeStore);
    };
    page.on("response", primeOnResponse);

    // PRIME with RETRY-ON-BLOCK. Meta soft-blocks a session PROBABILISTICALLY (an
    // IP is flagged or not) — a fresh residential exit usually isn't. So if this
    // primed page withholds the facet (no data reached: graphqlHits 0 AND 0
    // advertisers), rotate to a fresh IP and re-navigate. Break the instant the
    // facet reaches data. Bounded at MAX_PRIME_ATTEMPTS so a genuinely dead market
    // (or a real block wave) still fails fast + cheap, never grinding to the wall.
    const MAX_PRIME_ATTEMPTS = 3;
    const primeReachedData = () =>
      primeStore.graphqlHits > 0 || primeStore.advertisers.length > 0;
    let primeStatus = "n/a";
    for (let attempt = 1; attempt <= MAX_PRIME_ATTEMPTS; attempt += 1) {
      await bc(`prime-attempt-${attempt}`, { url: primeUrl() });
      if (attempt === 1) {
        const r = await page
          .goto(primeUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
          .catch((e) => {
            log.warning(`prime goto failed: ${e.message}`);
            return null;
          });
        primeStatus = r ? r.status() : "n/a";
      } else {
        // Blocked on the prior IP — rotate + re-navigate on a fresh exit.
        rotateSession(session, `prime blocked (attempt ${attempt})`);
        const r = await page
          .goto(primeUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
          .catch((e) => {
            log.warning(`prime re-goto failed: ${e.message}`);
            return null;
          });
        primeStatus = r ? r.status() : primeStatus;
      }
      await dismissCookieBanner(page).catch(() => {});
      await page.waitForTimeout(700 + Math.floor(Math.random() * 500));
      // SCROLL to trigger the Ad Library's own pagination GraphQL POST — the facet
      // arrives embedded in the initial HTML (no request), but the doc_id rides the
      // pagination POST that fires only on scroll. This both harvests target[0]'s
      // facet (via primeOnResponse) AND lets captureCredsFromRequest grab the doc_id.
      for (let i = 0; i < 16 && !(run.docId && primeReachedData()); i += 1) {
        await page.mouse.wheel(0, 1600).catch(() => {});
        await page.waitForTimeout(450);
      }
      // Regex-scrape the bundle for any creds the request capture missed.
      const creds = await harvestGraphqlCreds(page);
      run.lsd = run.lsd || creds.lsd;
      run.docId = run.docId || creds.docId;
      await bc(`prime-attempt-${attempt}-done`, {
        status: primeStatus,
        docId: run.docId || null,
        reached: primeReachedData(),
        advertisers: primeStore.advertisers.length,
      });
      if (primeReachedData()) break; // got the facet — stop retrying
    }
    const cookies = await page
      .context()
      .cookies()
      .catch(() => []);
    run.primerOk = cookies.some((c) => c.name === "datr");
    log.info(
      `Prime: datr=${run.primerOk}, lsd=${Boolean(run.lsd)}, docId=${run.docId || "NONE"}, ` +
        `reachedData=${primeReachedData()}, advertisers=${primeStore.advertisers.length}`,
    );
    if (!run.lsd || !run.docId) {
      log.warning(
        "Prime could not mint lsd+doc_id — targets fall back to navigation-intercept.",
      );
    }

    // 2b · EMIT target[0] from what the prime nav already intercepted — no second
    // navigation. The facet Meta embeds in this page load is already in primeStore.
    page.off("response", primeOnResponse);
    // EMPTY-vs-BLOCK verify (2026-07-10). If interception came back DRY (no data)
    // but we captured a doc_id, fire the explicit search POST: a well-formed empty
    // response means Meta ANSWERED and the market is genuinely empty
    // (→ empty_verified, cacheable, no retry), while an error/checkpoint/no-answer
    // stays a block. This stops a sparse keyword market (e.g. "hvac contractor
    // Kelowna") from looking blocked and retrying every dispatch. directScrape
    // bumps graphqlHits only on a real server answer, so it can't cache a block.
    if (
      primeTarget &&
      !primeReachedData() &&
      run.docId &&
      run.lsd &&
      run.reqTemplate
    ) {
      await directScrape(page, primeTarget, primeStore, {
        lsd: run.lsd,
        docId: run.docId,
      }).catch((e) => log.warning(`[prime-verify] threw: ${e.message}`));
      log.info(
        `[prime-verify] "${primeTarget.subject}": after explicit POST graphqlHits=${primeStore.graphqlHits}, advertisers=${primeStore.advertisers.length}`,
      );
    }
    let loopStart = 0;
    if (primeTarget) {
      const outcome = classifyOutcome({
        graphqlHits: primeStore.graphqlHits,
        items: primeStore.ads.length,
        advertisers: primeStore.advertisers.length,
        navFailed: primeStatus === "n/a",
      });
      const ads = primeStore.ads.slice(0, maxItems);
      log.info(
        `prime-scrape ${primeTarget.label} "${primeTarget.subject}" [${country}]: ` +
          `${ads.length} ads, ${primeStore.advertisers.length} advertisers ` +
          `(outcome=${outcome}, graphqlHits=${primeStore.graphqlHits})`,
      );
      if (ads.length) await Actor.pushData(ads);
      if (primeStore.advertisers.length) {
        await Actor.pushData(
          primeStore.advertisers.map((a) => ({
            recordType: "advertiser",
            pageId: a.pageId,
            pageName: a.pageName,
            adCount: a.adCount,
            searchTerm:
              primeTarget.label === "search" ? primeTarget.subject : null,
            country,
          })),
        );
      }
      const ip =
        outcome === "blocked" || outcome === "timeout"
          ? await currentEgressIp(page)
          : null;
      const st = {
        subject: primeTarget.subject,
        label: primeTarget.label,
        status: outcome,
        items: ads.length,
        advertisers: primeStore.advertisers.length,
        graphqlHits: primeStore.graphqlHits,
        mode: "prime-scrape",
        elapsedMs: 0,
        ip,
      };
      await Actor.pushData({ recordType: "target_status", ...st, country });
      run.targetStatuses.push(st);
      if (outcome === "blocked" || outcome === "timeout") {
        rotateSession(session, `prime target ${outcome}`);
      }
      loopStart = 1; // target[0] done — the loop handles the rest
    }

    // 3 · resolve pageUrls → numeric ids over HTTP (no render), append as targets.
    // Bounded: walled handles (Meta blocks most raw HTTP resolves) must not consume
    // the whole 220s handler in resolution alone, leaving no time to scrape any
    // searchTerm/pageId target — cap the phase and stop launching further resolves.
    const resolveStart = Date.now();
    for (const pu of pageUrls) {
      if (Date.now() - resolveStart > RESOLVE_BUDGET_MS) {
        log.warning(
          `resolve budget reached — stopping pageUrls resolution early ` +
            `(remaining unresolved will be skipped this run)`,
        );
        break;
      }
      const id = await resolvePageIdHttp(page, pu);
      if (id) {
        log.info(`Resolved "${pu}" → page_id ${id}`);
        await Actor.pushData({
          recordType: "resolution",
          resolvedFromUrl: pu,
          pageId: id,
          country,
        });
        targets.push({ label: "page", subject: id, resolvedFrom: pu });
      } else {
        log.warning(`Could not resolve a page id for "${pu}"`);
      }
    }

    // 4 · harvest every target. Direct HTTP first; per-target nav-intercept only if
    // the direct POST couldn't run. Fast-fail on consecutive blocks + a wall budget
    // so a dead run never grinds to the actor timeout.
    await bc("scrape-loop-start", {
      targets: targets.length,
      loopStart,
    });
    const wallStart = Date.now();
    // Seed the breaker from the prime target's outcome so a blocked prime + blocked
    // next target trip it sooner.
    let consecutiveBlocks =
      run.targetStatuses.length &&
      ["blocked", "timeout"].includes(run.targetStatuses[0].status)
        ? 1
        : 0;
    for (let ti = loopStart; ti < targets.length; ti += 1) {
      const target = targets[ti];
      if (Date.now() - wallStart > RUN_WALL_BUDGET_MS) {
        log.warning(
          `wall budget reached — stop launching targets ` +
            `(${run.targetStatuses.length}/${targets.length} done)`,
        );
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const st = await scrapeTarget(page, target, session);
      run.targetStatuses.push(st);
      consecutiveBlocks =
        st.status === "blocked" || st.status === "timeout"
          ? consecutiveBlocks + 1
          : 0;
      if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
        log.warning(
          `circuit-breaker: ${consecutiveBlocks} consecutive blocks — abandon run ` +
            `(saves the burn on the remaining ${targets.length - run.targetStatuses.length} targets)`,
        );
        break;
      }
    }
  },
  errorHandler({ session, request }, error) {
    // A start-nav death never reaches requestHandler — retire here so the next
    // attempt navigates on a FRESH IP.
    rotateSession(session, `nav error on ${request.url}`);
    log.warning(
      `attempt failed on ${request.url}: ${error?.message ?? error} — ` +
        "retired session, retrying on a fresh IP",
    );
  },
  failedRequestHandler({ request }) {
    log.error(
      `Prime nav exhausted all retries on ${request.url} — every IP failed. ` +
        "Run finalizes as blocked (0 targets reached).",
    );
  },
});

// LIGHT start URL (facebook.com/) — Crawlee auto-navigates here to reach the
// handler reliably; the heavy Ad Library page is navigated in-handler under our
// own domcontentloaded goto. (A heavy Ad Library start URL hung the auto-nav.)
await bc("module-before-run");
await crawler.run([
  { url: "https://www.facebook.com/", userData: { label: "start" } },
]);
await bc("module-after-run");

// ---- Finalize: RUN_SUMMARY + honest exit code ---------------------------
const statuses = run.targetStatuses.filter(Boolean);
const counts = { ok: 0, empty_verified: 0, blocked: 0, timeout: 0 };
for (const s of statuses) {
  if (s && s.status in counts) counts[s.status] += 1;
}
const verifiedCount = counts.ok + counts.empty_verified;
const unverifiedCount = counts.blocked + counts.timeout;

let outcome;
if (statuses.length === 0) {
  outcome = "error"; // nothing attempted (no targets, or prime never reached data)
} else if (verifiedCount === 0) {
  outcome = "blocked"; // reached targets, none reached the data query
} else if (unverifiedCount > 0) {
  outcome = "partial"; // some verified, some silently failed
} else if (counts.ok > 0) {
  outcome = "ok";
} else {
  outcome = "empty_verified"; // every target reached data, market is empty
}

const modeMix = statuses.reduce((m, s) => {
  m[s.mode] = (m[s.mode] ?? 0) + 1;
  return m;
}, {});

const summary = {
  outcome,
  primerOk: run.primerOk,
  credsMinted: Boolean(run.lsd && run.docId),
  docId: run.docId ?? null,
  counts,
  modeMix,
  targets: statuses.map((s) => ({
    subject: s.subject,
    label: s.label,
    status: s.status,
    items: s.items,
    advertisers: s.advertisers,
    graphqlHits: s.graphqlHits,
    mode: s.mode,
    elapsedMs: s.elapsedMs,
    ip: s.ip ?? null,
  })),
};
await Actor.setValue("RUN_SUMMARY", summary).catch((e) =>
  log.warning(`could not write RUN_SUMMARY: ${e.message}`),
);
await Actor.setStatusMessage(
  `${outcome} · ${JSON.stringify(counts)} · modes=${JSON.stringify(modeMix)}`,
).catch(() => {});
log.info(
  `RUN_SUMMARY outcome=${outcome} credsMinted=${summary.credsMinted} ` +
    `(ok=${counts.ok}, empty_verified=${counts.empty_verified}, ` +
    `blocked=${counts.blocked}, timeout=${counts.timeout}) modes=${JSON.stringify(modeMix)}`,
);

// Fail loud when NO target reached the data query (a clean 0 the adapter could
// mistake for a verified empty). ok/empty_verified/partial exit 0.
if (outcome === "error" || outcome === "blocked") {
  await Actor.fail(`${outcome}: no target reached the data query`);
} else {
  await Actor.exit();
}
