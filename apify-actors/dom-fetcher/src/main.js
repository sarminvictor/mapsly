// Mapsly DOM Fetcher — a minimal "Cloudflare-busting DOM fetcher".
// It does the ONE thing that requires a real browser + residential proxy:
// navigate, clear Cloudflare, return the rendered HTML. ALL parsing
// (contacts, tech, services, AI) happens on our backend from this DOM.
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
const failed = [];

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
    if (CF.test(title) || status === 403)
      throw new Error("Cloudflare not cleared — retry new session/proxy");
    const html = await page.content(); // <-- the ONLY product of this actor: the rendered DOM
    log.info(`OK ${request.url} status=${status} bytes=${html.length}`);
    await Actor.pushData({
      url: request.url,
      finalUrl: page.url(),
      status,
      title,
      blocked: false,
      htmlBytes: html.length,
      html,
    });
  },
  async failedRequestHandler({ request, response }, err) {
    const rec = {
      url: request.url,
      status: response?.status() ?? null,
      blocked: true,
      failed: true,
      error: String(err?.message || err),
    };
    failed.push(rec);
    await Actor.pushData(rec); // dead-letter: our backend retries / flags for CAPTCHA
  },
});

await crawler.run(urls);
const store = await Actor.openKeyValueStore();
await store.setValue("SUMMARY", {
  total: urls.length,
  failed: failed.length,
  failedUrls: failed.map((f) => f.url),
});
log_done(urls.length, failed.length);
function log_done(t, f) {
  console.log(`DONE total=${t} ok=${t - f} failed=${f}`);
}
await Actor.exit();
