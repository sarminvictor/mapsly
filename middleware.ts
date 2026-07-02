import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// WP8-4 · Content Security Policy (nonce-based, allowlisted, no unsafe-eval).
// Directives mirror `.claude/rules/security.md` §CSP verbatim. Rolled out in
// Report-Only mode first (zero breakage risk): the header is present and
// correctly configured, violations are reported, and nothing is blocked.
// FLIP TO ENFORCING after a browser pass confirms no legitimate resource is
// reported — change CSP_HEADER_NAME to "Content-Security-Policy". Tracked in
// docs/mvp-10of10-tracker.md WP8-4.
const CSP_HEADER_NAME = "Content-Security-Policy-Report-Only";

function buildCsp(nonce: string): string {
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' https://js.stripe.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: https://lh3.googleusercontent.com https://*.public.blob.vercel-storage.com;
    connect-src 'self' https://api.stripe.com https://*.posthog.com;
    frame-src https://js.stripe.com https://hooks.stripe.com;
    base-uri 'self';
    form-action 'self';
    object-src 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s+/g, " ")
    .trim();
}

export default function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl;

  // Per-request nonce; forwarded to the app via `x-nonce` so Next tags its own
  // framework scripts (and any inline script that reads it) with the same nonce.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_HEADER_NAME, csp);
  const nextWithNonce = () =>
    NextResponse.next({ request: { headers: requestHeaders } });
  const secure = (res: NextResponse): NextResponse => {
    res.headers.set(CSP_HEADER_NAME, csp);
    return res;
  };

  // Subdomain split: dev.mapsly.ai → /dev internally.
  // Local development uses dev.localhost:3000 to mimic the same routing.
  const isDevHost =
    host.startsWith("dev.") ||
    host.startsWith("dev-") ||
    host === "dev.localhost:3000";

  if (isDevHost) {
    // Already inside the /dev tree → let it through (no intl, no rewrite).
    if (url.pathname.startsWith("/dev")) return secure(nextWithNonce());
    // Rewrite root and anything else to the /dev tree.
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/dev${url.pathname === "/" ? "" : url.pathname}`;
    return secure(
      NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      }),
    );
  }

  // Main domain → hide /dev (404 instead of leaking the dashboard).
  if (url.pathname === "/dev" || url.pathname.startsWith("/dev/")) {
    return secure(new NextResponse("Not found", { status: 404 }));
  }

  // /admin sits OUTSIDE the next-intl locale tree (internal ops surface,
  // staff-only, English-only — same shape as /dev). Pass it through so
  // next-intl doesn't try to apply locale prefixing and 404. The route's
  // own admin gate enforces auth + role.
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return secure(nextWithNonce());
  }

  // /l/[token] — public, no-index landing pages (the emailed SMB proposals).
  // Outside the locale tree (a direct-share artifact like /admin), so pass it
  // through untouched; the route resolves the token + 404s on mismatch.
  if (url.pathname.startsWith("/l/")) {
    return secure(nextWithNonce());
  }

  // /u/[token] — one-click cold-email unsubscribe (RFC 8058). Locale-agnostic,
  // no auth; the route verifies the HMAC token and suppresses the address.
  if (url.pathname.startsWith("/u/")) {
    return secure(nextWithNonce());
  }

  // /r/[token] — landing-page removal ("Not your business?"). Locale-agnostic
  // like /u; GET confirms, POST deactivates the landing + suppresses email.
  if (url.pathname.startsWith("/r/")) {
    return secure(nextWithNonce());
  }

  // /o/[token] — cold-email open-tracking pixel. Locale-agnostic like /u;
  // always answers a 1x1 GIF (mail clients fetch it as an inline image).
  if (url.pathname.startsWith("/o/")) {
    return secure(nextWithNonce());
  }

  // /s/[token] — agency-branded public share of a prospect one-pager (WP6-10).
  // Locale-agnostic, no-index, token-keyed like /l; the route resolves the
  // Report.publicShareId + 404s on a bad/expired token.
  if (url.pathname.startsWith("/s/")) {
    return secure(nextWithNonce());
  }

  // /opt-out (+ /opt-out/[token]) — public do-not-sell / suppression flow
  // (WP7-2). Locale-agnostic, no-index, no auth: GET shows the email form or a
  // token confirm card; POST emails a verification link OR (on the token path)
  // writes Business.suppressedAt / Contact.optedOutAt. Rate-limited in-route.
  if (url.pathname === "/opt-out" || url.pathname.startsWith("/opt-out/")) {
    return secure(nextWithNonce());
  }

  // /checkout/* — the direct-from-landing Stripe flow (start redirect lives
  // under /api; the post-payment return page lives here). Locale-agnostic
  // direct-share artifacts like /l/ — pass through untouched.
  if (url.pathname.startsWith("/checkout")) {
    return secure(nextWithNonce());
  }

  // Everything else → next-intl handles locale negotiation. Run intl on a
  // request that already carries the nonce header, then stamp the CSP on its
  // response so the whole locale-routed app (marketing + both portals) is
  // covered with the same per-request nonce.
  const intlReq = new NextRequest(req, { headers: requestHeaders });
  return secure(intlMiddleware(intlReq));
}

export const config = {
  // Match everything except: api, _next, _vercel, and real static-asset paths.
  // The previous pattern `.*\..*` was too aggressive — it excluded any path
  // containing a dot (like task IDs `A.1`, `1.10.4`). See INC-2026-05-19-15.
  matcher: [
    "/((?!api|_next|_vercel|.*\\.(?:css|js|mjs|json|webmanifest|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav|pdf|txt|xml|zip)).*)",
  ],
};
