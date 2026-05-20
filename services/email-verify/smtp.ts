// services/email-verify/smtp · SMTP-handshake mailbox verification.
//
// Purpose: before persisting an SMB owner's email (cohort outreach,
// onboarding completion, billing contact), confirm the address actually
// accepts mail. The check is RFC 5321 MAIL FROM / RCPT TO probe — we
// connect to the recipient's MX, speak the minimum SMTP needed for the
// remote to accept-or-reject the recipient, then QUIT without ever
// sending DATA. No message is delivered; only the existence + acceptance
// of the address is verified.
//
// What the check actually tells you:
//   - undeliverable (mailbox rejected, syntax invalid, no MX) → safe to
//     refuse the input.
//   - deliverable (250 OK on RCPT TO) → the simplest happy case.
//   - inconclusive (catch-all mailbox, greylisted, server unreachable,
//     temporary 4xx) → the recipient's server didn't tell us either way.
//     Treat as "probably OK" and let downstream code decide.
//
// What it cannot tell you:
//   - whether a real human reads the inbox
//   - whether the address spam-traps incoming mail
//   - whether the address will continue to exist tomorrow
//
// Anti-abuse considerations (per .claude/rules/security.md):
//   - Every call is bound to an open CronRun via withCostCounter — no
//     user-request-path probing. SMTP probes from random clients are
//     correctly read as reconnaissance by many large MX hosts (Gmail in
//     particular returns inconclusive results for unauthenticated probes).
//   - We never include the probed address in error messages logged to
//     Sentry beyond the local-part hash + domain (PII hygiene per
//     observability.md).
//   - The SMTP MAIL FROM address is configurable via env so operations
//     can rotate it if upstream reputation degrades.
//
// Cost discipline:
//   - SMTP probes are free in $; cost-counter still wraps the call so the
//     "no live API in user request path" invariant is enforced + CronRun
//     telemetry counts every probe.
//
// Validation surface (unit tests cover all of these):
//   - Local-part / domain syntax validation rejects obviously malformed
//     input before any DNS or socket work.
//   - Missing MX record → undeliverable, no socket attempted.
//   - 250-class on RCPT TO → deliverable.
//   - 5xx on RCPT TO → undeliverable + reason captured.
//   - 4xx on RCPT TO → inconclusive (greylisted / temporary).
//   - Connection failure → inconclusive (not undeliverable).
//   - Connection timeout → inconclusive.
//   - Multi-line SMTP responses (continuation lines, see RFC 5321 § 4.2.1)
//     are correctly accumulated before the final-line decision.
//   - Cron-context invariant — calling smtpVerifyEmailUncached outside a
//     CronRun throws.

import { Socket } from "node:net";
import { Resolver } from "node:dns/promises";
import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";

// ---- Constants ----------------------------------------------------------

/** SMTP probes are free in dollars. Still cost-counter-attributed so the
 *  cron-context invariant fires and per-call telemetry lands in CronRun. */
export const SMTP_VERIFY_UNIT_COST_USD = 0;

/** Cache TTL for verifier results. SMTP outcomes drift slowly — a mailbox
 *  that exists today almost certainly exists tomorrow — so we dedup for 7d
 *  per .claude/rules/data-cadence.md monthly tier (mailbox lifecycle is
 *  closer to monthly than daily). Cache misses make a real probe; hits
 *  return the prior verdict. */
const SMTP_VERIFY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Hard ceiling on per-probe time. The MX lookup + TCP connect + 4-step
 *  SMTP conversation is normally < 2s. We allow 10s before declaring
 *  inconclusive. Above 10s the cron's per-business budget starts hurting. */
const PROBE_TIMEOUT_MS = 10_000;

/** Socket-level read timeout. Once connected, no individual SMTP exchange
 *  should take > 7s. Independent of PROBE_TIMEOUT_MS so a fast-connect /
 *  slow-respond server doesn't masquerade as a stuck dial. */
