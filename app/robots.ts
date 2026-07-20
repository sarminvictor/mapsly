/**
 * Public robots · `https://mapsly.ai/robots.txt`
 *
 * Allow indexing of public marketing surface; disallow:
 *   - `/api/`         · API routes (defense in depth · headers already noindex)
 *   - `/dev`, `/dev/` · the autonomous-build dashboard (host-gated, but belt+braces)
 *   - `/home*`   · SMB portal (authenticated)
 *   - `/discover*`    · agency portal (authenticated · demand-driven entry)
 *   - `/signin*`      · auth flow (no SEO value, may leak short-lived tokens)
 *   - `/post-signin*` · post-auth bounce
 *
 * Per `.claude/rules/seo.md` § Robots, references the sitemap URL so crawlers
 * discover it without GSC registration.
 *
 * No `new Date()` anywhere · output is a pure function.
 */

import type { MetadataRoute } from "next";

import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

// No `export const revalidate` — dead config under cacheComponents
// (INC-2026-07-20-66 prevention #5); the output is pure and static anyway.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/l/", // personalized landing proposals (no-index, unguessable token)
          "/r/", // landing removal flow (token-keyed, no SEO value)
          "/u/", // cold-email unsubscribe (token-keyed, no SEO value)
          "/o/", // cold-email open pixel (token-keyed, returns a 1x1 GIF)
          "/s/", // agency-branded shared prospect one-pagers (token-keyed, no-index)
          "/dev",
          "/dev/",
          "/home",
          "/home/",
          "/discover",
          "/discover/",
          "/signin",
          "/signin/",
          "/post-signin",
          "/post-signin/",
        ],
      },
    ],
    sitemap: `${CANONICAL_ORIGIN}/sitemap.xml`,
  };
}
