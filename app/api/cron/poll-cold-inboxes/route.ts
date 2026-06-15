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
  /** SENT cold-sends missing their sender attribution at the start of the tick. */
  attributionPending?: number;
  /** How many of those this tick recovered from a mailbox's Sent folder. */
  attributionFilled?: number;
  errors: string[];
  [key: string]: number | string[] | undefined;
}

/** A SENT cold-send whose sending mailbox was never recorded — recoverable
 *  from whichever mailbox's Sent folder holds the message. */
interface PendingAttribution {
  id: string;
  email: string;
  subject: string;
  sentAt: Date;
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

/**
 * Self-heal sender attribution: scan THIS mailbox's Sent folder for any
 * cold-send that was logged SENT but never recorded its mailboxAddress
 * (normally none — the sender records it inline; this covers a post-send DB
 * write that failed). A Sent message to the recipient with the same subject,
 * dated near sentAt, means this mailbox sent it. Mutates `pending`, dropping
 * rows it attributes so the next mailbox doesn't re-scan them. Best-effort.
 */
async function backfillFromSent(
  client: ImapFlow,
  address: string,
  pending: PendingAttribution[],
  meta: PollMeta,
): Promise<void> {
  const folders = await client.list();
  const sent =
    folders.find((f) => f.specialUse === "\\Sent") ??
    folders.find((f) => /^sent/i.test(f.path));
  if (!sent) return;

  const lock = await client.getMailboxLock(sent.path);
  try {
    for (const p of [...pending]) {
      // Bound the search: this recipient, from a day-and-a-half before sentAt.
      const since = new Date(p.sentAt.getTime() - 36 * 3_600_000);
      let uids: number[] = [];
      try {
        uids =
          (await client.search({ to: p.email, since }, { uid: true })) || [];
      } catch {
        uids = [];
      }
      let matched = false;
      // Newest first — the touch we're attributing is the most recent match.
      for (const uid of uids.slice(-10).reverse()) {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, envelope: true },
          { uid: true },
        );
        if (msg && (msg.envelope?.subject ?? "") === p.subject) {
          matched = true;
          break;
        }
      }
      if (matched) {
        await prisma.coldSend.update({
          where: { id: p.id },
          data: { mailboxAddress: address },
        });
        meta.attributionFilled = (meta.attributionFilled ?? 0) + 1;
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
      }
    }
  } finally {
    lock.release();
  }
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

  // Attribution self-heal: load SENT cold-sends missing their sender once
  // (normally empty). Each mailbox's Sent scan below fills the ones it owns.
  const gapRows = await prisma.coldSend.findMany({
    where: {
      status: "SENT",
      mailboxAddress: null,
      subject: { not: null },
      sentAt: { not: null },
    },
    select: {
      id: true,
      subject: true,
      sentAt: true,
      recipient: { select: { email: true } },
    },
    take: 500,
  });
  const pending: PendingAttribution[] = gapRows.map((g) => ({
    id: g.id,
    email: g.recipient.email,
    subject: g.subject as string,
    sentAt: g.sentAt as Date,
  }));
  meta.attributionPending = pending.length;

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
      // Same connection: recover any missing sender attribution from Sent.
      if (pending.length > 0) {
        try {
          await backfillFromSent(client, cred.address, pending, meta);
        } catch (err) {
          meta.errors.push(
            `${cred.address} sent-scan: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
