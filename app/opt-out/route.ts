/**
 * Public do-not-sell / opt-out page · /opt-out  (WP7-2).
 *
 * A Route Handler (not a React page) — same register as /u, /r: locale-agnostic
 * (middleware bypass), no-index, no auth, rendered as a self-contained HTML
 * card. Keeping it a route (vs a [locale] page) avoids the cacheComponents
 * dance and matches the sibling suppression flows.
 *
 * GET  → the email form. NEVER writes.
 * POST → validates the email, emails an HMAC verification link
 *        (modules/opt-out/token.optOutUrlFor), and shows a "check your inbox"
 *        card. It does NOT suppress on submit: control of the inbox is the
 *        proof (magic-link pattern) so a stranger can't opt out someone else's
 *        business by typing their address. The confirmation link (POST to
 *        /opt-out/[token]) performs the actual write.
 *
 * To avoid leaking whether an address is in our index, the response is the SAME
 * "check your inbox" card whether or not we found matching data (enumeration-
 * safe). Rate-limited by IP (PUBLIC_LIMIT) like /u and /r.
 */

import { z } from "zod";

import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import { sendOptOutVerification } from "@/modules/opt-out/email";
import { optOutUrlFor } from "@/modules/opt-out/token";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EmailSchema = z.string().trim().toLowerCase().max(254).regex(EMAIL_RE);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared card shell — same warm-cream register as /u and /r. */
function page(opts: {
  heading: string;
  body: string;
  status: number;
}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opt out · Mapsly</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf6f1;color:#2b2b2b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:460px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#666;line-height:1.55;margin:0 0 16px}form{margin:20px 0 0}input[type=email]{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid #e2ddd4;border-radius:10px;font-size:15px;margin-bottom:14px}button{background:#c3553a;color:#fff;border:0;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer;width:100%}.aside{margin-top:14px;font-size:13px;color:#999}</style></head><body><div class="card"><h1>${opts.heading}</h1>${opts.body}</div></body></html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

function formCard(status = 200, error?: string): Response {
  const err = error ? `<p style="color:#c3553a">${escapeHtml(error)}</p>` : "";
  return page({
    heading: "Remove your business from Mapsly",
    status,
    body:
      `<p>Enter the business email address. We'll send a link to confirm you control it — then we stop showing your data and drop your contacts from any exports.</p>${err}` +
      `<form method="post" action="/opt-out"><input type="email" name="email" placeholder="you@yourbusiness.com" required autocomplete="email" inputmode="email"><button type="submit">Send confirmation link</button></form>` +
      `<p class="aside">We email you first so no one can opt out a business they don't own.</p>`,
  });
}

function sentCard(): Response {
  return page({
    heading: "Check your inbox",
    status: 200,
    body: `<p>If that address is in our records, we've sent a confirmation link. Open it to finish removing your data. The link expires when used.</p>`,
  });
}

/** GET — the email form. Never writes. */
export async function GET(req: Request): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;
  return formCard();
}

/** POST — validate + email the verification link. Never suppresses here. */
export async function POST(req: Request): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  let email: string;
  try {
    const form = await req.formData();
    const parsed = EmailSchema.safeParse(form.get("email"));
    if (!parsed.success) {
      return formCard(400, "Please enter a valid email address.");
    }
    email = parsed.data;
  } catch {
    return formCard(400, "Please enter a valid email address.");
  }

  // Email the verification link. Enumeration-safe: the visitor ALWAYS sees the
  // same "check your inbox" card, whether or not the address matched any data
  // (a send is attempted regardless — if the address isn't ours, the owner
  // simply never receives it).
  await sendOptOutVerification({ to: email, verifyUrl: optOutUrlFor(email) });
  return sentCard();
}
