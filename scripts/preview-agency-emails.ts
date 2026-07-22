// scripts/preview-agency-emails.ts
//
// Phase-1 Stage C.3a · Render EVERY enrolled agency recipient × every touch
// byte-identically to what the send cron will produce (same renderTemplate,
// same token merge as v0.19.42's cron branch, same deterministic spinSeed
// `${recipientId}:${stepOrder}`, same footer/unsubscribe HTML) into one
// reviewable HTML page for Viktor.
//
// Usage: pnpm tsx scripts/preview-agency-emails.ts
// Output: /tmp/agency-emails-preview.html

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";

import prisma from "@/lib/prisma";
import { buildTokens } from "@/modules/cold/personalization";
import { renderTemplate, toHtmlBody } from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import { getColdSenderConfig } from "@/services/cold-mailer/config";
import { AGENCY_CAMPAIGN_NAME } from "./agency-campaign-config";

const OUT = "/tmp/agency-emails-preview.html";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const campaign = await prisma.coldCampaign.findFirst({
    where: { name: AGENCY_CAMPAIGN_NAME },
    select: {
      id: true,
      status: true,
      fromName: true,
      steps: {
        select: {
          stepOrder: true,
          subjectTemplate: true,
          bodyTemplate: true,
          delayDays: true,
        },
        orderBy: { stepOrder: "asc" },
      },
      recipients: {
        select: {
          id: true,
          email: true,
          businessId: true,
          context: true,
          status: true,
        },
        orderBy: { email: "asc" },
      },
    },
  });
  if (!campaign) throw new Error("campaign missing");
  const sender = getColdSenderConfig();
  // Render with a REAL mailbox persona so the signature matches what the cron
  // sends ("Ava"), not the admin fallback ("Mapsly" → "Mapsly · Mapsly" sig).
  const senderName = campaign.fromName ?? "Ava";

  const blocks: string[] = [];
  for (const r of campaign.recipients) {
    if (r.businessId !== null) {
      throw new Error(
        `recipient ${r.email} has businessId set — would use SMB copy engine`,
      );
    }
    const contextTokens =
      r.context && typeof r.context === "object" && !Array.isArray(r.context)
        ? Object.fromEntries(
            Object.entries(r.context as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          )
        : {};
    const tokens = {
      ...(await buildTokens(null, { reportUrl: "", senderName })),
      ...contextTokens,
    };
    const unsub = unsubscribeUrlFor(r.email);
    for (const step of campaign.steps) {
      const spinSeed = `${r.id}:${step.stepOrder}`;
      const subject = renderTemplate(step.subjectTemplate, tokens, spinSeed);
      const body = renderTemplate(step.bodyTemplate, tokens, spinSeed);
      const html = toHtmlBody(body, unsub, sender.physicalAddress);
      const words = body.trim().split(/\s+/).length;
      blocks.push(
        `<div class="mail"><div class="meta"><b>${esc(r.email)}</b> · touch ${step.stepOrder + 1}` +
          `${step.stepOrder > 0 ? ` (+${step.delayDays}d)` : ""} · ${words} words` +
          `</div><div class="subj">Subject: ${esc(subject)}</div><div class="body">${html}</div></div>`,
      );
    }
  }

  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Agency outreach preview · ${campaign.recipients.length} recipients</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;margin:0;padding:24px}
h1{font-size:19px}.mail{background:#fff;border:1px solid #ddd;border-radius:10px;padding:18px 22px;margin:14px auto;max-width:680px}
.meta{color:#666;font-size:12px;margin-bottom:6px}.subj{font-weight:600;margin-bottom:10px;font-size:14px}
.body{border-top:1px solid #eee;padding-top:10px}</style></head><body>
<h1>Agency outreach · ${campaign.recipients.length} recipients × ${campaign.steps.length} touches · campaign ${campaign.status}</h1>
<p style="color:#666;font-size:13px">Rendered byte-identically to the production send path (same templates, tokens, spintax seed, footer). Campaign will NOT send until flipped ACTIVE after approval.</p>
${blocks.join("\n")}</body></html>`;
  fs.writeFileSync(OUT, page);
  console.log(
    `wrote ${OUT} · ${campaign.recipients.length} recipients · ${blocks.length} rendered emails`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 400)}`);
    process.exit(1);
  });
