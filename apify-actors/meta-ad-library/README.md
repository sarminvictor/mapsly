# Mapsly Meta Ad Library Scraper

Scrapes the **public** Meta (Facebook / Instagram) Ad Library by intercepting the
search page's GraphQL responses with Playwright. This captures **commercial ads**
for any country — including the US/Canada commercial ads that Meta's official
Graph API `ads_archive` endpoint does **not** return outside the EU.

## Why this exists

Meta's official Ad Library API only returns commercial ads that reached the EU
(DSA disclosure). For non-EU regions it returns only social-issue/election/
political ads. A local business (e.g. a Calgary med-spa) running normal promo
ads is therefore invisible to the API but fully visible on the public Ad Library
website — which this actor reads.

## Input

| Field                | Type     | Notes                                                   |
| -------------------- | -------- | ------------------------------------------------------- |
| `searchTerms`        | string[] | Advertiser names / keywords. Provide this or `pageIds`. |
| `pageIds`            | string[] | Exact Facebook Page IDs (most precise).                 |
| `countries`          | string[] | ISO alpha-2, e.g. `["CA"]`. First entry sets proxy geo. |
| `activeStatus`       | enum     | `all` \| `active` \| `inactive`.                        |
| `maxItems`           | int      | Cap per search (default 100, max 1000).                 |
| `delayMs`            | int      | Scroll-step politeness delay (default 2000).            |
| `proxyConfiguration` | object   | Apify proxy; **residential recommended**.               |

## Output (one record per ad)

`id, pageId, pageName, adCreativeBody, linkTitle, linkCaption, linkDescription,
linkUrl, ctaText, displayFormat, imageUrl, videoUrl, snapshotUrl, platforms[],
startDate, endDate, isActive, collationCount, searchTerm, pageQuery, country,
scrapedAt`.

> Spend / impression bands are only published by Meta for political/issue (and
> EU) ads, so they are intentionally not collected here — commercial ad
> intelligence is presence + creative + cadence based.

## Consumed by

`services/apify/meta-ad-library.ts` in the Mapsly app (wrapped in the cost-counter

- KV cache), feeding `AdLibraryEntry` and the SMB `/ads` page.
