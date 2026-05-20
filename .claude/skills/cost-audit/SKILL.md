---
name: cost-audit
description: Last-7d cost breakdown · per-cron · per-vendor · per-business · projection vs budget · top spenders.
---

# /cost-audit

Spawn the `db-analyst` agent with cost-aggregation queries.

## Usage

```
/cost-audit                   # Last 7d
/cost-audit --window=30d
/cost-audit --by=vendor       # Group by external vendor (DataForSEO, Meta, etc.)
/cost-audit --by=cron         # Group by cron job
/cost-audit --top=20          # Top N businesses by cost (premium tier audit)
```

## Queries (via mcp**postgres**query)

```sql
-- Cost by job, last 7 days
SELECT job, SUM("costUsd") AS total, COUNT(*) AS runs, AVG("costUsd") AS avg_cost
FROM "CronRun"
WHERE "startedAt" > NOW() - INTERVAL '7 days'
GROUP BY job
ORDER BY total DESC;

-- Daily trend
SELECT DATE("startedAt") AS day, SUM("costUsd") AS daily_cost
FROM "CronRun"
WHERE "startedAt" > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC;

-- Projection: today's cost × business-count growth factor
SELECT
  (SELECT SUM("costUsd") FROM "CronRun" WHERE DATE("startedAt") = CURRENT_DATE) AS today,
  (SELECT COUNT(*) FROM "Business" WHERE "isActive" = true) AS active_businesses,
  -- ...projection logic
```

## Alerts

- Daily cost > $50 in dev → warn
- Trend up week-over-week > 25% → enhance-signal
- Single job > $20/day → investigate
- Cron costing > 2× its 30d average → investigate

## Output

- Markdown table per dimension
- Top-3 cost optimizations with effort estimate
- Optional: append to enhance-signals.json if regression detected
