/**
 * Opt-out confirmation · /opt-out/[token]  (WP7-2).
 *
 * The link in the verification email lands here. Same scanner-safety invariant
 * as /u/[token]:
 *   GET  → confirm card ONLY. It NEVER writes — email security gateways
 *          (Barracuda, Mimecast, SafeLinks…) GET every link, so an instant
 *          GET-write would let a scanner suppress a business no human confirmed.
 *   POST → performs the suppression: verify the HMAC token → set
 *          Business.suppressedAt / Contact.optedOutAt via suppressByEmail.
 *
 * The token is a stateless HMAC of the email (modules/opt-out/token.ts), so
 * there's no row to look up — verify, then write. Idempotent: re-confirming an
 * already-suppressed address is a cheap no-op set of updateMany calls.
 * Locale-agnostic (middleware bypass), no-index, IP-rate-limited like /u.
 */

import { z } from "zod";

import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import { suppressByEmail } from "@/modules/opt-out/suppress";
import { verifyOptOutToken } from "@/modules/opt-out/token";

/** `${base64url(payload)}.${base64url(hmac)}` — cheap shape gate pre-HMAC. */
const TokenSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared card shell — matches /opt-out + /u. */
function page(opts: {
  heading: string;
  body: string;
  formToken?: string;
  status: number;
}): Response {
  const button = opts.formToken
    ? `<form method="post" action="/opt-out/${opts.formToken}" style="margin:24px 0 0"><button type="submit">Remove my data</button></form><p class="aside">Changed your mind? Just close this tab.</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opt out · Mapsly</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf6f1;color:#2b2b2b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:460px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#666;line-height:1.55;margin:0}button{background:#c3553a;color:#fff;border:0;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer}.aside{margin-top:14px;font-size:13px;color:#999}</style></head><body><div class="card"><h1>${opts.heading}</h1><p>${opts.body}</p>${button}</div></body></html>`;
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
    heading: "This link is invalid or expired.",
    body: "Please start again from the opt-out page, or reply to the email you received.",
    status: 400,
  });
}

function donePage(): Response {
  return page({
    heading: "You're removed.",
    body: "We've stopped showing this business's data and dropped its contacts from exports and outreach. It won't reappear.",
    status: 200,
  });
}

/** Token param → verified lowercased email, or null (Zod shape + HMAC). */
function emailFromToken(token: string): string | null {
  const parsed = TokenSchema.safeParse(token);
  if (!parsed.success) return null;
  return verifyOptOutToken(parsed.data);
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

  return page({
    heading: "Confirm removal",
    body: `We'll remove <b>${escapeHtml(email)}</b>'s business from Mapsly and drop its contacts from every export and outreach draft.`,
    formToken: token,
    status: 200,
  });
}

/** POST — the write. Verifies the token, then suppresses. Idempotent. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const { token } = await ctx.params;
  const email = emailFromToken(token);
  if (!email) return new Response("Invalid link", { status: 400 });

  await suppressByEmail(email);
  return donePage();
}
