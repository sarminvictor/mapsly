/**
 * Landing-page removal · /r/[token] · "Not your business? Remove this page".
 *
 * Linked from the /l/[slug]-[token] footer. Keyed by the SAME unguessable
 * 16-digit landing token the page itself resolves by — possession of the link
 * is the authorization (same capability model as /l and /u).
 *
 * SCANNER-SAFE (the plan-#17 decision): email security scanners prefetch GETs,
 * so GET only shows a confirm page with a button — it NEVER writes. Only POST
 * (the button) executes:
 *   1. LandingPage.isActive → false  (the /l gate, `resolveLandingToken`, is
 *      uncached, so the link 404s on the very next request)
 *   2. Business.email (when set) → ColdSuppression (UNSUBSCRIBE · the closest
 *      existing source; reason "landing-removal") so cold email stops too
 *   3. Matching ColdRecipient rows → UNSUBSCRIBED (by email + by reportToken)
 *
 * Locale-agnostic (middleware bypass, like /u). No-index. Rate-limited per
 * `.claude/rules/scalability.md` (public profile, by IP). Token validated with
 * Zod before any lookup.
 */

import { z } from "zod";

import prisma from "@/lib/prisma";
import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import { suppress } from "@/modules/cold/suppression";

/** 16-digit landing token, first digit non-zero (modules/smb-landing/token.ts). */
const TokenSchema = z.string().regex(/^[1-9][0-9]{15}$/);

function findLanding(token: string) {
  return prisma.landingPage.findUnique({
    where: { token },
    select: {
      id: true,
      isActive: true,
      business: { select: { name: true, email: true } },
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

/** Shared shell · same visual register as /u/[token] (warm cream, one card). */
function page(opts: {
  heading: string;
  body: string;
  formToken?: string;
  status: number;
}): Response {
  const button = opts.formToken
    ? `<form method="post" action="/r/${opts.formToken}" style="margin:24px 0 0"><button type="submit">Remove this page</button></form><p class="aside">Changed your mind? Just close this tab.</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remove this page · Mapsly</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf6f1;color:#2b2b2b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:440px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#666;line-height:1.55;margin:0}button{background:#c3553a;color:#fff;border:0;border-radius:999px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer}.aside{margin-top:14px;font-size:13px;color:#999}</style></head><body><div class="card"><h1>${opts.heading}</h1><p>${opts.body}</p>${button}</div></body></html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

function invalidPage(status: 400 | 404): Response {
  return page({
    heading: "This link isn't working.",
    body: "Please use the link from your email, or reply to that email and we'll take the page down for you.",
    status,
  });
}

function donePage(): Response {
  return page({
    heading: "Done.",
    body: "This page is no longer available and we won't email you.",
    status: 200,
  });
}

/** GET — confirm page only. Never writes (scanner safety invariant). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const { token } = await ctx.params;
  const parsed = TokenSchema.safeParse(token);
  if (!parsed.success) return invalidPage(400);

  const lp = await findLanding(parsed.data);
  if (!lp) return invalidPage(404);
  if (!lp.isActive) return donePage(); // already removed — idempotent

  return page({
    heading: "Remove this page?",
    body: `This takes the page for ${escapeHtml(lp.business.name)} offline and stops our emails to you.`,
    formToken: parsed.data,
    status: 200,
  });
}

/** POST — the button. Deactivates the landing + suppresses the email. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const { token } = await ctx.params;
  const parsed = TokenSchema.safeParse(token);
  if (!parsed.success) return invalidPage(400);

  const lp = await findLanding(parsed.data);
  if (!lp) return invalidPage(404);

  await prisma.landingPage.update({
    where: { token: parsed.data },
    data: { isActive: false },
  });

  const email = lp.business.email?.toLowerCase() ?? null;
  if (email) await suppress(email, "UNSUBSCRIBE", "landing-removal");

  await prisma.coldRecipient.updateMany({
    where: email
      ? { OR: [{ email }, { reportToken: parsed.data }] }
      : { reportToken: parsed.data },
    data: {
      status: "UNSUBSCRIBED",
      stopReason: "landing-removed",
      nextRunAt: null,
    },
  });

  console.log(
    JSON.stringify({
      level: "info",
      event: "landing.removed_by_owner",
      landingPageId: lp.id,
      suppressed: email != null,
      ts: new Date().toISOString(),
    }),
  );

  return donePage();
}
