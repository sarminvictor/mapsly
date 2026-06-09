import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl;

  // Subdomain split: dev.mapsly.ai → /dev internally.
  // Local development uses dev.localhost:3000 to mimic the same routing.
  const isDevHost =
    host.startsWith("dev.") ||
    host.startsWith("dev-") ||
    host === "dev.localhost:3000";

  if (isDevHost) {
    // Already inside the /dev tree → let it through (no intl, no rewrite).
    if (url.pathname.startsWith("/dev")) return NextResponse.next();
    // Rewrite root and anything else to the /dev tree.
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/dev${url.pathname === "/" ? "" : url.pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // Main domain → hide /dev (404 instead of leaking the dashboard).
  if (url.pathname === "/dev" || url.pathname.startsWith("/dev/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // /admin sits OUTSIDE the next-intl locale tree (internal ops surface,
  // staff-only, English-only — same shape as /dev). Pass it through so
  // next-intl doesn't try to apply locale prefixing and 404. The route's
  // own admin gate enforces auth + role.
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return NextResponse.next();
  }

  // /l/[token] — public, no-index landing pages (the emailed SMB proposals).
  // Outside the locale tree (a direct-share artifact like /admin), so pass it
  // through untouched; the route resolves the token + 404s on mismatch.
  if (url.pathname.startsWith("/l/")) {
    return NextResponse.next();
  }

  // /u/[token] — one-click cold-email unsubscribe (RFC 8058). Locale-agnostic,
  // no auth; the route verifies the HMAC token and suppresses the address.
  if (url.pathname.startsWith("/u/")) {
    return NextResponse.next();
  }

  // /checkout/* — the direct-from-landing Stripe flow (start redirect lives
  // under /api; the post-payment return page lives here). Locale-agnostic
  // direct-share artifacts like /l/ — pass through untouched.
  if (url.pathname.startsWith("/checkout")) {
    return NextResponse.next();
  }

  // Everything else → next-intl handles locale negotiation.
  return intlMiddleware(req);
}

export const config = {
  // Match everything except: api, _next, _vercel, and real static-asset paths.
  // The previous pattern `.*\..*` was too aggressive — it excluded any path
  // containing a dot (like task IDs `A.1`, `1.10.4`). See INC-2026-05-19-15.
  matcher: [
    "/((?!api|_next|_vercel|.*\\.(?:css|js|mjs|json|webmanifest|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav|pdf|txt|xml|zip)).*)",
  ],
};
