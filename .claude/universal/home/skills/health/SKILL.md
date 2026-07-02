---
name: health
description: Morning health digest. Use when the owner asks "how's the app", "morning report", "anything broken?", or on a schedule. Composes cron failures + 7-day cost (postgres MCP) + top Sentry issues (sentry MCP) + git status into one short report.
---

# Health

One screenful, plain English, worst news first. Built for a solo founder with five minutes.

## Steps

1. **Cron failures + cost (postgres MCP).** SELECT-only, always LIMIT. Default table is `"CronRun"` — check the repo's postgres rule for actual names:

   ```sql
   SELECT job, status, "startedAt", "costUsd", "errorMessage"
   FROM "CronRun"
   WHERE "startedAt" > NOW() - INTERVAL '7 days' AND status <> 'OK'
   ORDER BY "startedAt" DESC LIMIT 20;

   SELECT job, SUM("costUsd") AS cost_7d, COUNT(*) AS runs
   FROM "CronRun"
   WHERE "startedAt" > NOW() - INTERVAL '7 days'
   GROUP BY job ORDER BY cost_7d DESC LIMIT 10;
   ```

   Compare totals against `budgets` in `.claude/product-spec.json` when present.

2. **Errors (sentry MCP).** Top unresolved issues, last 24h — title, event count, first/last seen. If `observability.sentry` is false or the MCP is unavailable, say so in one line; don't fail the digest.
3. **Repo state.** `git status --short` + `git log <primaryRemote>/<deployBranch>..HEAD --oneline` — say it in plain words ("2 changes waiting for /ship", "clean, nothing pending").
4. **Compose** in this shape:

   ```
   ## Health · {date}

   🔴 Needs attention: {worst thing, or "nothing"}
   💰 Cost 7d: $X.XX (top: {job} $Y.YY) — {within / over} budget
   🐛 Errors: N unresolved (top: {title} × count)
   📦 Repo: clean / N unpushed changes
   ```

   Every 🔴 item ends with a suggested next action — usually /incident, /rollback, or a one-line fix.

## Scheduling

Runs well as a recurring morning task via the built-in /schedule skill. Keep the scheduled variant strictly read-only — it reports, it never fixes.

## Anti-patterns

- ❌ Mutating queries through the postgres MCP — SELECT only, always LIMIT
- ❌ A wall of tables — one screenful max
- ❌ Burying bad news below good news
- ❌ Failing the whole digest because one source is down — degrade per-section
- ❌ Jargon without translation ("p95 regression" → "pages got slower for the slowest visitors")
