// Mapsly DOM Fetcher — a minimal "Cloudflare-busting DOM fetcher".
// It does the ONE thing that requires a real browser + residential proxy:
// navigate, clear Cloudflare, return the rendered HTML. ALL parsing
// (contacts, tech, services, AI) happens on our backend from this DOM.
//
// R3 · FAIL-LOUD discipline (same as the Meta actor's R0). Previously EVERY
// exit was Actor.exit() (status SUCCEEDED) — a run where every URL was
// Cloudflare-walled or dead (the original ERR_TIMED_OUT@blkmktsmp.com burning
// its retry ladder) looked identical to a clean fetch. Now each URL carries a
// per-target `outcome` (ok · empty_verified · blocked · timeout · error), the
// run writes a machine-readable RUN_SUMMARY, and Actor.fail()s when NO url
// reached rendered content — so the consumer treats a fully-walled run as
// retryable-failed, never a clean empty. Per-row html + flags are UNCHANGED, so
// the existing adapter (services/dom-fetcher/fetcher.ts → toDomResult) keeps
// working; the new `outcome` field is additive.
//
// LIGHTHOUSE MODE (input.lighthouse=true) restored 2026-07-11. It lived on the
// live v1.1.2 build but was dropped from this R3 rewrite (the INC-51 git-vs-live
// drift). Merged back here so git == live and this file is a SUPERSET of both:
// after clearing CF, it runs a real mobile Lighthouse audit in the SAME cleared
// session, so a Cloudflare-walled site DataForSEO can't reach still gets a score.
import { Actor } from "apify";
import { PlaywrightCrawler } from "crawlee";

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const urls = input.urls?.length ? input.urls : input.url ? [input.url] : [];
if (!urls.length) {
  await Actor.fail("Provide `url` or `urls`");
}
const country = input.country || "US";
const cfWaitMs = input.cfWaitMs ?? 14000; // bounded Cloudflare-clear wait
// Lighthouse mode: after clearing CF, run a real mobile Lighthouse audit IN THE
// SAME cleared session (reuses the cf_clearance). Pins a fixed remote-debug port
// so it can attach to the browser → forces maxConcurrency 1 in this mode.
const wantLH = !!input.lighthouse;
const LH_PORT = 9222;
const maxConcurrency = wantLH ? 1 : (input.maxConcurrency ?? 10); // memory drives true parallelism (DOM mode)
const retireAfter = input.retireBrowserAfterPageCount ?? 20; // recycle → no leaks

const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ["RESIDENTIAL"],
  countryCode: country,
});
const CF =
  /just a moment|attention required|checking your browser|verifying you are human|cf-browser-verification/i;
// Title-only detection misses 2026 Turnstile / managed challenges (they don't
// change document.title). These markers live in the challenge page BODY and are
// high-precision — they appear ONLY on an actual challenge, never on a normal
// Cloudflare-fronted site — so matching them can't over-block legit CF sites.
const BODY_CHALLENGE =
  /challenges\.cloudflare\.com|_cf_chl_opt|cf-browser-verification|id="challenge-(?:form|running|error)"|turnstile\/v0/i;
const BLOCK = new Set(["image", "media", "font", "stylesheet"]); // keep document/script/xhr (CF needs JS)

// A rendered page below this many bytes is a verified-empty, not a real fetch.
// MIRRORS services/dom-fetcher/outcome.ts DOM_EMPTY_BYTE_THRESHOLD — keep in
// lockstep (the app re-derives the same outcome for older rows).
const EMPTY_BYTE_THRESHOLD = 512;

// Per-URL outcomes accumulated across the run so the finalizer can roll a
// RUN_SUMMARY + decide the exit code AFTER the crawler returns.
const outcomes = []; // { url, outcome }
const failed = [];

// Sniff a timeout from an error string (Playwright/CDP phrasing) — MIRRORS
// services/dom-fetcher/outcome.ts looksLikeTimeout.
function looksLikeTimeout(msg) {
  return /timeout|timed?[-\s]?out|err_timed_out|navigation timeout|deadline/i.test(
    String(msg || ""),
  );
}

// Classify ONE fetch outcome. MIRRORS services/dom-fetcher/outcome.ts
// classifyDomFetch — the app's pure classifier is the single source of truth;
// this copy exists only because actors can't import app code.
function classifyDomFetch({
  blocked,
  failed: didFail,
  status,
  htmlBytes,
  error,
}) {
  if (blocked === true || status === 403) return "blocked";
  const hasHtml = typeof htmlBytes === "number" && htmlBytes > 0;
  if (didFail === true || !hasHtml) {
    return looksLikeTimeout(error) ? "timeout" : "error";
  }
  return htmlBytes >= EMPTY_BYTE_THRESHOLD ? "ok" : "empty_verified";
}

