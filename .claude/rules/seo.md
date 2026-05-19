---
description: SEO patterns. Static where possible, structured data, sitemap, canonical, Core Web Vitals.
globs:
  [
    "app/(marketing)/**/*.tsx",
    "app/(static-seo)/**/*.tsx",
    "app/sitemap.ts",
    "app/robots.ts",
  ]
---

# SEO

Mapsly competes on **search visibility** to acquire customers. Every public page must be SEO-perfect.

## Static generation (mandatory for marketing)

All marketing pages, `for-businesses`, `for-agencies`, blog, public profile pages use `'use cache'` with `cacheLife('weeks')`. They build at deploy time. They serve as HTML.

```tsx
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export default async function ForAgenciesPage() {
  cacheLife("weeks");
  cacheTag("marketing-for-agencies");
  return <Page />;
}
```

## Metadata API

Every public page exports `generateMetadata` or `metadata`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mapsly for agencies — Local SMBs ready to switch",
  description:
    "Query 2M+ local businesses by signal. Verified contacts. Weekly refresh.",
  alternates: {
    canonical: "https://mapsly.ai/for-agencies",
    languages: {
      "en-US": "/en/for-agencies",
      "es-US": "/es/for-agencies",
      "en-CA": "/en-ca/for-agencies",
      "fr-CA": "/fr/for-agencies",
    },
  },
  openGraph: {
    type: "website",
    siteName: "Mapsly",
    title: "Mapsly for agencies",
    description: "Local SMBs ready to switch. With reasons. With contacts.",
    images: [
      {
        url: "https://mapsly.ai/og/for-agencies.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mapsly for agencies",
    description: "Local SMBs ready to switch. With reasons. With contacts.",
  },
  robots: { index: true, follow: true },
};
```

For dynamic pages:

```tsx
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const biz = await getBusinessBySlug(slug);
  return {
    title: `${biz.name} — local intelligence by Mapsly`,
    description: `Mapsly Score, market position, competitor analysis for ${biz.name}.`,
    alternates: { canonical: `https://mapsly.ai/biz/${slug}` },
  };
}
```

## Structured data (JSON-LD)

Add `LocalBusiness` schema on every business profile page:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "MedicalBusiness", // or appropriate type
      name: biz.name,
      address: { "@type": "PostalAddress" /* ... */ },
      telephone: biz.phone,
      url: biz.website,
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: biz.rating,
        reviewCount: biz.reviewCount,
      },
    }),
  }}
/>
```

For blog/article pages — `Article` schema.
For homepage — `Organization` schema.
For FAQ blocks — `FAQPage` schema (eligible for rich snippets).

## Sitemap

```ts
// app/sitemap.ts
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://mapsly.ai";

  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 1.0,
    },
    { url: `${baseUrl}/for-agencies`, lastModified: new Date(), priority: 0.9 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), priority: 0.8 },
  ];

  // Public business profile pages (if we open these to SEO)
  const businesses = await prisma.business.findMany({
    where: { isActive: true, hasPublicProfile: true },
    select: { slug: true, updatedAt: true },
    take: 50_000,
  });
  const bizRoutes = businesses.map((b) => ({
    url: `${baseUrl}/biz/${b.slug}`,
    lastModified: b.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...bizRoutes];
}
```

**Rules:**

- Cap at 50,000 URLs per sitemap file. Split with `app/sitemap/[id]/route.ts` if exceeded.
- Reference sitemap in `robots.ts`.
- Submit to GSC after each deploy that adds URLs.

## Robots

```ts
// app/robots.ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/", "/(smb)/", "/(agency)/"],
      },
    ],
    sitemap: "https://mapsly.ai/sitemap.xml",
  };
}
```

- Allow indexing of public pages
- Disallow `/api/`, `/admin/`, and authenticated routes (signed-in users only)

## Internal linking

- Marketing → blog → public business pages — link generously
- Footer has a hub-spoke pattern (city/category → top businesses)
- Anchor text matches the destination's H1 keyword

## Core Web Vitals impact on SEO

Google ranks on real-user CWV (CrUX) data. Maintaining the performance budgets in `performance.md` is the SEO strategy.

Specifically for SEO routes (marketing, blog, public biz pages):

- LCP < 1.5s (stricter than the in-app 2.0s budget)
- CLS < 0.05
- INP < 100ms
- All scores from real-user data (Search Console → Core Web Vitals report)

## hreflang

For i18n (see `i18n.md`):

```tsx
// every page's metadata includes
alternates: {
  canonical: 'https://mapsly.ai/page',
  languages: {
    'en-US': '/en/page',
    'es-US': '/es/page',
    'en-CA': '/en-ca/page',
    'fr-CA': '/fr/page',
    'x-default': '/page',
  },
},
```

## Canonical strategy

- Every page has an explicit `alternates.canonical`
- For paginated pages: `?page=2` canonicals back to `?page=1` (or its own URL if pagination is content-distinct)
- Never canonical to a non-existing URL
- For preview / staging URLs: `noindex, nofollow`

## What NOT to index

- Auth routes (`/signin`, `/signin/check-email`)
- App routes (`/dashboard`, `/lists`, etc.)
- API routes
- Admin
- Preview deploys (set `X-Robots-Tag: noindex` via `next.config`)

## Validation checklist

Before deploying any new marketing page:

- [ ] H1 contains primary keyword
- [ ] Meta description 150–160 chars, mentions value prop
- [ ] OG image 1200×630, < 200kB
- [ ] Schema JSON-LD validates (https://validator.schema.org)
- [ ] Lighthouse SEO score ≥ 95
- [ ] Internal links to/from this page exist
- [ ] Sitemap includes it
- [ ] hreflang for all supported locales

## Anti-patterns

- ❌ Client-rendered marketing pages (Google can render JS but slower + less reliable)
- ❌ `'use client'` on a route that should be static
- ❌ Untagged cache on marketing → can never invalidate after copy edit
- ❌ Missing canonical
- ❌ Schema with placeholder values
- ❌ Sitemap referencing 404s
