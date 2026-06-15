/**
 * Cold-mailer — self-hosted SMTP sender for cold outreach (mapsly.xyz).
 *
 * Re-implements Boxly's proven patterns (multi-mailbox rotation, per-mailbox
 * caps, provider-block cooldown), cold-tuned: low caps + ramp (ramp.ts), no
 * open-pixel/click-wrap (engagement is read from LandingEvent on /l/[token]).
 *
 * Walled off from Resend/mapsly.ai. Used by the sequence cron + admin seed-test.
 */
import nodemailer, { type Transporter } from "nodemailer";

import prisma from "@/lib/prisma";

import {
  type ColdMailboxCred,
  deriveDisplayName,
  getMailboxCreds,
  getSmtpConfig,
} from "./config";
import { effectiveDailyCap, utcDateKey } from "./ramp";

/** Cooldown applied to a mailbox when the provider signals a block. */
const BLOCK_COOLDOWN_HOURS = 2;

export interface ResolvedMailbox {
  address: string;
  password: string;
  displayName: string;
}

export interface ColdDispatchInput {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative (multipart). Omit for pure plain-text. */
  html?: string;
  /** HTTPS one-click unsubscribe URL → injected as List-Unsubscribe header. */
  unsubscribeUrl?: string;
  /** Override the From display name (else the mailbox display name). */
  fromName?: string;
}

export type ColdDispatchResult =
  | { kind: "sent"; mailboxAddress: string }
  | { kind: "no_capacity" }
  | { kind: "blocked"; mailboxAddress: string }
  | {
      kind: "failed";
      mailboxAddress?: string;
      error: string;
      permanent: boolean;
    };

// Transport cache keyed by address. Lazy createTransport (no module-scope eval).
const transports = new Map<string, Transporter>();

function transportFor(mailbox: ResolvedMailbox): Transporter {
  const cached = transports.get(mailbox.address);
  if (cached) return cached;
  const { host, port, secure } = getSmtpConfig();
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: mailbox.address, pass: mailbox.password },
  });
  transports.set(mailbox.address, transport);
  return transport;
}

/** Provider-level throttle/block (account temporarily suspended — not a bounce). */
export function isBlockError(message: string, code?: number): boolean {
  const m = message.toLowerCase();
  return (
    code === 421 ||
    m.includes("5.4.6") ||
    m.includes("unusual sending") ||
    m.includes("rate limit") ||
    m.includes("try again later") ||
    m.includes("too many messages") ||
    m.includes("temporarily deferred")
  );
}

/** Permanent recipient failure → suppress the address. */
export function isHardBounce(message: string, code?: number): boolean {
  const m = message.toLowerCase();
  return (
    code === 550 ||
    code === 551 ||
    code === 553 ||
    m.includes("5.1.1") ||
    m.includes("5.1.0") ||
    m.includes("user unknown") ||
    m.includes("no such user") ||
    m.includes("does not exist") ||
    m.includes("mailbox unavailable") ||
    m.includes("recipient address rejected") ||
    m.includes("address not found")
  );
}

/** Mailbox row shape consumed by the pure selector (subset of the Mailbox model). */
export interface MailboxRow {
  address: string;
  displayName: string | null;
  dailyCap: number;
  rampStartedAt: Date | null;
  blockedUntil: Date | null;
}

/**
 * Pure mailbox selection: the under-cap, un-blocked row with the lowest usage
 * today. `exclude` lists addresses already used for THIS recipient's prior
 * touches — we prefer a not-yet-used mailbox so each touch comes from a
 * different sender (touch-1 Ava → touch-2 Leo → touch-3 Mia), but fall back to
 * the best eligible mailbox if every fresh one is at cap/blocked, so a touch is
 * never skipped purely to avoid sender reuse. Exported for unit tests.
 */
export function pickMailbox(
  rows: readonly MailboxRow[],
  sentByAddr: ReadonlyMap<string, number>,
  exclude: ReadonlySet<string>,
  now: Date,
): MailboxRow | null {
  const eligible = rows
    .filter((r) => !r.blockedUntil || r.blockedUntil <= now)
    .map((r) => ({
      row: r,
      sent: sentByAddr.get(r.address) ?? 0,
      cap: effectiveDailyCap(r.dailyCap, r.rampStartedAt, now),
    }))
    .filter((x) => x.cap > 0 && x.sent < x.cap)
    .sort((a, b) => a.sent - b.sent);
  // Prefer a sender this recipient hasn't seen; else the lowest-usage eligible.
  const fresh = eligible.find((x) => !exclude.has(x.row.address));
  return (fresh ?? eligible[0])?.row ?? null;
}

/**
 * Pick a mailbox to send from. `exclude` = addresses already used for this
 * recipient (rotate the sender across touches). Returns null only when NO
 * eligible mailbox has capacity at all.
 */