// Map the proxy exit country to a plausible locale list so the injected
// fingerprint's Accept-Language matches the residential IP's geo (mirrors the
// Meta actor's helper). A random-locale desktop fingerprint on a US/CA IP is a
// bot-tell that invites more Cloudflare challenges → burns the retry ladder.
function localesForCountry(cc) {
  const c = String(cc || "US").toUpperCase();
  if (c === "CA") return ["en-CA", "en-US", "en"];
  if (c === "GB" || c === "UK") return ["en-GB", "en"];
  if (c === "AU") return ["en-AU", "en"];
  return ["en-US", "en"];
}

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency,
  minConcurrency: 2,
  // 2 fresh IPs is enough: a site still walled after 2 rotations needs a real
  // CAPTCHA solve (dead-lettered by failedRequestHandler → blocked), not more
  // rotations. Attempts 3-6 were near-pure residential burn (35s nav + 14s wait
  // each, ×maxConcurrency) on sites already headed for the dead-letter.
  maxRequestRetries: 2,
  navigationTimeoutSecs: 35,
  requestHandlerTimeoutSecs: wantLH ? 150 : 55, // LH audit needs headroom
  headless: true,
  // Lighthouse attaches to this browser over a fixed remote-debugging port.
  launchContext: wantLH
    ? { launchOptions: { args: [`--remote-debugging-port=${LH_PORT}`] } }
    : undefined,
  browserPoolOptions: {
    useFingerprints: true,
    retireBrowserAfterPageCount: retireAfter,
    // Pin the fingerprint's locale/OS to the proxy exit country so Accept-Language
    // matches the residential IP's geo (see localesForCountry note above).
    fingerprintOptions: {
      fingerprintGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 120 }],
        devices: ["desktop"],
        operatingSystems: ["windows", "macos"],
        locales: localesForCountry(country),
      },
    },
  },
  preNavigationHooks: [
    async ({ page }) => {
      // Block heavy assets ONLY in DOM mode. Lighthouse must load everything
      // (images/CSS/fonts) to score performance accurately.
      if (!wantLH)
        await page
          .route("**/*", (r) =>
            BLOCK.has(r.request().resourceType()) ? r.abort() : r.continue(),
          )
          .catch(() => {});
    },
  ],
  async requestHandler({ page, request, response, log }) {
    let title = await page.title().catch(() => "");
    // `cf-mitigated: challenge` is Cloudflare's own header on a managed-challenge
    // response — a reliable signal for Turnstile challenges that leave the title
    // untouched. (A plain `cf-ray` is NOT a challenge — every CF-fronted site
    // sets it — so we key only off `cf-mitigated`.)
    const cfMitigated = String(
      response?.headers?.()?.["cf-mitigated"] ?? "",
    ).toLowerCase();
    if (CF.test(title) || cfMitigated === "challenge") {
      await page
        .waitForFunction(
          () =>
            !/just a moment|attention required|checking your browser|verifying you are human/i.test(
              document.title,
            ),
          { timeout: cfWaitMs },
        )
        .catch(() => {});
      title = await page.title().catch(() => "");
    }
    const status = response?.status();
    const html = await page.content(); // <-- the ONLY product of this actor: the rendered DOM
    // CANARY: the challenge is STILL up if the title matches, the status is 403,
    // OR the rendered BODY carries a Turnstile/managed-challenge marker — the
    // last one is the fix for title-only detection (Turnstile keeps the real
    // title). Throw so Crawlee retries on a fresh session/proxy; if every retry
    // fails, failedRequestHandler dead-letters it with outcome=blocked.
    if (CF.test(title) || status === 403 || BODY_CHALLENGE.test(html))
      throw new Error("Cloudflare not cleared — retry new session/proxy");
    const htmlBytes = html.length;
    const outcome = classifyDomFetch({
      blocked: false,
      failed: false,
      status,
      htmlBytes,
    });

    // Lighthouse mode (input.lighthouse=true): audit the just-cleared session so a
    // Cloudflare-walled site DataForSEO can't reach still gets a real mobile score.
    // Additive — the DOM path above is untouched. Emits the EXACT block the app
    // adapter's RawLighthouse expects (services/dom-fetcher/fetcher.ts).
    let lighthouse = null;
    if (wantLH) {
      const lt0 = Date.now();
      try {
        const { playAudit } = await import("playwright-lighthouse");
        const { lhr } = await playAudit({
          page,
          port: LH_PORT,
          thresholds: {},
          opts: {
            formFactor: "mobile",
            screenEmulation: {
              mobile: true,
              width: 412,
              height: 823,
              deviceScaleFactor: 2.6,
              disabled: false,
            },
            onlyCategories: [
              "performance",
              "accessibility",
              "best-practices",
              "seo",
            ],
          },
        });
        const c = lhr.categories;
        const a = lhr.audits;
        const sc = (x) => (x?.score == null ? null : Math.round(x.score * 100));
        const failing = Object.values(a)
          .filter((x) => x && typeof x.score === "number" && x.score < 0.9)
          .map((x) => ({
            title: x.title,
            score: Math.round(x.score * 100),
            val: x.displayValue || null,
          }))
          .sort((p, q) => p.score - q.score)
          .slice(0, 8);
        lighthouse = {
          ok: true,
          lhVersion: lhr.lighthouseVersion,
          finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl,
          scores: {
            performance: sc(c.performance),
            accessibility: sc(c.accessibility),
            best_practices: sc(c["best-practices"]),
            seo: sc(c.seo),
          },
          cwv: {
            LCP_ms: Math.round(
              a["largest-contentful-paint"]?.numericValue || 0,
            ),
            CLS: a["cumulative-layout-shift"]?.numericValue ?? null,
            TBT_ms: Math.round(a["total-blocking-time"]?.numericValue || 0),
            FCP_ms: Math.round(a["first-contentful-paint"]?.numericValue || 0),
          },
          fixable_wins: failing.map(
            (f) => `${f.title} (${f.score}/100${f.val ? ", " + f.val : ""})`,
          ),
          lh_seconds: Math.round((Date.now() - lt0) / 1000),
        };
      } catch (e) {
        lighthouse = {
          ok: false,
          error: String(e?.message || e),
          lh_seconds: Math.round((Date.now() - lt0) / 1000),
        };
      }
    }

    log.info(
      `OK ${request.url} status=${status} bytes=${htmlBytes} outcome=${outcome} ` +
        `lh=${lighthouse ? (lighthouse.ok ? "ok" : "ERR") : "off"}`,
    );
    outcomes.push({ url: request.url, outcome });
    await Actor.pushData({
      url: request.url,
      finalUrl: page.url(),
      status,
      title,
      blocked: false,
      failed: false,
      // R3 · per-target outcome so a verified-empty page (reached content, thin)
      // is distinguishable from a block/timeout downstream. Additive.
      outcome,
      htmlBytes,
      html,
      // Present only in Lighthouse mode; null in DOM mode. The app reads this via
      // fetchLighthouse → toActorLighthouse.
      lighthouse,
    });
  },
  async failedRequestHandler({ request, response }, err) {
    const status = response?.status() ?? null;
    const errMsg = String(err?.message || err);
    // Classify the dead-letter: a CF/403 wall is `blocked`, a timeout is
    // `timeout`, anything else is `error` — all RETRYABLE silent failures the
    // consumer must NOT treat as a clean empty.
    const outcome = classifyDomFetch({
      blocked: status === 403 || /cloudflare/i.test(errMsg),
      failed: true,
      status,
      htmlBytes: 0,
      error: errMsg,
    });
    const rec = {
      url: request.url,
      status,
      blocked: outcome === "blocked",
      failed: true,
      outcome,
      error: errMsg,
    };
    failed.push(rec);
    outcomes.push({ url: request.url, outcome });
    await Actor.pushData(rec); // dead-letter: our backend retries / flags for CAPTCHA
  },
});

