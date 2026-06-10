/**
 * Cold-inbox poller · runs every 15 min via Vercel cron (offset from the
 * sender). The missing inbound half of the cold-email system (audit
 * 2026-06-09 findings 2, 3, 9): polls each COLD_MAILBOX_* over IMAP and
 * processes UNSEEN messages —
 *
 *   bounce (NDR/DSN)  → hard: suppress(BOUNCE_HARD) + recipient BOUNCED
 *   human reply       → recipient REPLIED (sender's TERMINAL gate honors it),
 *                       pending sends skipped, INFO alert so Viktor replies fast
 *   unsubscribe text  → suppress(UNSUBSCRIBE) + recipient UNSUBSCRIBED
 *   auto-reply / OOO  → ignored (sequence continues — standard practice)
 *
 * Everything processed is flagged \Seen; unprocessable messages are flagged
 * too (a human reads the shared inbox for edge cases). Per-mailbox failures
 * are isolated — one dead mailbox must not stop the others.
 */
import { ImapFlow } from "imapflow";

import { sendOpsAlert } from "@/lib/cold-alerts";
import { cronHandler } from "@/lib/middleware/no-live-api";
import prisma from "@/lib/prisma";

import { classifyInbound } from "@/modules/cold/inbound";
import { suppress } from "@/modules/cold/suppression";
import { getImapConfig, getMailboxCreds } from "@/services/cold-mailer/config";

const JOB = "cold:poll-inboxes";
/** Per-mailbox per-tick cap — keeps a flood from blowing the cron window. */
const MAX_PER_MAILBOX = 50;

interface PollMeta {
  mailboxes: number;
  messages: number;
  replies: number;
  bounces: number;
  softBounces: number;
  unsubscribes: number;
  autoReplies: number;
  unmatched: number;
  errors: string[];
  [key: string]: number | string[] | undefined;
}

export const GET = cronHandler(JOB, async () => {
  const meta = await pollColdInboxes();
  return {
    itemsProcessed: meta.messages,
    status: meta.errors.length > 0 ? "PARTIAL" : "OK",
    meta,
  };
});

/** Stop a recipient's sequence + skip their queued sends. */
async function stopSequence(
  email: string,
  status: "REPLIED" | "UNSUBSCRIBED" | "BOUNCED",
  stopReason: string,
): Promise<number> {
  const r = await prisma.coldRecipient.updateMany({
    where: { email, status: { in: ["PENDING", "ACTIVE"] } },
    data: { status, stopReason, nextRunAt: null },
  });
  if (r.count > 0) {
    await prisma.coldSend.updateMany({
      where: { recipient: { email }, status: "PENDING" },
      data: { status: "SKIPPED", errorMessage: stopReason },
    });
  }
  return r.count;
}

export async function pollColdInboxes(): Promise<PollMeta> {
  const meta: PollMeta = {
    mailboxes: 0,
    messages: 0,
    replies: 0,
    bounces: 0,
    softBounces: 0,
    unsubscribes: 0,
    autoReplies: 0,
    unmatched: 0,
    errors: [],
  };

  const { host, port, secure } = getImapConfig();
  const creds = getMailboxCreds();

  for (const cred of creds) {
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user: cred.address, pass: cred.password },
      logger: false,
    });
    try {
      await client.connect();
      meta.mailboxes++;
      const lock = await client.getMailboxLock("INBOX");
      try {
        const unseen = await client.search({ seen: false }, { uid: true });
        const batch = (unseen || []).slice(0, MAX_PER_MAILBOX);
        for (const uid of batch) {
          const msg = await client.fetchOne(
            String(uid),
            { uid: true, envelope: true, source: true },
            { uid: true },
          );
          // Flag \Seen FIRST so a crash mid-handling can't reprocess (the
          // handlers below are idempotent anyway — suppress() upserts).
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          if (!msg || !msg.source) continue;
          meta.messages++;

          const from =
            msg.envelope?.from?.[0]?.address?.toLowerCase().trim() ?? "";
          const subject = msg.envelope?.subject ?? "";
          const source = msg.source.toString("utf8").slice(0, 100_000);
          const c = classifyInbound({ from, subject, source });

          if (c.kind === "bounce") {
            if (!c.hardBounce) {
              meta.softBounces++; // transient — sender-side retry handles it
            } else if (c.bouncedEmail) {
              await suppress(
                c.bouncedEmail,
                "BOUNCE_HARD",
                `NDR via ${cred.address}`,
              );
              await stopSequence(
                c.bouncedEmail,
                "BOUNCED",
                "hard bounce (NDR)",
              );
              meta.bounces++;
            } else {
              meta.unmatched++; // NDR we couldn't parse — visible in the inbox
            }
          } else if (c.kind === "auto-reply") {
            meta.autoReplies++;
          } else if (c.kind === "unsubscribe") {
            if (from) {
              await suppress(from, "UNSUBSCRIBE", "reply/mailto opt-out");
              await stopSequence(from, "UNSUBSCRIBED", "unsubscribed (reply)");
              meta.unsubscribes++;
            }
          } else {
            // Human reply — only meaningful if we actually mailed this person.
            const stopped = from
              ? await stopSequence(from, "REPLIED", "replied")
              : 0;
            const known =
              stopped > 0 ||
              (from
                ? (await prisma.coldRecipient.count({
                    where: { email: from },
                  })) > 0
                : false);
            if (known) {
              meta.replies++;
              await sendOpsAlert(
                "INFO",
                `Cold reply from ${from}`,
                `Subject: ${subject}\nMailbox: ${cred.address}\nSequence stopped — reply from the ${cred.address} inbox.`,
              );
            } else {
              meta.unmatched++;
            }
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      meta.errors.push(
        `${cred.address}: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        client.close();
      } catch {
        /* already closed */
      }
    }
  }

  return meta;
}

export const __test = { JOB, MAX_PER_MAILBOX, pollColdInboxes };
