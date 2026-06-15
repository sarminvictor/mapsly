// scripts/preview-cold-emails.ts — render EVERY enrolled recipient × all 3
// touches through the real cold copy engine (modules/cold/copy.ts), senders
// rotating across the configured mailboxes, into one HTML page for review.
//
// Run: pnpm tsx scripts/preview-cold-emails.ts  →  /tmp/cold-emails-preview.html
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import prisma from "@/lib/prisma";
import { buildColdEmail } from "@/modules/cold/copy";
import { gatherColdSignals, type ColdSignals } from "@/modules/cold/signals";
import { toHtmlBody } from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import {
  deriveDisplayName,
  getColdSenderConfig,
  getMailboxCreds,
} from "@/services/cold-mailer/config";

const TOUCH = [
  "Touch 1 · Mon (standing)",
  "Touch 2 · Wed (pain)",
  "Touch 3 · Fri (digest)",
];
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const h32 = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** Which pain Touch 2 will pick — mirrors buildColdEmail's selection, for the label. */
function painLabel(s: ColdSignals): string {
  if (s.ownAds === 0 && s.marketActiveAds >= 10) return "ads";
  if (
    s.websiteSlowSeconds != null ||
    (s.websiteScore != null && s.websiteScore < 60)
  )
    return "website";
  if (s.unanswered >= 10 || s.unansweredNegative >= 1) return "reviews";
  return "general";
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
) {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!, idx);
      }
    }),
  );
  return out;
}

async function main() {
  const sender = getColdSenderConfig();
  const boxes = getMailboxCreds().map((c) => ({
    name: c.displayName ?? deriveDisplayName(c.address),
    address: c.address,
  }));
  if (boxes.length === 0) throw new Error("no mailbox creds configured");

  const camp = await prisma.coldCampaign.findFirst({
    where: { name: { contains: "Miami" } },
    select: { id: true, fromName: true },
  });
  if (!camp) throw new Error("no Miami campaign");
  const recips = await prisma.coldRecipient.findMany({
    where: { campaignId: camp.id },
    select: { id: true, email: true, businessId: true, reportToken: true },
    orderBy: { email: "asc" },
  });

  const painTally: Record<string, number> = {};
  const sections = await mapLimit(recips, 12, async (r) => {
    if (!r.businessId) return null;
    const s = await gatherColdSignals(r.businessId);
    if (!s) return null;
    painTally[painLabel(s)] = (painTally[painLabel(s)] ?? 0) + 1;
    const reportUrl = r.reportToken
      ? `${sender.baseUrl}/l/${r.reportToken}`
      : "";
    const unsub = unsubscribeUrlFor(r.email);
    const cards = [0, 1, 2]
      .map((step) => {
        const box = boxes[h32(`${r.id}:${step}`) % boxes.length]!;
        const senderName = camp.fromName ?? box.name;
        const em = buildColdEmail(s, step, {
          senderName,
          reportUrl,
          spinSeed: `${r.id}:${step}`,
        });
        return `<div class="email"><div class="meta"><b>${TOUCH[step]}</b> · From: ${esc(senderName)} &lt;${esc(box.address)}&gt; · To: ${esc(r.email)}</div><div class="subj">${esc(em.subject)}</div><div class="body">${toHtmlBody(em.body, unsub, sender.physicalAddress)}</div></div>`;
      })
      .join("");
    const stat = `${s.city ?? "—"} · ${s.rating ?? "—"}★/${s.reviewCount ?? "—"} · rank #${s.rank ?? "—"}/${s.rankTotal ?? "—"} · ${s.ownAds} own ads · ${s.marketActiveAds} mkt ads/${s.marketAdvertiserCount} rivals · ${s.unanswered} unanswered · pain:${painLabel(s)}`;
    return `<section class="company"><h2>${esc(s.businessName)}</h2><div class="stat">${esc(stat)}</div>${cards}</section>`;
  });
  const ok = sections.filter(Boolean) as string[];

  const css = `
    body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#f4f4f6;color:#222}
    header{position:sticky;top:0;background:#1c1916;color:#fff;padding:14px 20px;z-index:9}
    header h1{margin:0;font-size:17px} header p{margin:4px 0 0;font-size:12px;color:#bbb}
    .company{max-width:760px;margin:22px auto;background:#fff;border:1px solid #e3e0db;border-radius:12px;overflow:hidden}
    .company>h2{margin:0;padding:12px 16px;font-size:16px;background:#faf6f1;border-bottom:1px solid #eee}
    .stat{padding:6px 16px;font:11px ui-monospace,monospace;color:#777;background:#fbfbfb;border-bottom:1px solid #f0f0f0}
    .email{padding:14px 16px;border-top:1px dashed #eee}
    .email .meta{font:11px ui-monospace,monospace;color:#999;margin-bottom:6px}
    .email .subj{font-weight:700;font-size:15px;margin-bottom:8px}
    .email .body{background:#fff}
  `;
  const head = `<header><h1>Miami cold emails · ${ok.length} companies × 3 touches (${ok.length * 3} emails)</h1><p>Rendered from REAL signals via modules/cold/copy.ts · senders rotate across ${boxes.length} mailboxes (${boxes.map((b) => b.name).join(", ")}) · Touch 2 pain mix: ${Object.entries(
    painTally,
  )
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ")}</p></header>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cold emails preview</title><style>${css}</style></head><body>${head}${ok.join("")}</body></html>`;

  const out = "/tmp/cold-emails-preview.html";
  fs.writeFileSync(out, html);
  console.log(
    `wrote ${out} · ${ok.length} companies · ${ok.length * 3} emails`,
  );
  console.log(`Touch-2 pain mix: ${JSON.stringify(painTally)}`);
  await prisma.$disconnect?.();
  process.exit(0);
}
main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