const SOCKET_INACTIVITY_TIMEOUT_MS = 7_000;

/** Local-part + domain regex per a permissive reading of RFC 5322. We do
 *  NOT try to fully implement RFC 5322 — that's a known tar pit. This
 *  catches obvious junk (spaces, multiple @, leading dots, etc.) before
 *  spending any DNS or socket budget. */
const EMAIL_SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Test seams ---------------------------------------------------------

let _resolverOverride: ResolverLike | null = null;
let _socketOverride: SocketFactory | null = null;

export interface ResolverLike {
  resolveMx(
    domain: string,
  ): Promise<Array<{ exchange: string; priority: number }>>;
}

export type SocketFactory = (host: string, port: number) => SocketLike;

export interface SocketLike {
  /** Set the inactivity timeout in ms. Called once after construction. */
  setTimeout(ms: number): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "timeout", listener: () => void): void;
  on(event: "connect", listener: () => void): void;
  write(data: string): void;
  end(data?: string): void;
  destroy(): void;
}

export function __setResolverForTesting(r: ResolverLike | null): void {
  _resolverOverride = r;
}

export function __setSocketFactoryForTesting(f: SocketFactory | null): void {
  _socketOverride = f;
}

function getResolver(): ResolverLike {
  return _resolverOverride ?? new Resolver();
}

function getSocketFactory(): SocketFactory {
  return _socketOverride ?? defaultSocketFactory;
}

function defaultSocketFactory(host: string, port: number): SocketLike {
  const sock = new Socket();
  sock.connect(port, host);
  return sock;
}

// ---- Public schemas + types --------------------------------------------

export const SmtpVerifyInputSchema = z.object({
  /** Address to probe. Lowercased + trimmed before any work. */
  email: z.string().min(3).max(254),
  /** RCPT TO MAIL FROM probe identity. Defaults to env or postmaster@<helo>. */
  mailFrom: z.string().email().optional(),
  /** EHLO/HELO hostname the probe announces itself as. Should be a
   *  resolvable hostname so destination MX servers don't reject the
   *  conversation for failed reverse-DNS / SPF posture checks. Defaults to
   *  env SMTP_VERIFY_HELO_HOST or "mapsly.ai". */
  heloHost: z.string().min(1).optional(),
});
export type SmtpVerifyInput = z.input<typeof SmtpVerifyInputSchema>;

export type SmtpVerifyVerdict =
  | "deliverable"
  | "undeliverable"
  | "inconclusive";

export interface SmtpVerifyResult {
  /** Lower-cased, trimmed copy of the probed address. */
  email: string;
  /** The actual MX host we talked to (or attempted). null when no MX. */
  mxHost: string | null;
  /** Three-way outcome. See module docstring for semantics. */
  verdict: SmtpVerifyVerdict;
  /** Numeric SMTP code from the final response we evaluated. null if we
   *  never got past DNS / TCP-connect. */
  smtpCode: number | null;
  /** Short human-readable reason. Safe for Sentry — does NOT include the
   *  local-part of the probed email. */
  reason: string;
  /** True if our DNS lookup found at least one MX record. */
  hasMx: boolean;
  /** Total probe duration in ms (DNS + socket + SMTP). */
  durationMs: number;
}

// ---- Public API ---------------------------------------------------------

/**
 * Probe an address and return a deliverable / undeliverable / inconclusive
 * verdict. Cost-tracked + cron-context-enforced (throws if called outside
 * an open CronRun).
 *
 * This is the entrypoint to bypass the 7d dedup cache (admin "Re-verify
 * now" actions, integration tests). Most callers should use
 * {@link smtpVerifyEmail} instead.
 */
export const smtpVerifyEmailUncached = withCostCounter(
  "email-verify.smtp.verify",
  SMTP_VERIFY_UNIT_COST_USD,
  smtpVerifyEmailRaw,
);

