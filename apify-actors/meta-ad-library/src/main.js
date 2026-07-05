// Mapsly · Meta (Facebook/Instagram) Ad Library scraper
// ---------------------------------------------------------------------------
// Reads the PUBLIC Ad Library web UI and intercepts its GraphQL responses to
// extract ads. This captures COMMERCIAL ads (e.g. a Calgary med-spa's promos)
// that Meta's official `ads_archive` Graph API does NOT return outside the EU.
//
// Anti-block model (learned from testing — Meta 403s a cold request with no
// `datr` cookie): we run ONE warmed browser session. First we prime on
// facebook.com so the browser acquires `datr`/`sb` cookies + a real fingerprint,
// then we navigate to each Ad Library search URL in the SAME context and listen
// for the search GraphQL responses. Crawlee's auto "block on 403" is disabled so
// we drive navigation manually and can see/handle real statuses.
//
// Pattern otherwise mirrors boxly_reddit_actor: Crawlee PlaywrightCrawler +
// Apify residential proxy + a flat per-ad record via Actor.pushData.

import { Actor, log } from "apify";
import { PlaywrightCrawler } from "crawlee";

await Actor.init();

// ---- Input --------------------------------------------------------------
const input = (await Actor.getInput()) ?? {};
const searchTerms = Array.isArray(input.searchTerms)
  ? input.searchTerms.filter(Boolean)
  : [];
const pageIds = Array.isArray(input.pageIds)
  ? input.pageIds.filter(Boolean)
  : [];
// FB page handles or full URLs (e.g. "theinjectionistcanada" or
// "https://www.facebook.com/theinjectionistcanada/"). Resolved to numeric page
// ids in the primed session, then pulled like pageIds — the precise, low-noise
// path (a business's OWN page, seeded from its website's Facebook link).
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
// `page` matches an advertiser Page by name (precise — the business's OWN ads);
// `keyword_unordered`/`keyword_exact_phrase` match ad text (broad). Page-based
// is what we want for a specific business; keyword is for market discovery.
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
const delayMs = Number.isFinite(input.delayMs)
  ? Math.max(500, input.delayMs)
  : 2000;

if (searchTerms.length === 0 && pageIds.length === 0 && pageUrls.length === 0) {
  throw new Error(
    "Provide at least one of `searchTerms`, `pageIds`, or `pageUrls`.",
  );
}

const country = countries[0];

// Resolved pageUrls are appended here (in the primed session) before scraping.
const targets = [
  ...searchTerms.map((term) => ({ label: "search", subject: String(term) })),
  ...pageIds.map((pageId) => ({ label: "page", subject: String(pageId) })),
];

