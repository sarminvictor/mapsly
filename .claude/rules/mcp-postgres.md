---
description: Mapsly Postgres MCP usage. SQL table names (not Prisma model names).
---

# MCP Postgres

When using `mcp__postgres__query`, use the actual SQL table names, not Prisma model names:

| Prisma model | SQL table | Key columns |
|---|---|---|
| `Business` | `Business` | `"isClaimed"`, `"isActive"`, `rating`, `"reviewCount"`, `category`, `city` |
| `BusinessSnapshot` | `BusinessSnapshot` | `"mapslyScore"`, `"msiRank"`, `"snapshotDate"` |
| `Review` | `Review` | `stars`, `"ownerReplied"`, `"postedAt"`, `sentiment` |
| `LighthouseAudit` | `LighthouseAudit` | `performance`, `seo`, `lcp`, `cls`, `"auditedAt"` |
| `AdLibraryEntry` | `AdLibraryEntry` | `platform`, `"isActive"`, `"matchedKeyword"` |
| `SerpResult` | `SerpResult` | `"localPackRank"`, `"organicRank"`, `"scannedAt"` |
| `Keyword` | `Keyword` | `keyword`, `"searchVolume"`, `cpc` |
| `Lead` | `Lead` | `status`, `"matchScore"`, `"contactedAt"` |
| `List` | `List` | `"serviceType"`, `"agencyId"`, `"isActive"` |
| `Agency` | `Agency` | `plan`, `slug` |
| `AgencyMember` | `AgencyMember` | `role`, `"agencyId"`, `"userId"` |
| `User` | `User` | `email`, `role`, `"createdAt"` |
| `CronRun` | `CronRun` | `job`, `status`, `"costUsd"`, `"startedAt"` |

## Column rules

- camelCase columns need double quotes in SQL: `"isClaimed"`, `"reviewCount"`, `"costUsd"`
- Simple lowercase columns don't need quotes: `category`, `city`, `status`, `slug`
- If a query fails with "column not found", discover:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'TableName';
  ```
- **Always `SELECT` only — never mutating queries through the MCP.**
- **Always include `LIMIT`** — never unbounded.

## Useful queries

### Top-cost cron jobs last 7 days
```sql
SELECT job, SUM("costUsd") AS total_cost, COUNT(*) AS runs
FROM "CronRun"
WHERE "startedAt" > NOW() - INTERVAL '7 days'
GROUP BY job
ORDER BY total_cost DESC
LIMIT 20;
```

### Recent Mapsly Score changes
```sql
SELECT b.name, b.city,
  s1."mapslyScore" - s2."mapslyScore" AS delta,
  s1."mapslyScore" AS current
FROM "Business" b
JOIN "BusinessSnapshot" s1 ON s1."businessId" = b.id
LEFT JOIN "BusinessSnapshot" s2 ON s2."businessId" = b.id
WHERE s1."snapshotDate" = (SELECT MAX("snapshotDate") FROM "BusinessSnapshot" WHERE "businessId" = b.id)
  AND s2."snapshotDate" = (SELECT MAX("snapshotDate") FROM "BusinessSnapshot" WHERE "businessId" = b.id AND "snapshotDate" < s1."snapshotDate")
ORDER BY delta DESC
LIMIT 25;
```

### Lists by reply rate
```sql
SELECT
  l.name,
  COUNT(le.id) AS total,
  SUM(CASE WHEN le.status = 'CONTACTED' THEN 1 ELSE 0 END) AS contacted,
  SUM(CASE WHEN le.status = 'REPLIED' THEN 1 ELSE 0 END) AS replied,
  SUM(CASE WHEN le.status = 'WON' THEN 1 ELSE 0 END) AS won
FROM "List" l
LEFT JOIN "Lead" le ON le."listId" = l.id
GROUP BY l.id, l.name
ORDER BY won DESC
LIMIT 20;
```
