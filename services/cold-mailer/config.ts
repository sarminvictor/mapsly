/**
 * Cold-mailer configuration.
 *
 * Everything is read from env AT CALL TIME (never module scope — vercel.md INC-07).
 * Cold outreach sends ONLY from the mapsly.xyz mailboxes defined here; the Resend
 * magic-link sender (mapsly.ai) is a different system and is never touched.
 *
 * Env contract:
 *   COLD_SMTP_HOST            e.g. smtp.gmail.com | smtp.zoho.com
 *   COLD_SMTP_PORT            465 (SSL) | 587 (STARTTLS)        [default 465]
 *   COLD_SMTP_SECURE          "true" | "false"                 [default: port===465]
 *   COLD_MAILBOX_1..N         the mailbox addresses on mapsly.xyz
 *   COLD_MAILBOX_PASSWORD_1..N  app password per mailbox
 *   COLD_MAILBOX_NAME_1..N    optional human display name per mailbox
 *   COLD_FROM_NAME            fallback display name             [default "Mapsly"]
 *   COLD_PHYSICAL_ADDRESS     legal postal address for the footer (CAN-SPAM/CASL)
 *   COLD_BASE_URL             base for unsubscribe + report links [default https://mapsly.ai]
 *   COLD_UNSUBSCRIBE_SECRET   HMAC secret for one-click unsubscribe tokens
 */

export interface ColdMailboxCred {
  address: string;
  password: string;
  displayName?: string;
}

export interface ColdSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
}

export interface ColdSenderConfig {
  fromName: string;
  physicalAddress: string;
  baseUrl: string;
  unsubscribeSecret: string;
}

const MAX_MAILBOXES = 50;

/** Parse COLD_MAILBOX_* env into a credential list (empty if none configured). */
export function getMailboxCreds(): ColdMailboxCred[] {
  const creds: ColdMailboxCred[] = [];
  for (let i = 1; i <= MAX_MAILBOXES; i++) {
    const address = process.env[`COLD_MAILBOX_${i}`]?.trim().toLowerCase();
    const password = process.env[`COLD_MAILBOX_PASSWORD_${i}`];
    if (!address || !password) continue;
    const displayName =
      process.env[`COLD_MAILBOX_NAME_${i}`]?.trim() || undefined;
    creds.push({ address, password, displayName });
  }
  return creds;
}

// ── Hardcoded sender config ─────────────────────────────────────────────
// The ONLY cold env you set is the mailbox creds (COLD_MAILBOX_* above).
// These match Boxly's pattern (host/port/baseUrl are constants, not env).
// Each still accepts an env override if you ever change providers/domains.
const DEFAULT_SMTP_HOST = "smtp.zohocloud.ca"; // Zoho Canada region (matches MX)
const DEFAULT_SMTP_PORT = 465;
const FROM_NAME = "Mapsly";
// Canonical host — the apex 307-redirects to www, so point report (/l/) and
// one-click unsubscribe (/u/) links straight at www to avoid a redirect hop.
const BASE_URL = "https://www.mapsly.ai";
// CAN-SPAM / CASL legal footer — MUST be a real postal address.
const PHYSICAL_ADDRESS = "Mapsly · 530 3 St SE, Calgary, AB, Canada";

export function getSmtpConfig(): ColdSmtpConfig {
  const host = process.env.COLD_SMTP_HOST?.trim() || DEFAULT_SMTP_HOST;
  const port = Number(process.env.COLD_SMTP_PORT ?? DEFAULT_SMTP_PORT);
  const secureEnv = process.env.COLD_SMTP_SECURE;
  const secure = secureEnv != null ? secureEnv !== "false" : port === 465;
  return { host, port, secure };
}

export function getColdSenderConfig(): ColdSenderConfig {
  const baseUrl = (process.env.COLD_BASE_URL ?? BASE_URL).replace(/\/$/, ""); // do NOT inherit NEXT_PUBLIC_APP_URL (localhost/apex in some envs)
  return {
    fromName: process.env.COLD_FROM_NAME?.trim() || FROM_NAME,
    physicalAddress:
      process.env.COLD_PHYSICAL_ADDRESS?.trim() || PHYSICAL_ADDRESS,
    baseUrl,
    // Reuse the app's existing secret — no new env var to manage.
    unsubscribeSecret:
      process.env.COLD_UNSUBSCRIBE_SECRET ??
      process.env.AUTH_SECRET ??
      process.env.NEXTAUTH_SECRET ??
      process.env.CRON_SECRET ??
      "",
  };
}

/** "ava@mapsly.xyz" → "Ava" (fallback display name). */
export function deriveDisplayName(address: string): string {
  const local = address.split("@")[0] ?? address;
  const first = local.split(/[.\-_+0-9]/).filter(Boolean)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