// ---- Helpers ------------------------------------------------------------
function buildUrl(target) {
  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", activeStatus);
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", country);
  u.searchParams.set("media_type", "all");
  // Meta's Ad Library UI sets this on every keyword search; WITHOUT it the
  // results GraphQL never fires (only the `ad_library_main` shell loads) and
  // the scrape returns 0 ads even for terms with many live advertisers.
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

// Normalize a handle or full URL to a canonical FB page URL. Returns null for
// inputs we can't resolve (numeric profile.php ids skip resolution — they're
// already page ids and should be passed via pageIds instead).
function fbPageUrl(handleOrUrl) {
  let h = String(handleOrUrl).trim();
  const m = h.match(/facebook\.com\/([^/?#]+)/i);
  if (m) h = m[1];
  h = h.replace(/^@/, "").replace(/\/+$/, "");
  if (!h || /^profile\.php$/i.test(h)) return null;
  return `https://www.facebook.com/${encodeURIComponent(h)}/`;
}

// Pull a numeric Facebook page id out of page HTML / GraphQL text. FB embeds it
// under several keys depending on the surface; take the first plausible match.
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

// Resolve a FB handle/URL → numeric page id by visiting it in the primed
// session and scanning the HTML + any GraphQL responses. Best-effort: returns
// null if FB walls the view or no id surfaces (caller logs + skips).
async function resolvePageId(page, handleOrUrl) {
  const url = fbPageUrl(handleOrUrl);
  if (!url) return null;
  let pageId = null;
  const onResp = async (resp) => {
    if (pageId) return;
    try {
      if (!resp.url().includes("facebook.com")) return;
      pageId = extractPageId(await resp.text());
    } catch {
      /* body not readable */
    }
  };
  page.on("response", onResp);
  try {
    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch((e) =>
        log.warning(`resolve goto failed for ${url}: ${e.message}`),
      );
    await page.waitForTimeout(3500);
    if (!pageId) pageId = extractPageId(await page.content().catch(() => ""));
  } finally {
    page.off("response", onResp);
  }
  return pageId;
}

// Meta sometimes prefixes JSON with `for (;;);` and sometimes streams several
// JSON objects separated by newlines (@defer). Normalize both into an array.
function parseFbJson(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith("for (;;);")) t = t.slice(9);
  try {
    return [JSON.parse(t)];
  } catch {
    /* fall through to NDJSON */
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

// ── R1 · fire the search GraphQL directly ─────────────────────────────────
// LIVE-VALIDATION REQUIRED (apify push + botox-Miami vs barber-Kelowna) before
// this path is trusted — its correctness depends on Meta's live GraphQL shape,
// which CANNOT be verified in a source-only edit. It's wired as the PRIMARY
// path with the response-interception scrape kept as the FALLBACK, so a
// regression in this path degrades to R0 behavior, never to a hard failure.
//
// WHY this exists (the #1 silent-block mode): the interception path WAITS for
// the Ad Library React app to happen to fire its own results/facet query, then
// counts `graphqlHits`. When Meta soft-blocks an automated session it serves a
// 200 "Ad Library" shell whose query NEVER fires → graphqlHits stays 0, which
// is indistinguishable from a genuinely empty market by yield alone. If we fire
// the query OURSELVES from the warmed session, `graphqlHits=0 because the UI
// didn't fire` can't happen by construction — a 0 is then a REAL empty (the
// server answered) or a REAL block (the POST 4xx'd / returned an error), and
// the R0 taxonomy can tell them apart honestly.

// Harvest the per-session `lsd` CSRF token Meta requires on every /api/graphql
// POST. It's embedded in the page HTML as `["LSD",[],{"token":"…"}]` and/or a
// hidden `<input name="lsd">`; a `DTSGInitialData` `async_get_token` is an
// occasional alternate. Returns null if none surfaced (caller falls back).
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

// Scrape the Ad Library search `doc_id` (the persisted-query id Meta rotates)
// out of the loaded JS bundle at RUNTIME — never hardcode it: a stale doc_id is
// itself a silent-failure source. We look for a doc_id sitting next to a
// recognizable Ad Library query name. Returns the best candidate or null.
function extractSearchDocId(text) {
  if (!text) return null;
  // Preferred: a doc_id adjacent to an Ad Library search query name.
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

// Pull the doc_id + lsd from the warmed page. We read them from the rendered
// HTML AND from the URLs/bodies of any /api/graphql calls the shell already
// fired (whose Request objects Playwright exposes), whichever surfaces first.
async function harvestGraphqlCreds(page) {
  const html = await page.content().catch(() => "");
  let lsd = extractLsd(html);
  let docId = extractSearchDocId(html);
  // The JS bundle carrying the doc_id is often a separate script; scan the
  // scripts we can read from the DOM as a second source.
  if (!docId) {
    const scriptText = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("script"))
          .map((s) => s.textContent || "")
          .filter((t) => t.includes("doc_id"))
          .join("\n")
          .slice(0, 500_000),
      )
      .catch(() => "");
    docId = extractSearchDocId(scriptText);
    if (!lsd) lsd = extractLsd(scriptText);
  }
  return { lsd, docId };
}

// Build the GraphQL variables for an advertiser/keyword search. Meta's
// AdLibrary search query takes a `params` blob; we send the same fields the UI
// URL carries so the server returns the advertiser facet + (when un-withheld)
// the creative results, plus a cursor for pagination.
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

// Fire the search query directly from the warmed session and cursor-paginate
// via `page_info.has_next_page` / `end_cursor`. Feeds every response through
// the SAME `store` the interception path fills (so advertiser-facet extraction,
// ad collection, and graphqlHits accounting are shared). Returns:
//   "verified" — the POST reached Meta's data query (≥1 valid GraphQL response),
//                so graphqlHits was bumped: a 0-yield here is a REAL empty.
//   "unavailable" — creds missing or every POST errored/4xx'd: caller keeps the
//                interception fallback (do NOT treat as verified-empty).
async function directGraphqlScrape(page, target, store) {
  const { lsd, docId } = await harvestGraphqlCreds(page);
  if (!lsd || !docId) {
    log.info(
      `[direct] creds missing for "${target.subject}" (lsd=${Boolean(lsd)}, docId=${Boolean(docId)}) — fall back to interception`,
    );
    return "unavailable";
  }
  log.info(`[direct] "${target.subject}" using doc_id=${docId}`);

  let cursor = null;
  let anyReached = false;
  const MAX_PAGES = 8;
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum += 1) {
    const variables = buildSearchVariables(target, cursor);
    // Meta's persisted-query POST body: form-encoded, lsd + doc_id + variables.
    const body = new URLSearchParams({
      lsd,
      doc_id: docId,
      variables: JSON.stringify(variables),
      server_timestamps: "true",
    }).toString();

    let text = "";
    try {
      // page.request runs in the browser context → carries the primed cookies
      // (datr/sb) automatically, so the POST is authenticated like the UI's own.
      const resp = await page.request.post(
        "https://www.facebook.com/api/graphql/",
        {
          data: body,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-fb-lsd": lsd,
            "x-asbd-id": "129477",
            origin: "https://www.facebook.com",
            referer: buildUrl(target),
          },
          timeout: 30000,
        },
      );
      if (!resp.ok()) {
        log.warning(
          `[direct] POST HTTP ${resp.status()} for "${target.subject}" p${pageNum} — fall back`,
        );
        return anyReached ? "verified" : "unavailable";
      }
      text = await resp.text();
    } catch (e) {
      log.warning(`[direct] POST threw for "${target.subject}": ${e.message}`);
      return anyReached ? "verified" : "unavailable";
    }

    // An error payload (`{"errors":[…]}` with no data keys) is a BLOCK, not an
    // empty — don't count it as reaching the data query.
    if (!/ad_archive_id|adArchiveID|ad_library|collated_results/i.test(text)) {
      if (/"errors?"\s*:/.test(text) && !/"data"\s*:/.test(text)) {
        log.warning(
          `[direct] error payload for "${target.subject}" p${pageNum} — fall back`,
        );
        return anyReached ? "verified" : "unavailable";
      }
      // A well-formed but ad-key-less response still means the server answered
      // our query (a genuine empty for this page) — count it as reached.
      const parsedEmpty = parseFbJson(text);
      if (parsedEmpty) {
        anyReached = true;
        store.graphqlHits += 1;
      }
      break;
    }

    const json = parseFbJson(text);
    if (!json) {
      return anyReached ? "verified" : "unavailable";
    }
    anyReached = true;
    store.graphqlHits += 1;
    ingestJson(json, store); // shared facet + ad extraction (same as interception)

    // Cursor-paginate via page_info. Robust to Meta nesting it under different
    // wrappers — take the first has_next_page/end_cursor we can find.
    const pageInfo = findPageInfo(json);
    if (!pageInfo || !pageInfo.has_next_page || !pageInfo.end_cursor) break;
    if (store.ads.length >= maxItems) break;
    cursor = pageInfo.end_cursor;
  }
  return anyReached ? "verified" : "unavailable";
}

// Walk a GraphQL response for the first `page_info` object carrying pagination.
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
    // The input handle/URL this ad was resolved from (set for pageUrls targets)
    // — lets the consumer attribute each ad to the business it asked about,
    // even when the page name shares no distinctive token with the biz name.
    resolvedFromUrl: target.resolvedFrom ?? null,
    country,
    scrapedAt: new Date().toISOString(),
  };
}

