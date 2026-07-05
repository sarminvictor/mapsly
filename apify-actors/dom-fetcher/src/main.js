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
const maxConcurrency = input.maxConcurrency ?? 10; // memory drives true parallelism
const retireAfter = input.retireBrowserAfterPageCount ?? 20; // recycle → no leaks

const proxyConfiguration = await Actor.createProxyConfiguration({
  groups: ["RESIDENTIAL"],
  countryCode: country,
});
const CF =
  /just a moment|attention required|checking your browser|verifying you are human|cf-browser-verification/i;
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

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency,
  minConcurrency: 2,
  maxRequestRetries: 5, // retries rotate session+proxy → fresh IP (beats slow clears)
  navigationTimeoutSecs: 35,
  requestHandlerTimeoutSecs: 55,
  headless: true,
  browserPoolOptions: {
    useFingerprints: true,
    retireBrowserAfterPageCount: retireAfter,
  },
  preNavigationHooks: [
    async ({ page }) => {
      await page
        .route("**/*", (r) =>
          BLOCK.has(r.request().resourceType()) ? r.abort() : r.continue(),
        )
        .catch(() => {});
    },
  ],
  async requestHandler({ page, request, response, log }) {
    let title = await page.title().catch(() => "");
    if (CF.test(title)) {
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
    // CANARY: the Cloudflare challenge is STILL up (or a 403) → this fetch never
    // reached content. Throw so Crawlee retries on a fresh session/proxy; if
    // every retry fails, failedRequestHandler dead-letters it with outcome=blocked.
    if (CF.test(title) || status === 403)
      throw new Error("Cloudflare not cleared — retry new session/proxy");
    const html = await page.content(); // <-- the ONLY product of this actor: the rendered DOM
    const htmlBytes = html.length;
    const outcome = classifyDomFetch({
      blocked: false,
      failed: false,
      status,
      htmlBytes,
    });
    log.info(
      `OK ${request.url} status=${status} bytes=${htmlBytes} outcome=${outcome}`,
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
