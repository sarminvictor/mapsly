/**
 * Cold-email unsubscribe · /u/[token].
 *
 * GET   → confirm card ONLY — it NEVER writes (decision log #17c). Email
 *         security gateways (Barracuda, Mimecast, Outlook SafeLinks…) GET
 *         every link in every email; when GET honored the opt-out instantly,
 *         scanners could mass-unsubscribe recipients who never clicked.
 *         The card shows the address + one button posting back here.
 * POST  → executes the opt-out, instantly, for BOTH callers of this route:
 *           1. RFC 8058 one-click (List-Unsubscribe-Post header) — mail
 *              providers POST body `List-Unsubscribe=One-Click` with zero
 *              human interaction (RFC 8058 §3.2) → 200, empty body.
 *           2. The confirm-card button → same write, then the done card.
 *
 * COMPLIANCE: CAN-SPAM §7704(a)(3)/(a)(5) and CASL s.11 require a functioning
 * opt-out honored within 10 days — a one-button confirm honored instantly
 * satisfies both. The GET confirm step exists solely for scanner safety; the
 * RFC 8058 machine path stays zero-click and instant.
 *
 * The token is a stateless HMAC of the email (modules/cold/token.ts), so
 * there's no row to look up — verify, then write the global ColdSuppression
 * + stop any matching recipients. Idempotent: an already-suppressed address
 * gets the done card on GET and a no-op-ish upsert on POST. Locale-agnostic
 * (middleware bypass). No-index. Rate-limited (PUBLIC_LIMIT, by IP) like /r.
 */
import { z } from "zod";

import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import prisma from "@/lib/prisma";

import { isSuppressed, suppress } from "@/modules/cold/suppression";
import { verifyUnsubscribeToken } from "@/modules/cold/token";

/** `${base64url(email)}.${base64url(hmac)}` — cheap shape gate pre-HMAC. */
const TokenSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

async function doUnsubscribe(email: string): Promise<void> {
  await suppress(email, "UNSUBSCRIBE");
  await prisma.coldRecipient.updateMany({
    where: { email: email.toLowerCase() },
    data: {
      status: "UNSUBSCRIBED",
      stopReason: "unsubscribed",
      nextRunAt: null,
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared shell · same visual register as /r/[token] (warm cream, one card). */
function page(opts: {
  heading: string;
  body: string;
  formToken?: string;
  status: number;
}): Response {
  const button = opts.formToken
    ? `<form method="post" action="/u/${opts.formToken}" style="margin:24px 0 0"><button type="submit">Unsubscribe</button></form><p class="aside">Changed your mind? Just close this tab.</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · Mapsly</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf6f1;color:#2b2b2b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#666;line-height:1.55;margin:0}button{background:#c3553a;color:#fff;border:0;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer}.aside{margin-top:14px;font-size:13px;color:#999}</style></head><body><div class="card"><h1>${opts.heading}</h1><p>${opts.body}</p>${button}</div></body></html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

function invalidPage(): Response {
  return page({
    heading: "This unsubscribe link is invalid or expired.",
    body: "Please try the link from your email again, or reply to ask us to remove you.",
    status: 400,
  });
}

function donePage(): Response {
  return page({
    heading: "You're unsubscribed.",
    body: "You won't receive any more emails from us. Sorry for the interruption.",
    status: 200,
  });
}

/** Token param → verified lowercased email, or null (Zod shape + HMAC). */
function emailFromToken(token: string): string | null {
  const parsed = TokenSchema.safeParse(token);
  if (!parsed.success) return null;
  return verifyUnsubscribeToken(parsed.data);
}

/** GET — confirm card only. NEVER writes (scanner-safety invariant). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const { token } = await ctx.params;
  const email = emailFromToken(token);
  if (!email) return invalidPage();

  if (await isSuppressed(email)) return donePage(); // already out — idempotent

  return page({
    heading: "Unsubscribe?",
    body: `We'll stop emailing ${escapeHtml(email)}.`,
    formToken: token,
    status: 200,
  });
}

/** POST — the write. Serves RFC 8058 one-click AND the confirm-card button. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const { token } = await ctx.params;
  const email = emailFromToken(token);
  if (!email) return new Response("Invalid link", { status: 400 });

  // RFC 8058 §3.2: mail providers POST `List-Unsubscribe=One-Click` as the
  // body. Detect it ONLY to shape the response (machines get a bare 200, the
  // card button gets the done page) — the write below runs for both paths.
  const body = await req.text().catch(() => "");
  const isOneClick = body.includes("List-Unsubscribe=One-Click");

  await doUnsubscribe(email);

  return isOneClick ? new Response(null, { status: 200 }) : donePage();
}
