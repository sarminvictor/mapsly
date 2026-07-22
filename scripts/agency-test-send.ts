// scripts/agency-test-send.ts
//
// Phase-1 Stage C.3b · Send REAL rendered agency emails to Viktor's own
// inbox (sarminvictor@gmail.com) through the REAL mailer (Zoho SMTP,
// rotation, footer, List-Unsubscribe headers) so the approval is based on
// exactly what an agency would receive — including how Gmail displays it
// and whether SPF/DKIM/DMARC pass ("Show original").
//
// Safety: the unsubscribe link in the TEST copy is tokenized to Viktor's
// address (an accidental click suppresses sarminvictor@gmail.com from cold
// sends, not the agency). Subject carries a [TEST] prefix + the real
// recipient it was rendered for. No ColdSend rows are written; recipient
// state is untouched.
//
// Usage: pnpm tsx scripts/agency-test-send.ts [--count=4]

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { buildTokens } from "@/modules/cold/personalization";
import {
  renderTemplate,
  buildTextFooter,
  toHtmlBody,
} from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import { getColdSenderConfig } from "@/services/cold-mailer/config";
import {
  acquireMailbox,
  sendViaMailbox,
  type ResolvedMailbox,
} from "@/services/cold-mailer";

const TEST_TO = "sarminvictor@gmail.com";

async function main() {
  const countArg = process.argv.find((a) => a.startsWith("--count="));
  const count = countArg ? Number(countArg.slice(8)) : 4;

  const campaign = await prisma.coldCampaign.findFirst({
    where: { name: "Agency outreach · dental+medspa wave 1 (US)" },
    select: {
      id: true,
      fromName: true,
      steps: {
        select: { stepOrder: true, subjectTemplate: true, bodyTemplate: true },
        orderBy: { stepOrder: "asc" },
      },
      recipients: {
        select: { id: true, email: true, context: true },
        orderBy: { email: "asc" },
      },
    },
  });
  if (!campaign) throw new Error("campaign missing");
  const sender = getColdSenderConfig();
  const senderName = campaign.fromName ?? sender.fromName;

  // Spread samples across verticals: first N by email order alternating.
  const samples = campaign.recipients.slice(0, count);
  const unsubTest = unsubscribeUrlFor(TEST_TO);
  const usedBoxes: string[] = [];

  let sent = 0;
  for (const [i, r] of samples.entries()) {
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
    // v2 review: Viktor needs the WHOLE sequence in his inbox, not only touch
    // 1 — send every step's render for this recipient (subject carries the
    // touch number via the [TEST] prefix below).
    for (const step of campaign.steps) {
      // Acquire the mailbox FIRST so the rendered signature matches the real
      // From persona (cron parity: fromName = mailbox.displayName).
      const mailbox: ResolvedMailbox | null = await acquireMailbox(
        new Date(),
        usedBoxes,
      );
      if (!mailbox) throw new Error("no mailbox capacity for test sends");
      usedBoxes.push(mailbox.address);
      if (usedBoxes.length >= 5) usedBoxes.length = 0;
      const personaName = campaign.fromName ?? mailbox.displayName;
      const stepTokens = { ...tokens, senderFirstName: personaName };
      const spinSeed = `${r.id}:${step.stepOrder}`;
      const subject = renderTemplate(
        step.subjectTemplate,
        stepTokens,
        spinSeed,
      );
      const body = renderTemplate(step.bodyTemplate, stepTokens, spinSeed);
      const text = body + buildTextFooter(unsubTest, sender.physicalAddress);
      const html = toHtmlBody(body, unsubTest, sender.physicalAddress);
      const result = await sendViaMailbox(mailbox, {
        to: TEST_TO,
        subject: `[TEST t${step.stepOrder + 1} · for ${r.email}] ${subject}`,
        text,
        html,
        unsubscribeUrl: unsubTest,
        fromName: personaName,
      });
      console.log(
        `[test-send] t${step.stepOrder + 1} via ${mailbox.address} → ${TEST_TO} · "${subject}" · ${JSON.stringify(result).slice(0, 100)}`,
      );
      if ((result as { ok?: boolean }).ok !== false) sent++;
      await new Promise((res) => setTimeout(res, 3000));
    }
    void i;
  }
  console.log(`DONE test emails sent: ${sent} → ${TEST_TO}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 400)}`);
    process.exit(1);
  });
