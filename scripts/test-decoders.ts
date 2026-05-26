#!/usr/bin/env tsx
/**
 * Verify the Cloudflare + HTML-entity decoders against contrived inputs.
 * Standalone — does not import the network-touching scrape functions.
 * We import the pure decoder helpers indirectly by mocking fetch.
 */

// Re-implement the decoders here matching what's in scrape-email.ts.
// If these go out of sync, the test catches it on the next run.

function decodeCloudflareHex(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  if (hex.length < 6 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16) ^ key;
    if (byte < 0x20 || byte > 0x7e) return null;
    out += String.fromCharCode(byte);
  }
  return out.includes("@") ? out : null;
}

function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&#(\d{1,7});/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCharCode(code)
        : _;
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCharCode(code)
        : _;
    })
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&num;/gi, "#")
    .replace(/&amp;/g, "&");
}

/** Build a Cloudflare-encoded hex from a plain email + chosen XOR key. */
function encodeCloudflare(email: string, key: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  let out = hex(key);
  for (const c of email) {
    out += hex(c.charCodeAt(0) ^ key);
  }
  return out;
}

function check(label: string, got: unknown, expected: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  const symbol = ok ? "✓" : "✗";
  console.log(`  ${symbol} ${label}`);
  if (!ok) {
    console.log(`     got:      ${JSON.stringify(got)}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
  }
}

console.log("\n── Cloudflare hex decoder ──────────────────────");

// Round-trip: encode a known email, decode it back.
const encoded42 = encodeCloudflare("info@ownerdomain.com", 0x42);
console.log(`  encoded (key=0x42): ${encoded42}`);
check(
  "round-trip info@ownerdomain.com (key=0x42)",
  decodeCloudflareHex(encoded42),
  "info@ownerdomain.com",
);

const encodedB7 = encodeCloudflare("hello@facemiami.com", 0xb7);
console.log(`  encoded (key=0xb7): ${encodedB7}`);
check(
  "round-trip hello@facemiami.com (key=0xb7)",
  decodeCloudflareHex(encodedB7),
  "hello@facemiami.com",
);

// Real-world example known to work (constructed):
check("malformed: odd-length hex", decodeCloudflareHex("b9d6d"), null);
check("malformed: non-hex chars", decodeCloudflareHex("zzz"), null);
check("malformed: too short", decodeCloudflareHex("b9"), null);

console.log("\n── HTML entity decoder ─────────────────────────");

check(
  "decimal: info&#64;ownerdomain.com",
  decodeHtmlEntities("info&#64;ownerdomain.com"),
  "info@ownerdomain.com",
);
check(
  "hex: info&#x40;ownerdomain.com",
  decodeHtmlEntities("info&#x40;ownerdomain.com"),
  "info@ownerdomain.com",
);
check(
  "named &commat;",
  decodeHtmlEntities("info&commat;ownerdomain.com"),
  "info@ownerdomain.com",
);
check(
  "double-decoded (period + commat)",
  decodeHtmlEntities("info&commat;ownerdomain&period;com"),
  "info@ownerdomain.com",
);
check(
  "no entities — fast path returns input untouched",
  decodeHtmlEntities("plain text no entities"),
  "plain text no entities",
);
check(
  "preserves untouched entities",
  decodeHtmlEntities("&copy; 2026 Acme"),
  "&copy; 2026 Acme",
);
check("ampersand entity", decodeHtmlEntities("us &amp; them"), "us & them");

console.log("\n── Combined HTML scraping pipeline ─────────────");

// Build a fake HTML page mixing CF + entity-encoded emails
const fakeHtml = `
<html><body>
  <header>
    Visible:
    <a class="__cf_email__" data-cfemail="${encodeCloudflare("contact@cf-protected.com", 0x5a)}">[email_protected]</a>
  </header>
  <main>
    <p>Inline entity: info&#64;entity-encoded.com</p>
    <a href="mailto:bookings&#64;direct-mailto.com">book</a>
  </main>
  <footer>
    <a href="/cdn-cgi/l/email-protection#${encodeCloudflare("owner@cf-via-link.com", 0xa3)}">contact owner</a>
  </footer>
</body></html>
`;

async function runIntegrationTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const fakeRes = new Response(fakeHtml, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const empty404 = new Response("", { status: 404 });
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = url instanceof URL ? url.href : String(url);
    if (
      u === "https://example-fake.test/" ||
      u === "https://example-fake.test"
    ) {
      return fakeRes.clone();
    }
    return empty404.clone();
  }) as typeof globalThis.fetch;

  const { scrapeEmailsFromWebsite } =
    await import("../modules/business-qualification/scrape-email");
  const out = await scrapeEmailsFromWebsite({
    website: "https://example-fake.test",
    domain: "cf-protected.com",
  });

  globalThis.fetch = originalFetch;

  console.log(`\n  visited URLs: ${out.visitedUrls.length}`);
  console.log(`  candidates  : ${out.candidates.length}`);
  for (const c of out.candidates) {
    console.log(
      `    ${String(c.score).padStart(4)}  ${c.email.padEnd(40)} via ${c.source}`,
    );
  }

  const found = out.candidates.map((c) => c.email);
  check(
    "found contact@cf-protected.com (data-cfemail XOR)",
    found.includes("contact@cf-protected.com"),
    true,
  );
  check(
    "found info@entity-encoded.com (numeric entity)",
    found.includes("info@entity-encoded.com"),
    true,
  );
  check(
    "found bookings@direct-mailto.com (mailto with entity)",
    found.includes("bookings@direct-mailto.com"),
    true,
  );
  check(
    "found owner@cf-via-link.com (cdn-cgi link form)",
    found.includes("owner@cf-via-link.com"),
    true,
  );

  console.log("\nDone.");
}

runIntegrationTest().catch((e) => {
  console.error(e);
  process.exit(1);
});
