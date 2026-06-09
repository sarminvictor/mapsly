/**
 * Cold-email one-click unsubscribe · /u/[token].
 *
 * POST  → RFC 8058 one-click (List-Unsubscribe-Post). 200, no body.
 * GET   → visible link target; also honours the opt-out immediately + shows a
 *         confirmation page (honoring instantly beats the 10-day legal floor).
 *
 * The token is a stateless HMAC of the email (modules/cold/token.ts), so there's
 * no row to look up — verify, then write the global ColdSuppression + flip any
 * matching recipients. Locale-agnostic (middleware bypass).
 */
import prisma from "@/lib/prisma";

import { suppress } from "@/modules/cold/suppression";
import { verifyUnsubscribeToken } from "@/modules/cold/token";

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

function page(heading: string, ok: boolean): Response {
  const sub = ok
    ? "You won't receive any more emails from us. Sorry for the interruption."
    : "Please try the link from your email again, or reply to ask us to remove you.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · Mapsly</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf6f1;color:#2b2b2b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#666;line-height:1.55;margin:0}</style></head><body><div class="card"><h1>${heading}</h1><p>${sub}</p></div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const email = verifyUnsubscribeToken(token);
  if (!email) return new Response("Invalid link", { status: 400 });
  await doUnsubscribe(email);
  return new Response(null, { status: 200 });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const email = verifyUnsubscribeToken(token);
  if (!email)
    return page("This unsubscribe link is invalid or expired.", false);
  await doUnsubscribe(email);
  return page("You're unsubscribed.", true);
}