// Ingest ONE parsed GraphQL response into the shared `store`: pull the
// advertiser facet (the reliable "who advertises for this search" list Meta
// returns even when it withholds per-creative results) AND every ad node. Used
// by BOTH the response-interception path and the R1 direct-GraphQL path so the
// two share identical extraction + dedup. Does NOT bump graphqlHits — the
// caller owns that (the interception path only counts ad-key-bearing bodies;
// the direct path counts every server answer, incl. verified-empty pages).
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

// Walk an arbitrary JSON tree and pull every object that carries an
// ad_archive_id. Robust to Meta reshaping the wrapper structure.
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
      continue; // don't descend into an ad node
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
        await page.waitForTimeout(1200);
        return true;
      }
    } catch {
      /* banner not present / not clickable */
    }
  }
  return false;
}

// Classify one target's outcome from the discriminator (graphqlHits) + yield.
//   ok             — data query fired AND we found advertisers/ads
//   empty_verified — data query fired but the market is genuinely empty
//   blocked        — data query NEVER fired after all retries (soft-block/403)
//   timeout        — navigation/proxy timeout reached the target before any data
// `ok`/`empty_verified` are VERIFIED outcomes (the run reached Meta's data
// query); `blocked`/`timeout` are silent-failure classes that must NOT be
// mistaken for a clean 0 downstream.
function classifyOutcome({ graphqlHits, items, advertisers, navFailed }) {
  if (graphqlHits > 0 || items > 0 || advertisers > 0) {
    return items > 0 || advertisers > 0 ? "ok" : "empty_verified";
  }
  return navFailed ? "timeout" : "blocked";
}

