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
 * Successfully handled messages are flagged \Seen (unmatched ones too — a
 * human reads the shared inbox for edge cases); messages whose handling
 * failed stay UNSEEN and retry next tick. Per-message and per-mailbox
 * failures are isolated — one poisoned message or dead mailbox must not
 * stop the others.
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

/** Attacker-controlled text headed into an alert: one line, bounded length. */
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
}

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
          // Per-message isolation: a failure on one message (DB blip,
          // malformed source) is recorded and the message stays UNSEEN so the
          // next tick retries it — it must never abort the rest of the batch.
          // \Seen is flagged AFTER successful handling; the handlers are
          // idempotent (suppress() upserts, stopSequence() is status-guarded)
          // so a crash between handling and flagging reprocesses harmlessly.
          try {
            const msg = await client.fetchOne(
              String(uid),
              { uid: true, envelope: true, source: true },
              { uid: true },
            );
            if (msg && msg.source) {
              meta.messages++;

              const from =
                msg.envelope?.from?.[0]?.address?.toLowerCase().trim() ?? "";
              const subject = msg.envelope?.subject ?? "";
              const source = msg.source.toString("utf8").slice(0, 100_000);
              const c = classifyInbound({ from, subject, source });

              if (c.kind === "bounce") {
                // Only action NDRs for addresses we actually mailed — a forged
                // NDR naming an arbitrary address must never suppress it or
                // feed the bounce-rate breaker (security review M-1/M-2).
                const wasMailed =
                  c.hardBounce && c.bouncedEmail
                    ? (await prisma.coldSend.count({
                        where: {
                          recipient: { email: c.bouncedEmail },
                          status: "SENT",
                        },
                      })) > 0
                    : false;
                if (!c.hardBounce) {
                  meta.softBounces++; // transient — sender-side retry handles it
                } else if (c.bouncedEmail && wasMailed) {
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
                  meta.unmatched++; // unparsable or never-mailed — inbox keeps it
                }
              } else if (c.kind === "auto-reply") {
                meta.autoReplies++;
              } else if (c.kind === "unsubscribe") {
                // Same gate: only honor opt-outs from addresses we enrolled.
                const known = from
                  ? (await prisma.coldRecipient.count({
                      where: { email: from },
                    })) > 0
                  : false;
                if (known) {
                  await suppress(from, "UNSUBSCRIBE", "reply/mailto opt-out");
                  await stopSequence(
                    from,
                    "UNSUBSCRIBED",
                    "unsubscribed (reply)",
                  );
                  meta.unsubscribes++;
                } else {
                  meta.unmatched++;
                }
              } else {
                // Human reply — only meaningful if we actually mailed them.
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
                    `Subject: ${sanitize(subject)}\nMailbox: ${cred.address}\nSequence stopped — reply from the ${cred.address} inbox.`,
                  );
                } else {
                  meta.unmatched++;
                }
              }
            }
            await client.messageFlagsAdd(String(uid), ["\\Seen"], {
              uid: true,
            });
          } catch (err) {
            meta.errors.push(
              `${cred.address} uid ${uid}: ${err instanceof Error ? err.message : String(err)}`,
            );
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