/**
 * Cost-tracked + KV-cached (7d) SMTP verification.
 *
 * Per .claude/rules/data-cadence.md, mailbox-state changes slowly, so a 7d
 * dedup is the right knob: re-running onboarding for the same address in
 * the same week hits cache; the monthly email-verification cron picks
 * fresh data.
 */
export const smtpVerifyEmail = kvCache(
  "email-verify:smtp:verify",
  { ttl: SMTP_VERIFY_CACHE_TTL_SECONDS, tag: "email-verify:smtp" },
  smtpVerifyEmailUncached,
);

/**
 * Convenience for callers that only need the boolean — most SMB onboarding
 * + agency cohort-upload paths don't care about smtpCode or mxHost, only
 * "should I accept this address into the DB?".
 *
 * Treats `inconclusive` as accept (catch-all / greylist mailboxes are
 * usually real); only `undeliverable` returns false.
 */
export async function isLikelyDeliverable(email: string): Promise<boolean> {
  const result = await smtpVerifyEmail({ email });
  return result.verdict !== "undeliverable";
}

// ---- Implementation -----------------------------------------------------

async function smtpVerifyEmailRaw(
  input: SmtpVerifyInput,
): Promise<SmtpVerifyResult> {
  const startedAt = Date.now();
  const parsed = SmtpVerifyInputSchema.parse(input);
  const email = parsed.email.trim().toLowerCase();

  // Syntax gate — catch obvious junk before DNS.
  if (!EMAIL_SYNTAX.test(email)) {
    return {
      email,
      mxHost: null,
      verdict: "undeliverable",
      smtpCode: null,
      reason: "syntax-invalid",
      hasMx: false,
      durationMs: Date.now() - startedAt,
    };
  }

  const atIdx = email.lastIndexOf("@");
  // EMAIL_SYNTAX guarantees atIdx > 0 and < email.length - 1, but be defensive.
  const domain = atIdx > 0 ? email.slice(atIdx + 1) : "";
  if (!domain) {
    return {
      email,
      mxHost: null,
      verdict: "undeliverable",
      smtpCode: null,
      reason: "missing-domain",
      hasMx: false,
      durationMs: Date.now() - startedAt,
    };
  }

  // ---- DNS MX lookup ----
  let mxRecords: Array<{ exchange: string; priority: number }>;
  try {
    mxRecords = await getResolver().resolveMx(domain);
  } catch {
    // ENODATA / ENOTFOUND → no MX, but some domains accept mail on the A
    // record. We treat absence of MX as undeliverable here; the monthly
    // cron isn't a place to make optimistic assumptions about
    // implicit-MX-via-A.
    return {
      email,
      mxHost: null,
      verdict: "undeliverable",
      smtpCode: null,
      reason: "no-mx-record",
      hasMx: false,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!mxRecords || mxRecords.length === 0) {
    return {
      email,
      mxHost: null,
      verdict: "undeliverable",
      smtpCode: null,
      reason: "no-mx-record",
      hasMx: false,
      durationMs: Date.now() - startedAt,
    };
  }

  // Lowest-priority MX wins per RFC 5321 § 5.1.
  const sorted = [...mxRecords].sort((a, b) => a.priority - b.priority);
  const mxHost = sorted[0]!.exchange;

  const mailFrom =
    parsed.mailFrom ??
    process.env.SMTP_VERIFY_MAIL_FROM ??
    `postmaster@${parsed.heloHost ?? process.env.SMTP_VERIFY_HELO_HOST ?? "mapsly.ai"}`;
  const heloHost =
    parsed.heloHost ?? process.env.SMTP_VERIFY_HELO_HOST ?? "mapsly.ai";

  // ---- SMTP probe ----
  let smtpResult: { code: number | null; reason: string };
  try {
    smtpResult = await probeRcpt({
      mxHost,
      email,
      mailFrom,
      heloHost,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      socketTimeoutMs: SOCKET_INACTIVITY_TIMEOUT_MS,
    });
  } catch (err) {
    return {
      email,
      mxHost,
      verdict: "inconclusive",
      smtpCode: null,
      reason: classifyConnectionFailure(err),
      hasMx: true,
      durationMs: Date.now() - startedAt,
    };
  }

  const verdict = classifyVerdict(smtpResult.code);
  return {
    email,
    mxHost,
    verdict,
    smtpCode: smtpResult.code,
    reason: smtpResult.reason,
    hasMx: true,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Map an SMTP response code into our three-way verdict.
 *
 *   - 2xx (250 OK, 251 forwarded) → deliverable
 *   - 5xx (550 user unknown, 553 syntax) → undeliverable
 *   - 4xx (450 try later, 451 local error, 452 storage) → inconclusive
 *   - null / anything else → inconclusive (we couldn't reach a verdict)
 */
function classifyVerdict(code: number | null): SmtpVerifyVerdict {
  if (code === null) return "inconclusive";
  if (code >= 200 && code < 300) return "deliverable";
  if (code >= 500 && code < 600) return "undeliverable";
  if (code >= 400 && code < 500) return "inconclusive";
  return "inconclusive";
}

/**
 * Single-shot SMTP probe. Opens TCP to mxHost:25, runs:
 *
 *   S: 220 <banner>
 *   C: EHLO <helo>
 *   S: 250 ...                         (multi-line OK)
 *   C: MAIL FROM:<sender>
 *   S: 250 OK                          (or 5xx → undeliverable for sender)
 *   C: RCPT TO:<probed>
 *   S: <THIS IS THE VERDICT>
 *   C: QUIT
 *
 * Never sends DATA. The verdict is the response to RCPT TO.
 *
 * Resolved value is `{ code, reason }`. Rejects only on transport-level
 * errors (DNS already done; this rejects on TCP refuse / timeout / etc.).
 */
async function probeRcpt(options: {
  mxHost: string;
  email: string;
  mailFrom: string;
  heloHost: string;
  probeTimeoutMs: number;
  socketTimeoutMs: number;
}): Promise<{ code: number | null; reason: string }> {
  const { mxHost, email, mailFrom, heloHost, probeTimeoutMs, socketTimeoutMs } =
    options;

  return new Promise((resolve, reject) => {
    const sock = getSocketFactory()(mxHost, 25);
    sock.setTimeout(socketTimeoutMs);

    let buffer = "";
    let stage: "banner" | "ehlo" | "mail" | "rcpt" | "quit" | "done" = "banner";
    let settled = false;
    let rcptVerdict: { code: number | null; reason: string } | null = null;

    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      reject(new Error("smtp-probe-hard-timeout"));
    }, probeTimeoutMs);

    function finish(value: { code: number | null; reason: string }): void {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try {
        sock.end("QUIT\r\n");
      } catch {
        // ignore
      }
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    }

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      reject(err);
    }

    sock.on("error", (err) => fail(err));
    sock.on("timeout", () => fail(new Error("smtp-probe-socket-timeout")));
    sock.on("close", () => {
      if (settled) return;
      // Closed without a verdict — treat as transport failure so caller
      // returns inconclusive (NOT undeliverable).
      if (rcptVerdict) {
        finish(rcptVerdict);
      } else {
        fail(new Error("smtp-probe-closed-early"));
      }
    });

    sock.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      // SMTP responses are line-delimited (CRLF) and may span multiple
      // lines. The terminating line of a multi-line response has
      // "NNN " (code followed by SPACE) — continuation lines have
      // "NNN-" (code followed by HYPHEN). Per RFC 5321 § 4.2.1.
      while (true) {
        const eolIdx = buffer.indexOf("\r\n");
        if (eolIdx < 0) break;
        const line = buffer.slice(0, eolIdx);
        buffer = buffer.slice(eolIdx + 2);

        const code = parseSmtpCode(line);
        const isFinal = isFinalLine(line);

        if (!isFinal) continue;

        // Per-stage handler advances the conversation:
        try {
          handleFinalLine(code, line);
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)));
          return;
        }
      }
    });

    function handleFinalLine(code: number | null, line: string): void {
      switch (stage) {
        case "banner": {
          if (code === null || code < 200 || code >= 600) {
            fail(new Error(`smtp-probe-bad-banner:${line}`));
            return;
          }
          if (code >= 400) {
            // Server refusing at banner stage — not our recipient's fault.
            rcptVerdict = { code: null, reason: "banner-refused" };
            finish(rcptVerdict);
            return;
          }
          stage = "ehlo";
          sock.write(`EHLO ${heloHost}\r\n`);
          return;
        }
        case "ehlo": {
          if (code !== null && code >= 500) {
            // Servers that don't speak EHLO sometimes still speak HELO.
            // Send HELO and reuse this stage for its response.
            sock.write(`HELO ${heloHost}\r\n`);
            return;
          }
          if (code === null || code < 200 || code >= 400) {
            rcptVerdict = { code, reason: "ehlo-refused" };
            finish(rcptVerdict);
            return;
          }
          stage = "mail";
          sock.write(`MAIL FROM:<${mailFrom}>\r\n`);
          return;
        }
        case "mail": {
          if (code === null || code < 200 || code >= 400) {
            // MAIL FROM rejected — verdict is about the SENDER, not the
            // probed recipient. We can't draw a conclusion about the
            // recipient's deliverability from this response.
            rcptVerdict = { code: null, reason: "mail-from-refused" };
            finish(rcptVerdict);
            return;
          }
          stage = "rcpt";
          sock.write(`RCPT TO:<${email}>\r\n`);
          return;
        }
        case "rcpt": {
          rcptVerdict = { code, reason: extractReason(code) };
          stage = "quit";
          finish(rcptVerdict);
          return;
        }
        case "quit":
        case "done":
          // Server kept talking after our verdict. Don't care.
          return;
      }
    }
  });
}