export async function acquireMailbox(
  now: Date = new Date(),
  exclude: readonly string[] = [],
): Promise<ResolvedMailbox | null> {
  const creds = getMailboxCreds();
  if (creds.length === 0) return null;
  const credByAddr = new Map<string, ColdMailboxCred>(
    creds.map((c) => [c.address, c]),
  );
  const addresses = creds.map((c) => c.address);

  const rows = await prisma.mailbox.findMany({
    where: { status: "ACTIVE", address: { in: addresses } },
    select: {
      address: true,
      displayName: true,
      dailyCap: true,
      rampStartedAt: true,
      blockedUntil: true,
    },
  });
  if (rows.length === 0) return null;

  const date = utcDateKey(now);
  const stats = await prisma.mailboxStat.findMany({
    where: { date, mailboxAddress: { in: rows.map((r) => r.address) } },
    select: { mailboxAddress: true, sentCount: true },
  });
  const sentByAddr = new Map(stats.map((s) => [s.mailboxAddress, s.sentCount]));

  // Rows are already cred-scoped (queried by cred addresses), but keep the
  // guard explicit so a stale Mailbox row without a cred can't be chosen.
  const credRows = rows.filter((r) => credByAddr.has(r.address));
  const chosen = pickMailbox(credRows, sentByAddr, new Set(exclude), now);
  if (!chosen) return null;
  const cred = credByAddr.get(chosen.address);
  if (!cred) return null;
  return {
    address: chosen.address,
    password: cred.password,
    displayName:
      chosen.displayName ??
      cred.displayName ??
      deriveDisplayName(chosen.address),
  };
}

async function recordSend(
  address: string,
  ok: boolean,
  now: Date,
): Promise<void> {
  const date = utcDateKey(now);
  await prisma.mailboxStat.upsert({
    where: { mailboxAddress_date: { mailboxAddress: address, date } },
    create: {
      mailboxAddress: address,
      date,
      sentCount: ok ? 1 : 0,
      failedCount: ok ? 0 : 1,
    },
    update: ok
      ? { sentCount: { increment: 1 } }
      : { failedCount: { increment: 1 } },
  });
}

async function coolDownMailbox(address: string, now: Date): Promise<void> {
  await prisma.mailbox.update({
    where: { address },
    data: {
      blockedUntil: new Date(now.getTime() + BLOCK_COOLDOWN_HOURS * 3_600_000),
    },
  });
}

/**
 * Pick a mailbox under cap, send, record the daily stat, handle block cooldown.
 * Returns a tagged result the caller maps to ColdSend / suppression state.
 */
/** Send a pre-rendered email via a specific mailbox; record stat + handle block. */
export async function sendViaMailbox(
  mailbox: ResolvedMailbox,
  input: ColdDispatchInput,
  now: Date = new Date(),
): Promise<ColdDispatchResult> {
  const fromName = input.fromName ?? mailbox.displayName;
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    // HTTPS one-click (RFC 8058) + mailto. The mailto channel is PROCESSED:
    // app/api/cron/poll-cold-inboxes classifies unsubscribe-intent inbound
    // mail and suppresses — never advertise an opt-out nothing reads
    // (audit 2026-06-09 finding 9).
    headers["List-Unsubscribe"] =
      `<${input.unsubscribeUrl}>, <mailto:${mailbox.address}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    await transportFor(mailbox).sendMail({
      from: `${fromName} <${mailbox.address}>`,
      to: input.to,
      replyTo: mailbox.address,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      headers,
    });
    await recordSend(mailbox.address, true, now);
    return { kind: "sent", mailboxAddress: mailbox.address };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const responseCode = (err as { responseCode?: unknown }).responseCode;
    const code = typeof responseCode === "number" ? responseCode : undefined;
    await recordSend(mailbox.address, false, now);
    if (isBlockError(message, code)) {
      await coolDownMailbox(mailbox.address, now);
      return { kind: "blocked", mailboxAddress: mailbox.address };
    }
    return {
      kind: "failed",
      mailboxAddress: mailbox.address,
      error: message,
      permanent: isHardBounce(message, code),
    };
  }
}

/** Convenience: acquire a mailbox + send (used by the admin seed-test). */
export async function dispatchColdEmail(
  input: ColdDispatchInput,
  now: Date = new Date(),
): Promise<ColdDispatchResult> {
  const mailbox = await acquireMailbox(now);
  if (!mailbox) return { kind: "no_capacity" };
  return sendViaMailbox(mailbox, input, now);
}

/** Upsert Mailbox rows from the COLD_MAILBOX_* env (admin "sync mailboxes"). */
export async function syncMailboxesFromEnv(): Promise<{
  total: number;
  addresses: string[];
}> {
  const creds = getMailboxCreds();
  for (const c of creds) {
    const domain = c.address.split("@")[1] ?? "";
    await prisma.mailbox.upsert({
      where: { address: c.address },
      create: {
        address: c.address,
        domain,
        displayName: c.displayName ?? deriveDisplayName(c.address),
      },
      update: {},
    });
  }
  return { total: creds.length, addresses: creds.map((c) => c.address) };
}
