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

async function scrapeTarget(page, target) {
  const store = {
    ads: [],
    seen: new Set(),
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
    if (
      !text ||
      !/ad_archive_id|adArchiveID|ad_library|collated_results/i.test(text)
    ) {
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
    collectAds(json, store);
  };

  page.on("response", onResponse);
  try {
    const gotoUrl = buildUrl(target);
    let resp = await page
      .goto(gotoUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
      .catch((e) => {
        log.warning(`goto failed for "${target.subject}": ${e.message}`);
        return null;
      });
    let status = resp ? resp.status() : "n/a";
    // The FIRST Ad Library load right after the page-resolution hops tends to
    // 403 (the session needs a beat to switch surfaces). Re-warm on facebook.com
    // and retry once so a real "0 ads" isn't confused with a transient block.
    if (status === 403) {
      log.warning(`403 on "${target.subject}" — re-warming + retrying once`);
      await page
        .goto("https://www.facebook.com/", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })
        .catch(() => {});
      await page.waitForTimeout(2500);
      resp = await page
        .goto(gotoUrl, { waitUntil: "domcontentloaded", timeout: 90000 })
        .catch(() => null);
      status = resp ? resp.status() : "n/a";
    }
    await page.waitForTimeout(delayMs);

    // Bounded, self-terminating scroll: stop on maxItems, on 3 stagnant rounds
    // (results connection exhausted), on a 45s per-target time cap, or
    // immediately if nothing loaded after the first couple rounds (blocked /
    // empty) — so a bulk run never burns time/compute on dead targets.
    // Bounded, self-terminating scroll. Key nuance: do NOT treat "no ads yet"
    // as "exhausted" — Meta's first results GraphQL can take 10-15s. So we give
    // a first-result grace window and only count stagnation AFTER ads start
    // arriving. Hard 45s/target cap is the backstop so a bulk run never hangs.
    const deadline = Date.now() + 45_000;
    const firstResultGrace = Date.now() + 18_000;
    let stagnant = 0;
    for (let i = 0; store.ads.length < maxItems && Date.now() < deadline; i++) {
      if (store.ads.length === 0) {
        if (Date.now() > firstResultGrace) break; // nothing after 18s → blocked/empty
      } else if (stagnant >= 3) {
        break; // had results, connection now exhausted
      }
      const before = store.ads.length;
      await page.mouse.wheel(0, 6000).catch(() => {});
      await page.waitForTimeout(delayMs + Math.floor(Math.random() * 600));
      if (store.ads.length > 0 && store.ads.length === before) stagnant += 1;
      else stagnant = 0;
    }

    const ads = store.ads.slice(0, maxItems);
    log.info(
      `${target.label} "${target.subject}" [${country}]: ${ads.length} ads (status=${status}, graphqlHits=${store.graphqlHits})`,
    );
    if (ads.length === 0) {
      const title = await page.title().catch(() => "");
      log.warning(
        `No ads for "${target.subject}" — status=${status}, title="${title}", graphqlHits=${store.graphqlHits}.`,
      );
    }
    if (ads.length) await Actor.pushData(ads);
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

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency: 1,
  maxRequestRetries: 2,
  requestHandlerTimeoutSecs: 300,
  navigationTimeoutSecs: 90,
  // We drive navigation + status handling ourselves; don't let Crawlee abort
  // the whole request on a transient 403 from the priming hop.
  retryOnBlocked: false,
  sessionPoolOptions: { blockedStatusCodes: [] },
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
        if (t === "image" || t === "media" || t === "font") {
          return route.abort();
        }
        return route.continue();
      });
    },
  ],
  async requestHandler({ page }) {
    // The start URL is facebook.com — priming the session so the browser holds
    // a `datr` cookie before we touch the (otherwise-403ing) Ad Library.
    await dismissCookieBanner(page);
    await page.waitForTimeout(1500);
    const cookies = await page.context().cookies();
    const primed = cookies
      .map((c) => c.name)
      .filter((n) => ["datr", "sb", "wd", "fr"].includes(n));
    log.info(`Primed session cookies: ${primed.join(",") || "NONE"}`);

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
      await scrapeTarget(page, target);
    }
  },
  failedRequestHandler({ request }) {
    log.error(`Primer request failed: ${request.url}`);
  },
});

await crawler.run([
  { url: "https://www.facebook.com/", userData: { label: "primer" } },
]);
await Actor.exit();
