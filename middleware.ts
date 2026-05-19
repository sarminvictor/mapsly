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

  // Everything else → next-intl handles locale negotiation.
  return intlMiddleware(req);
}

export const config = {
  // Match everything except: api, _next, _vercel, files with extensions.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
