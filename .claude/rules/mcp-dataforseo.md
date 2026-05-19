---
description: DataForSEO MCP usage rules. Costs real money — follow discipline.
---

# MCP DataForSEO

`mcp__dataforseo__*` provides keyword research, SERP analysis, Maps SERP, Reviews, Lighthouse. **Every call costs money** — follow these rules.

## Location codes (canonical)
- US: `2840`
- Canada: `2124`
- UK: `2826`
- Australia: `2036`
- Default to US for development; pass explicitly in production.

## Tool categories
- `keyword_suggestions` — expand seed
- `keyword_volume` — search volume + CPC + competition (batch up to 1,000)
- `serp_organic` — top-10 organic results for a keyword
- `serp_local_pack` — Google Maps local pack
- `business_data_business_listings_search` — Maps category search
- `business_data_google_reviews` — review pull (last N reviews)
- `on_page_lighthouse` — Lighthouse audit (mobile)

## Cost discipline

- **Standard queue, not Live.** Standard is 10× cheaper. Live only for daily brand-hijack scan.
- **Batch.** Keyword volume supports 1,000 keywords/call. SERP supports up to 10 per call. Use batch endpoints whenever possible.
- **Cache 24h.** Same input within 24h returns cached.
- **Never inside user request path.** Cron jobs only. The user-facing page reads from DB.
- **Budget before call.** Estimate rows × unit cost. Reject any call > $5 without an explicit allow flag.

## Typical patterns

### Maps category search (build the index)
```ts
mcp__dataforseo__business_data_business_listings_search({
  categories: ['medical_spa'],
  location_coordinate: '25.767,-80.194,5',  // lat,lng,radiusKm
  language_code: 'en',
  limit: 100
})
```

### Keyword volume batch
```ts
mcp__dataforseo__keyword_volume({
  keywords: [/* up to 1000 */],
  location_code: 2840,
  language_code: 'en'
})
```

### Reviews pull
```ts
mcp__dataforseo__business_data_google_reviews({
  cid: '17433310190508824061',  // Google CID
  sort_by: 'newest',
  depth: 20
})
```

### Local pack scan
```ts
mcp__dataforseo__serp_local_pack({
  keyword: 'med spa brickell',
  location_code: 2840,
  language_code: 'en'
})
```

## When to use this MCP vs `services/dataforseo`

- **MCP** = for ad-hoc DB/data investigation, agent research, building reports. Read-only orientation.
- **services/dataforseo** = production runtime adapter, used by cron jobs. Tracks cost in `CronRun`. Cached. Retried.

These are intentionally separate.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 401 Unauthorized | Bad credentials | Check `DATAFORSEO_USERNAME` / `DATAFORSEO_PASSWORD` in `.env.local` |
| 429 Rate limit | Too many concurrent calls | Reduce batch size, add backoff |
| Empty `items` array | Category ID mismatch | Verify category ID — DataForSEO categories ≠ Google categories |
| Stale data | 24h cache hit | Pass `force_refresh: true` only if urgent (counts as new call) |

## Anti-patterns

- ❌ Calling Live for non-time-critical data
- ❌ One call per business in a loop — always batch first
- ❌ Skipping cost tracking on "exploratory" calls
- ❌ Not caching same-input calls
