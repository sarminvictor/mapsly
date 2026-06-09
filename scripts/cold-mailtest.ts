#!/usr/bin/env tsx
/**
 * One-off · send a representative cold email from the first mailbox (Ava) to a
 * test address (default: mail-tester) to validate deliverability/quality.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/cold-mailtest.ts [to-address]
 *
 * Uses the real cold-mailer (Zoho SMTP via env creds) + the live templates,
 * so the test reflects exactly what production sends.
 */
import { DEFAULT_COLD_STEPS } from "@/modules/cold/default-campaign";
import {
  buildTextFooter,
  renderTemplate,
  toHtmlBody,
} from "@/modules/cold/template";
import { unsubscribeUrlFor } from "@/modules/cold/token";
import { sendViaMailbox } from "@/services/cold-mailer";
import {
  deriveDisplayName,
  getColdSenderConfig,
  getMailboxCreds,
} from "@/services/cold-mailer/config";

async function main(): Promise<void> {
  const to = process.argv[2] ?? "test-cnyivhwfu@srv1.mail-tester.com";
  const cred = getMailboxCreds()[0];
  if (!cred) throw new Error("No COLD_MAILBOX_1 configured");
  const step0 = DEFAULT_COLD_STEPS[0];
  if (!step0) throw new Error("No default step");

  const sender = getColdSenderConfig();
  const displayName = cred.displayName ?? deriveDisplayName(cred.address);
  const tokens: Record<string, string> = {
    businessName: "Calgary Dental Studio",
    city: "Calgary",
    rating: "4.3",
    reviewCount: "61",
    unansweredCount: "7",
    senderFirstName: displayName,
    reportUrl: `${sender.baseUrl}/l/seed-test`,
  };
  const subject = renderTemplate(step0.subjectTemplate, tokens);
  const unsubUrl = unsubscribeUrlFor(to);
  const body = renderTemplate(step0.bodyTemplate, tokens);
  const text = body + buildTextFooter(unsubUrl);
  const html = toHtmlBody(body, unsubUrl);

  console.log(`FROM ${cred.address}  →  TO ${to}`);
  console.log(`SUBJECT: ${subject}`);
  const result = await sendViaMailbox(
    { address: cred.address, password: cred.password, displayName },
    { to, subject, text, html, unsubscribeUrl: unsubUrl },
    new Date(),
  );
  console.log("RESULT:", JSON.stringify(result));
  process.exit(result.kind === "sent" ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