// R0 · best-effort egress IP for attribution. When a target is blocked we retire
// the session (rotate the exit node), but WHICH IP served the block is only
// useful if we record it. `page.request` rides the SAME proxy hop as the page,
// so an echo call returns the actual exit IP. Fully guarded — a failure (echo
// down / timeout) degrades to null, never affects the scrape outcome.
async function currentEgressIp(page) {
  try {
    // Attribution-only, so keep the cap tight (2.5s): on a bad IP the target is
    // already timing out — we must not add the full echo timeout on top of it.
    const res = await page.request.get("https://api.ipify.org?format=json", {
      timeout: 2500,
    });
    const body = await res.json();
    return typeof body?.ip === "string" ? body.ip : null;
  } catch {
    return null;
  }
}

// Retire the current Crawlee session so the next navigation gets a FRESH proxy
// IP. Apify residential IPs die in ~60s, so re-warming the SAME session re-hits
// a dead IP — session.retire() is what actually rotates the exit node. Session
// is optional (present when the crawler's SessionPool is enabled); no-op if not.
function rotateSession(session, reason) {
  if (session && typeof session.retire === "function") {
    try {
      session.retire();
      log.info(`session retired (${reason}) — next hop gets a fresh IP`);
      return true;
    } catch {
      /* best-effort rotation */
    }
  }
  return false;
}