await crawler.run(urls);

// ---- Finalize: RUN_SUMMARY + fail-loud exit code ------------------------
// Roll per-URL outcomes into counts + one run outcome, write a machine-readable
// SUMMARY (kept under the legacy key the adapter already reads, plus the counts
// the R0 taxonomy uses), and set the exit code so a fully-walled run is FAILED —
// never a clean SUCCEEDED the consumer mistakes for "all pages empty".
const counts = { ok: 0, empty_verified: 0, blocked: 0, timeout: 0, error: 0 };
for (const o of outcomes) {
  if (o.outcome in counts) counts[o.outcome] += 1;
}
const reachedContent = counts.ok + counts.empty_verified;
const silentFail = counts.blocked + counts.timeout + counts.error;

let runOutcome;
if (outcomes.length === 0) {
  runOutcome = "error"; // nothing ran — no url produced any outcome
} else if (reachedContent === 0) {
  runOutcome = "blocked"; // every url was walled/timed-out/errored
} else if (silentFail > 0) {
  runOutcome = "partial"; // some reached content, some silently failed
} else {
  runOutcome = "ok";
}

const store = await Actor.openKeyValueStore();
await store
  .setValue("SUMMARY", {
    // Legacy fields (unchanged) so the existing adapter keeps reading them.
    total: urls.length,
    failed: failed.length,
    failedUrls: failed.map((f) => f.url),
    // R3 additive fields — the machine-readable taxonomy + per-run outcome.
    outcome: runOutcome,
    counts,
    reachedContent,
    silentFail,
  })
  .catch(() => {});
await Actor.setValue("RUN_SUMMARY", {
  outcome: runOutcome,
  counts,
  total: urls.length,
}).catch(() => {});
await Actor.setStatusMessage(runOutcome).catch(() => {});
log_done(urls.length, failed.length, runOutcome);
function log_done(t, f, o) {
  console.log(`DONE total=${t} ok=${t - f} failed=${f} outcome=${o}`);
}

// Fail loud when NO url reached rendered content — a clean 0 the consumer could
// mistake for "all pages empty". A run with ANY reached-content url exits 0
// (partial included: it carries real DOMs worth keeping).
if (runOutcome === "error" || runOutcome === "blocked") {
  await Actor.fail(`${runOutcome}: no url reached rendered content`);
} else {
  await Actor.exit();
}
