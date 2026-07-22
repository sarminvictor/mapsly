// scripts/agency-ingest.ts
//
// Phase-1 Stage B.2/B.3 · Discover + SMTP-verify PERSONAL founder emails for
// the agency target pool. Input: scripts/data/agency-targets.json
// [{ name, domain, vertical, firstName?, founderName?, fitScore?,
//    visibleEmail? }]. Output: scripts/data/agency-targets.enriched.json with
// { email, emailSource, emailVerdict } added per row.
//
// Method (all $0 except SMTP probes):
//   1. If the research already saw an email on the site (visibleEmail), start
//      from it. 2. Else freeFetchDom over /, /about, /about-us, /team,
//      /contact, /contact-us → parseContacts → EMAIL channel.
//   3. Keep PERSONAL addresses only (drop role: info@, hello@, office@, ... —
//      role addresses are both bounce- and spam-risk; the plan gates on
//      personal). Vendor/junk emails dropped via isVendorEmail.
//   4. smtpVerifyEmail inside withCronRun (cost-counter gated) — keep
//      deliverable + inconclusive-with-flag, drop undeliverable.
//
// Usage: pnpm tsx scripts/agency-ingest.ts [--limit=200] [--skip-verify]

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

import { withCronRun } from "@/lib/cost/cost-counter";
import { freeFetchDom } from "@/services/dom-fetcher/free-fetch";
import { parseContacts } from "@/services/contact-scraper/parse";
import { isVendorEmail } from "@/services/contact-scraper/vendor-domains";
import { smtpVerifyEmail } from "@/services/email-verify";

const IN_FILE = path.join(
  process.cwd(),
  "scripts",
  "data",
  "agency-targets.json",
);
const OUT_FILE = path.join(
  process.cwd(),
  "scripts",
  "data",
  "agency-targets.enriched.json",
);

const PATHS = ["", "/about", "/about-us", "/team", "/contact", "/contact-us"];
const ROLE_LOCALS = new Set([
  "info",
  "hello",
  "office",
  "contact",
  "support",
  "admin",
  "sales",
  "team",
  "marketing",
  "hi",
  "mail",
  "inquiries",
  "enquiries",
  "help",
  "billing",
  "careers",
  "jobs",
  "press",
  "media",
  "no-reply",
  "noreply",
]);
const FETCH_CONCURRENCY = 6;

interface Target {
  name: string;
  domain: string;
  vertical: string;
  firstName?: string;
  founderName?: string;
  fitScore?: number;
  visibleEmail?: string;
  [k: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isPersonal(email: string, domain: string): boolean {
  const [local, host] = email.toLowerCase().split("@");
  if (!local || !host) return false;
  // Same-domain preferred but allow adjacent (e.g. brand alias domains).
  if (ROLE_LOCALS.has(local)) return false;
  if (local.length <= 1) return false;
  return true;
}

/** Prefer emails on the agency's own domain, then shortest personal local. */
function pickBest(emails: string[], domain: string): string | null {
  const personal = emails.filter((e) => isPersonal(e, domain));
  if (personal.length === 0) return null;
  const own = personal.filter((e) =>
    e.toLowerCase().endsWith(`@${domain.toLowerCase()}`),
  );
  const pool = own.length > 0 ? own : personal;
  return pool.sort((a, b) => a.length - b.length)[0] ?? null;
}

async function discoverEmail(
  t: Target,
): Promise<{ email: string | null; source: string }> {
  // Research-captured email first (still subject to the personal filter).
  if (
    t.visibleEmail &&
    isPersonal(t.visibleEmail, t.domain) &&
    !isVendorEmail(t.visibleEmail)
  ) {
    return { email: t.visibleEmail.toLowerCase(), source: "research" };
  }
  const found = new Set<string>();
  for (const p of PATHS) {
    const url = `https://${t.domain}${p}`;
    try {
      const res = await freeFetchDom(url);
      if (!res || res.blocked || !res.html) continue;
      const contacts = parseContacts({ html: res.html, sourceUrl: url });
      for (const c of contacts) {
        if (c.channel !== "EMAIL") continue;
        const v = c.value.toLowerCase().trim();
        if (!isVendorEmail(v)) found.add(v);
      }
      // Stop early once we have a same-domain personal hit.
      if (pickBest([...found], t.domain)?.endsWith(`@${t.domain}`)) break;
    } catch {
      /* per-path tolerance */
    }
  }
  const best = pickBest([...found], t.domain);
  return { email: best, source: best ? "dom-fetch" : "none" };
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice(8)) : 500;
  const skipVerify = process.argv.includes("--skip-verify");

  const targets: Target[] = JSON.parse(fs.readFileSync(IN_FILE, "utf8")).slice(
    0,
    limit,
  );
  console.log(`[ingest] targets: ${targets.length}`);

  // ── Discover ───────────────────────────────────────────────────────────
  let cursor = 0;
  const results: Array<Target & { email: string | null; emailSource: string }> =
    new Array(targets.length);
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      while (cursor < targets.length) {
        const i = cursor++;
        const t = targets[i];
        const d = await discoverEmail(t);
        results[i] = { ...t, email: d.email, emailSource: d.source };
        if ((i + 1) % 20 === 0 || i + 1 === targets.length) {
          const withEmail = results.filter((r) => r?.email).length;
          console.log(
            `[ingest] ${i + 1}/${targets.length} · personal emails so far: ${withEmail}`,
          );
        }
        await sleep(150); // politeness jitter
      }
    }),
  );

  const withEmail = results.filter((r) => r.email);
  console.log(
    `[ingest] discovery done: ${withEmail.length}/${targets.length} personal emails (${results.filter((r) => r.emailSource === "research").length} from research, ${results.filter((r) => r.emailSource === "dom-fetch").length} from fetch)`,
  );

  // ── SMTP verify ────────────────────────────────────────────────────────
  if (!skipVerify) {
    await withCronRun("script:agency-email-verify", async () => {
      let i = 0;
      for (const r of withEmail) {
        try {
          const v = await smtpVerifyEmail({ email: r.email! });
          (r as Record<string, unknown>).emailVerdict = v.verdict;
        } catch (e) {
          (r as Record<string, unknown>).emailVerdict =
            `error:${String(e).slice(0, 60)}`;
        }
        i += 1;
        if (i % 10 === 0 || i === withEmail.length) {
          console.log(`[verify] ${i}/${withEmail.length}`);
        }
      }
    });
    const counts: Record<string, number> = {};
    for (const r of withEmail) {
      const v = String(
        (r as Record<string, unknown>).emailVerdict ?? "unknown",
      );
      counts[v] = (counts[v] ?? 0) + 1;
    }
    console.log(`[verify] verdicts: ${JSON.stringify(counts)}`);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 1));
  const deliverable = results.filter(
    (r) =>
      r.email &&
      ["deliverable", "inconclusive"].includes(
        String((r as Record<string, unknown>).emailVerdict),
      ),
  ).length;
  console.log(
    `[ingest] WROTE ${OUT_FILE} · usable emails (deliverable+inconclusive): ${skipVerify ? "n/a (verify skipped)" : deliverable}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[ingest] FATAL: ${String(e).slice(0, 500)}`);
    process.exit(1);
  });