async function scrapeTarget(page, target, session) {
  const store = {
    ads: [],
    seen: new Set(),
    advertisers: [],
    advSeen: new Set(),
    target,
    graphqlHits: 0,
    keysLogged: false,
  };

  const onResponse = async (response) => {
    if (!response.url().includes("/api/graphql")) return;
    let text;
    try {
      text = await response.text();
    } catch {
      return;
    }
    if (!text) return;
    // DIAG: log the shape of every GraphQL response so we can see where the ad
    // nodes live now (Meta reshapes this). Logs len + whether it carries an ad
    // id + the top-level data keys, for the first ~30 responses per target.
    if ((store.diagCount ?? 0) < 30) {
      store.diagCount = (store.diagCount ?? 0) + 1;
      const hasAdId = /ad_archive_id|adArchiveID/i.test(text);
      let dk = "";
      try {
        const jj = parseFbJson(text);
        const ss = Array.isArray(jj) ? jj[0] : jj;
        dk = Object.keys(ss?.data ?? ss ?? {})
          .slice(0, 8)
          .join(",");
      } catch {
        /* diag only */
      }
      log.info(
        `[diag] gql#${store.diagCount} len=${text.length} adId=${hasAdId} keys=[${dk}]`,
      );
      if (text.length < 4000) {
        log.info(`[diag] body#${store.diagCount}: ${text.slice(0, 3500)}`);
      }
    }
    if (!/ad_archive_id|adArchiveID|ad_library|collated_results/i.test(text)) {
      return;
    }
    store.graphqlHits += 1;
    const json = parseFbJson(text);
    if (!json) return;
    if (!store.keysLogged) {
      try {
        const sample = Array.isArray(json) ? json[0] : json;
        log.info(
          `[diag] ads GraphQL keys: ${Object.keys(sample?.data ?? sample ?? {}).join(", ")}`,
        );
      } catch {
        /* diagnostic only */
      }
      store.keysLogged = true;
    }
    // Shared facet + ad extraction (advertiser facet from
    // data.ad_library_main.dynamic_filter_options.pages + every ad node) — same
    // code the R1 direct-GraphQL path runs, so both stay in lockstep.
    ingestJson(json, store);
  };

  page.on("response", onResponse);
  let navFailed = false;
  try {
    const gotoUrl = buildUrl(target);
    let status = "n/a";
    // BLOCK-RESILIENT LOAD. Meta soft-blocks automated sessions intermittently:
    // a 403, or a 200 "Ad Library" shell whose results/facet GraphQL never fires
    // (graphqlHits stays 0). That's INDISTINGUISHABLE in the output from a
    // genuine empty market unless we track graphqlHits — a real (even empty)
    // result fires the data query (graphqlHits ≥ 1). So we retry the load while
    // graphqlHits === 0. Crucially we ROTATE THE IP between attempts (retire the
    // session → fresh residential exit node) rather than re-warming the SAME
    // (often-dead) IP: Apify residential IPs die in ~60s, so re-`goto`ing
    // facebook.com on a corpse just retries a corpse (the old bug). We stop the
    // instant the data query fires (real result, even if 0 advertisers).
    const MAX_BLOCK_RETRIES = 4;
    navFailed = false;
    for (let attempt = 1; attempt <= MAX_BLOCK_RETRIES; attempt += 1) {
      if (attempt > 1) {
        log.warning(
          `"${target.subject}" blocked (graphqlHits=0, status=${status}) — rotate IP + retry ${attempt}/${MAX_BLOCK_RETRIES}`,
        );
        // Rotate to a fresh IP, then re-prime facebook.com on the NEW node so
        // it re-acquires datr/sb before we re-hit the Ad Library.
        rotateSession(session, `target "${target.subject}" blocked`);
        await page
          .goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          })
          .catch(() => {});
        await page.waitForTimeout(1200 + attempt * 800);
      }
      const resp = await page
        .goto(gotoUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
        .catch((e) => {
          log.warning(`goto failed for "${target.subject}": ${e.message}`);
          navFailed = true;
          return null;
        });
      if (resp) navFailed = false;
      status = resp ? resp.status() : "n/a";
      // The Ad Library page can show its OWN cookie/consent overlay that blocks
      // the React app from firing the results query. Dismiss it here too.
      await dismissCookieBanner(page).catch(() => {});

      // R1 · PRIMARY path — fire the search GraphQL ourselves from the warmed
      // session so `graphqlHits=0 because the UI never fired` can't happen. On
      // "verified" the server answered our query (graphqlHits bumped) → a 0 is a
      // REAL empty, not a silent block. On "unavailable" (creds missing / POST
      // 4xx'd) we fall through to the interception poll below, unchanged.
      // NOTE: needs `apify push` + live validation (botox-Miami vs
      // barber-Kelowna) before it's trusted — unverifiable in a source-only edit.
      const direct = await directGraphqlScrape(page, target, store).catch(
        (e) => {
          log.warning(
            `[direct] scrape threw for "${target.subject}": ${e.message}`,
          );
          return "unavailable";
        },
      );
      if (direct === "verified" || store.graphqlHits > 0) {
        break; // the query provably reached Meta's server — accept (even if 0)
      }

      // FALLBACK · interception poll — wait for the UI to happen to fire the
      // data GraphQL (graphqlHits ≥ 1) or the deadline. Kept as the safety net
      // when the direct POST couldn't run.
      const waitDeadline = Date.now() + 9000;
      while (
        Date.now() < waitDeadline &&
        store.graphqlHits === 0 &&
        store.advertisers.length === 0 &&
        store.ads.length === 0
      ) {
        await page.waitForTimeout(400);
      }
      // Data query fired → real result (accept it, even if 0 advertisers).
      if (
        store.graphqlHits > 0 ||
        store.advertisers.length ||
        store.ads.length
      ) {
        break;
      }
    }
    // Brief settle so a multi-burst facet finishes streaming before we read it.
    if (store.advertisers.length > 0 || store.ads.length > 0) {
      await page.waitForTimeout(700);
    }

    const ads = store.ads.slice(0, maxItems);
    const advertisers = store.advertisers;
    // A target that reached the data query but produced nothing is a REAL empty;
    // one that never fired it (after every retry) is a silent block/timeout. The
    // discriminator (graphqlHits) is emitted, not thrown away.
    const outcome = classifyOutcome({
      graphqlHits: store.graphqlHits,
      items: ads.length,
      advertisers: advertisers.length,
      navFailed,
    });
    log.info(
      `${target.label} "${target.subject}" [${country}]: ${ads.length} ads, ${advertisers.length} advertisers ` +
        `(outcome=${outcome}, status=${status}, graphqlHits=${store.graphqlHits})`,
    );
    if (outcome === "blocked" || outcome === "timeout") {
      const title = await page.title().catch(() => "");
      log.warning(
        `SILENT-FAIL "${target.subject}" outcome=${outcome} — status=${status}, title="${title}", graphqlHits=${store.graphqlHits}.`,
      );
      // Retire the session so a subsequent target starts on a fresh IP.
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
    // R0 · attribute the outcome to the exit IP that served it (best-effort;
    // null when the echo fails). Especially load-bearing for blocked/timeout —
    // it lets us tell a dead-IP block from a genuine content block downstream.
    const ip = await currentEgressIp(page);
    // Per-target status record — the machine-readable outcome the adapter reads
    // so a blocked "0" can never be mistaken for a verified empty.
    await Actor.pushData({
      recordType: "target_status",
      subject: target.subject,
      label: target.label,
      status: outcome,
      items: ads.length,
      advertisers: advertisers.length,
      graphqlHits: store.graphqlHits,
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
      ip,
    };
  } finally {
    page.off("response", onResponse);
  }
}

// ---- Crawler ------------------------------------------------------------
const proxyConfiguration = await Actor.createProxyConfiguration(
  input.proxyConfiguration ?? {
    groups: ["RESIDENTIAL"],
    countryCode: country,
  },
);

// ---- Run state ----------------------------------------------------------
// Accumulated across the (single) request so the finalizer can write a
// machine-readable RUN_SUMMARY + decide the run's exit code AFTER the crawler
// returns — even if the handler threw. `primerOk` is a DIAGNOSTIC flag only
// (surfaced in RUN_SUMMARY): it records whether the isolated prime acquired
// `datr`, but it NO LONGER gates the run — targets are attempted regardless, and
// the run-level outcome is decided by what those targets actually reached.
const run = {
  primerOk: false,
  targetStatuses: [],
};

// BEST-EFFORT PRIMER (non-blocking). A primed `datr` makes the R1 direct-GraphQL
// replay work, so priming is worth attempting — but it is NOT a precondition for
// reaching data (each target re-primes on its own during the block-retry loop).
// This primes with a LIGHT load (`domcontentloaded`, ~20s), and on failure
// ROTATES to a fresh IP and retries (up to 4), falling back to the Ad Library
// landing page as an alternate priming endpoint. Success = we acquired at least a
// `datr` cookie (Meta's anti-bot token) on a live IP. Returns true if primed,
// false if every attempt (across fresh IPs + both endpoints) failed — the caller
// logs it and proceeds to the targets regardless (the failure is NOT fatal).
async function primeSession(page, session) {
  const endpoints = [
    "https://www.facebook.com/",
    "https://www.facebook.com/ads/library/",
  ];
  const MAX_PRIME_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_PRIME_RETRIES; attempt += 1) {
    if (attempt > 1) {
      // Don't re-warm the same (often-dead) IP — retire the session first.
      rotateSession(session, `primer attempt ${attempt}`);
      await page.waitForTimeout(600 * attempt);
    }
    const endpoint = endpoints[(attempt - 1) % endpoints.length];
    const resp = await page
      .goto(endpoint, { waitUntil: "domcontentloaded", timeout: 20000 })
      .catch((e) => {
        log.warning(`primer goto failed (${endpoint}): ${e.message}`);
        return null;
      });
    if (!resp) continue; // nav failed (timeout/proxy) → rotate + retry
    await dismissCookieBanner(page).catch(() => {});
    await page.waitForTimeout(1200);
    const cookies = await page
      .context()
      .cookies()
      .catch(() => []);
    const primed = cookies
      .map((c) => c.name)
      .filter((n) => ["datr", "sb", "wd", "fr"].includes(n));
    log.info(
      `Primer attempt ${attempt}/${MAX_PRIME_RETRIES} (${endpoint}): cookies=${primed.join(",") || "NONE"}`,
    );
    // A `datr` cookie means Meta accepted the priming hop on a live IP.
    if (primed.includes("datr")) return true;
  }
  return false;
}

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency: 1,
  maxRequestRetries: 2,
  requestHandlerTimeoutSecs: 300,
  navigationTimeoutSecs: 90,
  // We drive navigation + status handling ourselves; don't let Crawlee abort
  // the whole request on a transient 403 from the priming hop.
  retryOnBlocked: false,
  // Session rotation is the block fix (NOT stealth). Keep a small pool of
  // sessions so `session.retire()` on a soft-block hands us a FRESH proxy IP
  // instead of re-warming the (often-dead) current one. `blockedStatusCodes:[]`
  // keeps Crawlee from auto-aborting on Meta's transient 403s during priming —
  // we classify + rotate manually. Retire the browser after a few pages so a
  // long multi-target run doesn't ride one stale fingerprint the whole way.
  useSessionPool: true,
  sessionPoolOptions: { maxPoolSize: 8, blockedStatusCodes: [] },
  // `retireBrowserAfterPageCount` is a BrowserPool option, NOT a top-level
  // PlaywrightCrawler option — Crawlee 3.16 rejects it at the top level with a
  // hard `ArgumentError` on construction (crashes the run before it starts).
  browserPoolOptions: { retireBrowserAfterPageCount: 6 },
  launchContext: {
    launchOptions: { args: ["--disable-blink-features=AutomationControlled"] },
  },
  // Scale lever: abort image/media/font requests so a bulk run stays well
  // inside the Apify residential bandwidth budget. The Ad Library GraphQL we
  // read is unaffected — we only skip downloading heavy creatives (we keep
  // their URLs from the JSON).
  preNavigationHooks: [
    async ({ page }) => {
      await page.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (
          t === "image" ||
          t === "media" ||
          t === "font" ||
          t === "stylesheet"
        ) {
          return route.abort();
        }
        return route.continue();
      });
    },
  ],
  async requestHandler({ page, session }) {
    // The start URL is facebook.com — the crawler already navigated there. RE-
    // prime through the un-zeroable primer so a dead-IP `ERR_TIMED_OUT` rotates
    // to a fresh IP instead of silently zeroing the whole run.
    //
    // PRIMING IS NON-BLOCKING (regression fix). A successful prime (`datr`
    // acquired) makes the R1 direct-GraphQL replay work — it's a speed/reliability
    // win, NOT a precondition for reaching data. The gate that USED to `return`
    // here on a failed prime discarded the entire resilient path: `scrapeTarget`
    // itself navigates each target's Ad Library page and its `onResponse`
    // interceptor harvests the page's OWN GraphQL, AND its per-attempt block-retry
    // loop re-primes facebook.com on a fresh IP each round. That page-scrape path
    // reached Meta ~47% of runs historically WITHOUT any standalone-primer gate.
    // A Meta block wave that denies `datr` on the isolated prime made `primerOk`
    // false on every IP → the gate zeroed the whole run to `error` with 0 targets
    // even attempted. So: prime best-effort, log it, then ALWAYS proceed to the
    // targets. `run.primerOk` is now just a diagnostic flag in RUN_SUMMARY; the
    // run-level outcome is decided by what the TARGETS actually reached, not by
    // whether the isolated prime survived.
    run.primerOk = await primeSession(page, session);
    if (!run.primerOk) {
      log.warning(
        "Primer did not acquire datr on any IP — proceeding to targets anyway; " +
          "each target navigates its own Ad Library page + intercepts its GraphQL, " +
          "and re-primes on a fresh IP per block-retry (the resilient fallback path).",
      );
    }

    // Resolve any FB page URLs → numeric ids in the warmed session, then pull
    // their ads via the precise view_all_page_id path.
    for (const pu of pageUrls) {
      const id = await resolvePageId(page, pu);
      if (id) {
        log.info(`Resolved "${pu}" → page_id ${id}`);
        // Emit a resolution record so the consumer can cache the page id even
        // when the page has 0 ads (skips re-resolving the website next run).
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

    if (targets.length === 0) {
      log.warning("No scrapable targets after resolution.");
    }
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      const st = await scrapeTarget(page, target, session);
      run.targetStatuses.push(st);
    }
  },
  failedRequestHandler({ request }) {
    log.error(`Primer request failed: ${request.url}`);
  },
});

