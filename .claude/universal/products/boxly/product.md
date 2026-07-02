# Boxly · product.md

Per-product manifest read by the universal bundle. Personas, voice, palette, density. Constants live in `.claude/product-spec.json`.

## Product

Boxly is a Canadian moving marketplace connecting consumers with local movers.

- **Consumer flow:** instant price estimate → compare movers → request quotes → book
- **Mover flow:** claim profile → set pricing → manage leads → subscribe (Boxly Pro)
- **Revenue:** subscription tiers (free/paid) + lead generation
- **Strategy:** distribution-first (SEO, calculators, widgets) before feature depth

## Audiences

Three surfaces, three registers:

|            | Consumer                                      | Mover (Pro portal)                             | Admin (Viktor)                  |
| ---------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| Persona    | Person planning a move (TODO-Viktor: name)    | Moving-company owner (TODO-Viktor: name)       | Internal only                   |
| Job        | "Get a fair price, book a trustworthy mover"  | "Win more leads, look credible, price right"   | Operate the marketplace         |
| Vocabulary | movers, quote, moving day, boxes, deposit     | leads, quotes, bookings, rankings, Boxly Score | Full technical register         |
| Device     | Mobile-first (books between errands)          | Desktop-leaning, dashboards                    | Desktop, dense                  |
| Density    | One primary CTA per step (6-step order flow)  | Dashboards, rankings, intelligence tables      | Dense tables, filters, all-data |
| Routes     | `(static-marketplace)`, order flow, `/book/*` | `(pro)/pro/**`                                 | `/admin/**`                     |

## Voice

- Consumer copy: plain English, no moving-industry jargon without inline explanation. Trust-building — prices, reviews, Boxly Score visible with sources.
- Mover copy: business-practical — leads, quotes, bookings, rankings. Numbers over adjectives.
- Simple English throughout (owner is a non-native speaker; copy must read easy).
- TODO-Viktor: formal voice guide (tone examples, exclamation/emoji policy, error-copy register) — none exists in the Boxly repo yet.

## Banned words

- TODO-Viktor: no banned-words list documented. Suggested seed for consumer surfaces: internal jargon (SSG, PPR, SERP, CTR), raw industry terms (tariff, long-carry, cube sheet) without plain-English explanation.

## Palette · visual language

shadcn/ui + Tailwind 4, semantic tokens only (auto dark-mode):

- Brand: green primary (`bg-primary`, `bg-gradient-primary` for CTAs), yellow secondary (`bg-secondary`, `bg-gradient-secondary`)
- Custom vars: text `#272e34` (`--color-text-primary`), gray `#6b7280` (`--color-text-gray`), surface `#f3f3f5` (`--color-dark-white`), tint `#f1f8ec` (`--color-light-green-background`)
- Font: Gilroy (global). Icons: Lucide only. Images: `next/image` only.
- Forbidden: raw hex in classnames, Tailwind palette colors (`bg-red-500`), `<img>`, non-Lucide icons, arbitrary z-index.

## Density rules

- Consumer: mobile-first CSS classes (`w-full md:w-1/2`), single CTA per screen, generous whitespace.
- Pro portal + admin: tables and dashboards are fine; density serves the workflow.
- Z-index scale: `-z-1` decorative · `z-10` sticky · `z-20` dropdowns · `z-50` modals/toasts.

## Domain invariants (product-specific, always apply)

- **Active movers rule:** "all movers" means `isActive: true` by default; marketplace additionally `isVisible: true`. Inactive movers excluded from all business logic unless explicitly stated + documented.
- **Route groups gate PPR:** never add next-intl server APIs (`getLocale()`, `getMessages()`) to root, `(static-marketplace)`, `(static-seo)`, or `(static-booking)` layouts.
- **`serialize()`** wraps all Prisma results inside `'use cache'` functions.
- **Validate-before-cache:** dynamic-param pages (`[slug]`, `[city]`, …) validate slugs in an UNCACHED outer function, then call a cached inner function. `notFound()` thrown inside a `'use cache'` scope = "Connection closed" / `Date.now()` bailout in prod (bots crawl literal `/%5Bcity%5D` URLs).
- **Dynamic client hooks need tight Suspense:** any client component using `useSearchParams`/`usePathname`/`useParams` inside a cached page gets its own leaf `<Suspense>` at the page level.
- **No layout-level Suspense** in static route-group layouts — a shell-spanning boundary streams the page into `<div hidden>` and shows as a white screen when the swap script is delayed. Never `fallback={null}` or `fallback={children}` at layout level.
- Cache tags: per-city/per-mover granularity (`movers-${citySlug}`, `mover-${moverSlug}`, `seo-*`, `booking-page-${moverSlug}`) — see CLAUDE.md § Cache Tag Conventions.
- Prisma imports: server `@/lib/prisma` · client `@/lib/prisma-types` · scripts `@/lib/prisma-script` · never bare `@/lib/generated/prisma`.

## Locales

`en` (default) + `fr-CA` (SEO surfaces under `/fr/**`, backed by FrBlogCategoryContent + translate-stale-fr cron). next-intl in `(with-intl)`; static route groups use client-side messages only.

## Owner context

Solo founder (Viktor). Push to `main` = production deploy — **propose-and-wait, never commit/push without explicit approval**. Viktor tests UI manually in the browser; no automated browser validation in interactive sessions. Reviewer scores are informational, not merge gates.
