#!/usr/bin/env tsx
/**
 * Step-by-step trace of the email-discovery pipeline against Solea
 * Brickell Spa. Educational · run + read · no DB writes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  scrapeEmailsFromWebsite,
  buildCandidate,
} from "../modules/business-qualification/scrape-email";
import { rdapLookup } from "../modules/business-qualification/rdap";

const WEBSITE = "https://soleabrickellspa.com";
const DOMAIN = "soleabrickellspa.com";

/* Mirror of the path list in scrape-email.ts · we duplicate here ONLY
   so this trace can also show which URL each candidate came from.
   Keep in sync with CONTACT_PATHS in scrape-email.ts. */
const PROBE_PATHS: Array<{ path: string; tag: string }> = [
  { path: "/", tag: "SCRAPE_HOMEPAGE" },
  // Contact
  { path: "/contact", tag: "SCRAPE_CONTACT" },
  { path: "/contact-us", tag: "SCRAPE_CONTACT" },
  { path: "/contacts", tag: "SCRAPE_CONTACT" },
  { path: "/contactus", tag: "SCRAPE_CONTACT" },
  { path: "/contact.html", tag: "SCRAPE_CONTACT" },
  { path: "/contact-info", tag: "SCRAPE_CONTACT" },
  { path: "/get-in-touch", tag: "SCRAPE_CONTACT" },
  { path: "/reach-us", tag: "SCRAPE_CONTACT" },
  { path: "/connect", tag: "SCRAPE_CONTACT" },
  { path: "/info", tag: "SCRAPE_CONTACT" },
  { path: "/locations", tag: "SCRAPE_CONTACT" },
  { path: "/find-us", tag: "SCRAPE_CONTACT" },
  // About
  { path: "/about", tag: "SCRAPE_ABOUT" },
  { path: "/about-us", tag: "SCRAPE_ABOUT" },
  { path: "/aboutus", tag: "SCRAPE_ABOUT" },
  { path: "/about.html", tag: "SCRAPE_ABOUT" },
  { path: "/our-story", tag: "SCRAPE_ABOUT" },
  { path: "/who-we-are", tag: "SCRAPE_ABOUT" },
  // Team
  { path: "/team", tag: "SCRAPE_TEAM" },
  { path: "/our-team", tag: "SCRAPE_TEAM" },
  { path: "/staff", tag: "SCRAPE_TEAM" },
  { path: "/our-staff", tag: "SCRAPE_TEAM" },
  { path: "/meet-the-team", tag: "SCRAPE_TEAM" },
  { path: "/providers", tag: "SCRAPE_TEAM" },
  { path: "/our-providers", tag: "SCRAPE_TEAM" },
  { path: "/doctors", tag: "SCRAPE_TEAM" },
  { path: "/our-doctors", tag: "SCRAPE_TEAM" },
  { path: "/specialists", tag: "SCRAPE_TEAM" },
  // Booking
  { path: "/book", tag: "SCRAPE_BOOKING" },
  { path: "/book-now", tag: "SCRAPE_BOOKING" },
  { path: "/booking", tag: "SCRAPE_BOOKING" },
  { path: "/schedule", tag: "SCRAPE_BOOKING" },
  { path: "/appointments", tag: "SCRAPE_BOOKING" },
  { path: "/appointment", tag: "SCRAPE_BOOKING" },
  { path: "/consultation", tag: "SCRAPE_BOOKING" },
  { path: "/consultations", tag: "SCRAPE_BOOKING" },
];

const UA =
  "Mozilla/5.0 (compatible; MapslyBot/0.1; +https://mapsly.ai/bot · sarminvictor@gmail.com)";

function divider(label: string): void {
  console.log("\n" + "═".repeat(78));
  console.log("  " + label);
  console.log("═".repeat(78));
}

async function probeOne(
  url: string,
  tag: string,
): Promise<{
  url: string;
  status: number | string;
  contentType: string;
  bytes: number;
  mailtos: string[];
  inline: string[];
  footer: string[];
  tag: string;
}> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        url,
        status: res.status,
        contentType: "",
        bytes: 0,
        mailtos: [],
        inline: [],
        footer: [],
        tag,
      };
    }
    const ct = res.headers.get("content-type") ?? "";
    const html = await res.text();
    const mailtos = Array.from(
      html.matchAll(/href\s*=\s*["']mailto:([^"'?#]+)/gi),
    ).map((m) => (m[1] ?? "").toLowerCase().trim());
    const inline = Array.from(
      html.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g),
    ).map((m) => m[0].toLowerCase());
    const footerEmails =
      tag === "SCRAPE_HOMEPAGE"
        ? Array.from(
            html
              .slice(-2048)
              .matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g),
          ).map((m) => m[0].toLowerCase())
        : [];
    return {
      url,
      status: res.status,
      contentType: ct,
      bytes: html.length,
      mailtos: Array.from(new Set(mailtos)),
      inline: Array.from(new Set(inline)),
      footer: Array.from(new Set(footerEmails)),
      tag,
    };
  } catch (e) {
    return {
      url,
      status: e instanceof Error ? e.name : "ERR",
      contentType: "",
      bytes: 0,
      mailtos: [],
      inline: [],
      footer: [],
      tag,
    };
  }
}