await crawler.run([
  { url: "https://www.facebook.com/", userData: { label: "primer" } },
]);

// ---- Finalize: RUN_SUMMARY + honest exit code ---------------------------
// Roll the per-target outcomes into ONE run outcome + counts, write it to the
// KV store (the adapter reads it after the run), and set the exit code so
// "SUCCEEDED" actually means "reached Meta's data query on ≥1 target".
//
// `error` is reserved for the ONE case where NO target could even be attempted
// (no scrapable targets — e.g. every pageUrl failed to resolve). Priming failure
// alone NO LONGER forces `error`: a failed prime still lets every target navigate
// its own Ad Library page + intercept its GraphQL, so a run that primed poorly but
// reached data is honestly `ok`/`empty_verified`/`partial`, and one that reached
// every target but got graphqlHits==0 on all of them is `blocked` (the data query
// never fired), NOT `error`.
//   - error   → NOTHING was attempted (0 targets): the run couldn't even try
//   - blocked → every target was attempted but none reached the data query
//   - partial → some targets verified, some blocked/timeout
//   - ok / empty_verified → every target reached the data query (real results
//     or a real empty market)
// `Actor.fail()` (exit ≠ 0) on error/blocked so the run status is FAILED and the
// adapter can't cache it as a clean empty; ok/empty_verified/partial exit 0.
const statuses = run.targetStatuses.filter(Boolean);
const counts = { ok: 0, empty_verified: 0, blocked: 0, timeout: 0 };
for (const s of statuses) {
  if (s && s.status in counts) counts[s.status] += 1;
}
const verifiedCount = counts.ok + counts.empty_verified;
const unverifiedCount = counts.blocked + counts.timeout;

