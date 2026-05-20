---
name: db-snapshot
description: Capture metrics baseline · business counts · review counts · score distributions · ad-library entries · cron-run history. Snapshot to .claude/memory/db-snapshots/{date}.md for trend analysis.
---

# /db-snapshot

Captures a structured baseline of the database state so trends can be detected over time (process-enhancer reads these).

## Usage

```
/db-snapshot                # Saves to .claude/memory/db-snapshots/YYYY-MM-DD.md
/db-snapshot --quick        # Skip expensive aggregates
```

## Queries

```sql
-- Business volume
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "isActive") AS active FROM "Business";

-- Score distribution
SELECT
  ROUND("mapslyScore"::numeric, 0) AS score_bucket,
  COUNT(*) AS n
FROM "BusinessSnapshot"
WHERE "snapshotDate" > NOW() - INTERVAL '7 days'
GROUP BY score_bucket
ORDER BY score_bucket;

-- Review velocity
SELECT
  DATE_TRUNC('week', "postedAt") AS week,
  COUNT(*) AS reviews,
  AVG(stars::numeric) AS avg_stars
FROM "Review"
GROUP BY week
ORDER BY week DESC
LIMIT 12;

-- Cron health
SELECT job,
  COUNT(*) FILTER (WHERE status = 'OK') AS ok,
  COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
  SUM("costUsd") AS cost
FROM "CronRun"
WHERE "startedAt" > NOW() - INTERVAL '30 days'
GROUP BY job
ORDER BY failed DESC, cost DESC;

-- Tracker velocity (NEW)
SELECT g.name AS group_name,
  COUNT(*) FILTER (WHERE t.status = 'DONE') AS done,
  COUNT(*) AS total
FROM "Task" t
JOIN "TaskGroup" g ON g.id = t."groupId"
GROUP BY g.id, g.name
ORDER BY g."sortOrder";
```

## Output

Markdown to `.claude/memory/db-snapshots/{date}.md`. Includes:

- Counts (businesses, reviews, lists, leads, agencies)
- Distributions (score buckets, age buckets)
- Cron-run health
- Tracker progress per group
- 7d trend deltas vs the prior snapshot

process-enhancer reads the last 4 snapshots to spot trends.
