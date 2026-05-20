---
name: seo-check
description: Weekly SEO health check via Google Search Console MCP + on-page audit. Reports indexing status, top queries/pages, regressions, schema validity.
---

# /seo-check

Comprehensive SEO health check. Spawn the `seo-auditor` agent.

## Usage

```
/seo-check                # Last 28d default
/seo-check --window=7d    # Custom window
/seo-check --page=/biz/*  # Filter by URL pattern
```

## Checks performed

### GSC (via mcp**gsc**\*)

- Total clicks/impressions trend (this period vs prior)
- Top 25 pages by clicks + position
- Quick wins (positions 4-10, low CTR)
- Indexed vs submitted in sitemap

### On-page (via Read + Grep)

- Every public route has `generateMetadata` or `metadata` export
- Canonical declared
- hreflang for all 4 locales
- OG image declared
- JSON-LD validates

### Sitemap

- `app/sitemap.ts` generates valid XML
- Under 50K URLs (else split)
- All URLs return 200

### Structured data

- Public business pages have `LocalBusiness` schema
- Articles have `Article` schema
- FAQ blocks have `FAQPage` schema

## Output

Markdown report appended to `.claude/memory/seo-snapshots/{date}.md`.

Flags ≥ 5% week-over-week regression as enhance-signal.