let outcome;
if (statuses.length === 0) {
  // No target was attempted at all (no searchTerms/pageIds and every pageUrl
  // failed to resolve) — the only genuine run-level `error`. A poor prime is
  // NOT this case: targets still get attempted below.
  outcome = "error";
} else if (verifiedCount === 0) {
  outcome = "blocked"; // reached targets, none reached the data query
} else if (unverifiedCount > 0) {
  outcome = "partial"; // some verified, some silently failed
} else if (counts.ok > 0) {
  outcome = "ok";
} else {
  outcome = "empty_verified"; // every target reached data, market is empty
}

const summary = {
  outcome,
  primerOk: run.primerOk,
  counts,
  targets: statuses.map((s) => ({
    subject: s.subject,
    label: s.label,
    status: s.status,
    items: s.items,
    advertisers: s.advertisers,
    graphqlHits: s.graphqlHits,
    ip: s.ip ?? null,
  })),
};
await Actor.setValue("RUN_SUMMARY", summary).catch((e) =>
  log.warning(`could not write RUN_SUMMARY: ${e.message}`),
);
await Actor.setStatusMessage(outcome).catch(() => {});
log.info(
  `RUN_SUMMARY outcome=${outcome} ` +
    `(ok=${counts.ok}, empty_verified=${counts.empty_verified}, blocked=${counts.blocked}, timeout=${counts.timeout})`,
);

// Fail loud when NO target reached the data query — a clean 0 the adapter could
// mistake for a verified empty. A run with ANY ok/empty_verified target exits 0
// (partial included: it carries real data worth keeping).
if (outcome === "error" || outcome === "blocked") {
  await Actor.fail(`${outcome}: no target reached the data query`);
} else {
  await Actor.exit();
}