async function main() {
  console.log(`Target · ${WEBSITE}\nDomain · ${DOMAIN}`);

  /* ─── 1. PROBE 9 URLS IN PARALLEL ─────────────────────────────────────── */
  divider("STEP 1 · Probe 9 URLs in parallel (7s timeout each)");
  const probes = await Promise.all(
    PROBE_PATHS.map(({ path, tag }) =>
      probeOne(WEBSITE.replace(/\/+$/, "") + path, tag),
    ),
  );
  for (const p of probes) {
    const found = p.mailtos.length + p.inline.length;
    const status =
      p.status === 200
        ? "✓ 200"
        : typeof p.status === "number"
          ? `✗ ${p.status}`
          : `✗ ${p.status}`;
    const tail = found > 0 ? `· ${found} email matches` : "";
    console.log(
      `  ${status.padEnd(9)} ${p.url.padEnd(48)} ${p.bytes.toLocaleString().padStart(8)}B  ${tail}`,
    );
  }

  /* ─── 2. SHOW RAW EXTRACTIONS PER PAGE ────────────────────────────────── */
  divider("STEP 2 · Raw extractions per page");
  for (const p of probes) {
    if (p.status !== 200) continue;
    if (p.mailtos.length + p.inline.length + p.footer.length === 0) continue;
    console.log(`\n${p.tag} · ${p.url}`);
    if (p.mailtos.length) console.log("  mailto:", p.mailtos.join(", "));
    if (p.inline.length) console.log("  inline text:", p.inline.join(", "));
    if (p.footer.length)
      console.log("  footer (last 2KB):", p.footer.join(", "));
  }

  /* ─── 3. SCORING (via the real scrape function) ────────────────────────── */
  divider("STEP 3 · Run the actual scrape function (scoring + dedup)");
  const result = await scrapeEmailsFromWebsite({
    website: WEBSITE,
    domain: DOMAIN,
  });
  console.log(`\nvisited URLs · ${result.visitedUrls.length}`);
  for (const u of result.visitedUrls) console.log("   ✓ " + u);
  console.log(`failed URLs  · ${result.failedUrls.length}`);
  for (const u of result.failedUrls) console.log("   ✗ " + u);
  console.log(`websiteUnreachable · ${result.websiteUnreachable}`);
  console.log(`\nranked candidates (${result.candidates.length}):`);
  console.log(
    "    score  email                                  source             flags",
  );
  console.log(
    "    -----  -------------------------------------  -----------------  -------------------",
  );
  for (const c of result.candidates) {
    const flags = [
      c.isDomainAligned ? "domain-aligned" : "off-domain",
      c.isPersonal ? "personal" : "generic",
      c.isFreeProvider ? "free" : "custom",
    ].join(" · ");
    console.log(
      `    ${String(c.score).padStart(5)}  ${c.email.padEnd(38).slice(0, 38)}  ${c.source.padEnd(17)}  ${flags}`,
    );
  }
  const best = result.candidates[0];
  console.log(
    `\nbest = ${best?.email ?? "(none)"}  via ${best?.source ?? "(n/a)"}`,
  );

  /* ─── 4. WOULD RDAP FIRE? ────────────────────────────────────────────── */
  divider("STEP 4 · RDAP fallback");
  if (result.candidates.length > 0) {
    console.log("Scrape returned candidates → RDAP is SKIPPED in production.");
    console.log("Running it manually for illustration…");
  } else {
    console.log("Scrape returned nothing → RDAP would run.");
  }
  const rdap = await rdapLookup(DOMAIN);
  console.log(`\nRDAP ok: ${rdap.ok} · proxied-only: ${rdap.proxiedOnly}`);
  console.log(
    `RDAP candidates (after domain-aligned filter): ${rdap.candidates.length}`,
  );
  for (const c of rdap.candidates) {
    console.log(`  ${String(c.score).padStart(5)}  ${c.email}  (${c.source})`);
  }

  /* ─── 5. SAMPLE-SCORE WHAT-IF: a junk email we WOULD reject ───────────── */
  divider("STEP 5 · Score examples · how the ranking works");
  for (const e of [
    "info@soleabrickellspa.com",
    "info@gmail.com",
    "victor@soleabrickellspa.com",
    "abuse@directnic.com",
    "noreply@soleabrickellspa.com",
    "test@example.com",
  ]) {
    const c = buildCandidate(e, "SCRAPE_FOOTER", DOMAIN);
    console.log(
      `  ${String(c.score).padStart(5)}  ${e.padEnd(36)}  ${[
        c.isDomainAligned ? "aligned" : "off-domain",
        c.isPersonal ? "personal" : "generic",
        c.isFreeProvider ? "free" : "custom",
      ].join(" · ")}`,
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
