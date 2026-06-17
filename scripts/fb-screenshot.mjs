// Temporary visual-validation harness for the /for-businesses redesign.
// Uses puppeteer-core + system Chrome (no browser download). Captures
// desktop + mobile full-page screenshots and reports horizontal overflow.
// Remove together with the puppeteer-core devDependency when the
// redesign iteration wraps (per .claude/rules/validation.md § tools).
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.FB_URL ?? "http://localhost:3000/for-businesses";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--hide-scrollbars"],
});

async function capture(width, height, out, label) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    offenders: [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.right > document.documentElement.clientWidth + 1 && r.width > 0
        );
      })
      .slice(0, 8)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(el.getBoundingClientRect().right)}`,
      ),
  }));
  console.log(
    `[${label}] scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} height=${metrics.scrollHeight} overflow=${metrics.scrollWidth > metrics.clientWidth}`,
  );
  if (metrics.offenders.length)
    console.log(`[${label}] offenders:`, metrics.offenders);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`[${label}] saved ${out}`);
  await page.close();
}

await capture(1440, 900, "/tmp/fb-desktop-pp.png", "desktop");
await capture(380, 800, "/tmp/fb-mobile-pp.png", "mobile-380");

await browser.close();