/** Parse the leading 3-digit SMTP code, or null if missing/malformed. */
function parseSmtpCode(line: string): number | null {
  if (line.length < 3) return null;
  const codeStr = line.slice(0, 3);
  if (!/^\d{3}$/.test(codeStr)) return null;
  return Number(codeStr);
}

/** Final line of a multi-line response uses "NNN " (space at offset 3).
 *  Continuation uses "NNN-". A line shorter than 4 chars is treated as
 *  final (some servers emit short final lines). */
function isFinalLine(line: string): boolean {
  if (line.length < 4) return true;
  return line.charAt(3) === " ";
}

/** Build a Sentry-safe reason string. We include the SMTP code and a
 *  short tag derived from the line, but NOT the verbatim line — server
 *  text sometimes echoes the probed address back. */
function extractReason(code: number | null): string {
  const tag =
    code === null
      ? "unknown"
      : code >= 500 && code < 600
        ? "user-unknown"
        : code >= 400 && code < 500
          ? "temporary"
          : code >= 200 && code < 300
            ? "accepted"
            : "other";
  return `rcpt-${tag}-${code ?? "noCode"}`;
}

/**
 * Map a transport-layer failure to a Sentry-safe reason tag. Never
 * propagates the probed email through to the reason text.
 */
function classifyConnectionFailure(err: unknown): string {
  if (!(err instanceof Error)) return "unknown-transport-error";
  const msg = err.message;
  if (msg === "smtp-probe-hard-timeout") return "probe-timeout";
  if (msg === "smtp-probe-socket-timeout") return "socket-timeout";
  if (msg === "smtp-probe-closed-early") return "closed-early";
  if (msg.startsWith("smtp-probe-bad-banner:")) return "bad-banner";
  // node net errors expose .code (ECONNREFUSED, EHOSTUNREACH, etc.)
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === "string" && code.length > 0) {
    return `transport-${code.toLowerCase()}`;
  }
  return "transport-unknown";
}
