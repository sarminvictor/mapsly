# Observability · how Mapsly knows what's happening in production

Three pillars: **errors** (Sentry), **traces** (request-scoped correlation IDs), **metrics** (Postgres aggregates + Vercel Analytics). Every error is actionable; every cron run is replay-able; every cost spike is attributable.

## Sentry

### Setup

- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel env
- `@sentry/nextjs` initialized in `instrumentation.ts` + `sentry.client.config.ts` + `sentry.server.config.ts`
- Release identifier = `package.json#version` (auto-bumped on each merge, see `versioning.md`)

### Required tags on every captured event

```ts
Sentry.captureException(err, {
  tags: {
    feature: "smb-reviews", // module owning the code
    audience: "smb" | "agency" | "system",
    cron: "weekly:reviews-full-pull", // if from a cron handler
    taskId: "C.9", // if from autonomous loop
  },
  contexts: {
    cronRun: { id, job, costUsd }, // when applicable
    user: { id, role }, // when authenticated
  },
});
```

### What gets captured · what doesn't

- ✓ Unhandled errors in route handlers, server actions, cron handlers
- ✓ Caught errors at service-adapter boundaries (with `level: "warning"`)
- ✓ Hard halts from the autonomous loop (with full context)
- ✗ Auth `unauthorized()` / `forbidden()` — these are expected, not errors
- ✗ 404s on public pages — Vercel handles separately
- ✗ Rate-limit 429s — these are working-as-intended

### Sentry MCP integration

- `mcp__sentry__*` tools available
- `sentry-monitor` agent reads daily error feed → opens self-improvement PRs when issues cluster
- Dashboard service-health tile shows Sentry connectivity

## Logging

### Structure

Use `console.log` with single-line JSON for parseability:

```ts
console.log(
  JSON.stringify({
    level: "info",
    event: "cron.run.opened",
    job: "weekly:snapshot-write",
    cronRunId,
    ts: new Date().toISOString(),
  }),
);
```

Vercel ingests stdout to its logs UI. For long-term log search, Sentry + their `console.captureBreadcrumb` adds context.

### Correlation IDs

- Every request: `crypto.randomUUID()` in middleware, set as `x-request-id` header, propagate via headers
- Every cron run: `cronRun.id` is the correlation ID
- Every autonomous loop session: `sessionId` (e.g. `SES-2026-05-19-3`)
- Every task run: `taskRunId` cuid()
- All logs include the correlation ID so a request can be reconstructed end-to-end

### What to log · what not to

- ✓ Cron job lifecycle (open / batch-N / close / cost)
- ✓ External API calls (vendor / operation / status / cost / cache-hit)
- ✓ User-significant state changes (subscription_changed, list_created)
- ✗ Every DB read (too noisy)
- ✗ User PII (emails, phone, addresses) — log IDs only
- ✗ Secrets (API keys, tokens, passwords)

## Metrics

### Built-in (no infra needed)

- `CronRun.costUsd` sum by job per day → API cost dashboard tile
- `TaskRun.scoreAggregate` average by week → loop quality trend
- `TaskRun.durationSec` p95 → loop performance trend
- GitHub commits/day → velocity

### Optional Phase 2

- Vercel Speed Insights (free with Pro) for real-user CWV
- PostHog for product funnel events (signup → first-list → first-prospect)

## Alerts

### Sentry alerts

- Error frequency: new issue > 5 events/hour
- Regression: previously-resolved issue re-fires
- Performance: cron handler p95 > 4 min
- Cost: any `CronRun.costUsd > 5` (per `cost-discipline.md` $5 ceiling)

### Loop alerts

- Process-enhancer signals → dashboard "auto-enhance signals" card
- ≥ 3 consecutive task failures → 24h cooldown + "loop unhealthy" incident
- Daily cost trending up week-over-week → enhance-signal

## Post-merge health check (NEW · rollback)

Every successful auto-merge triggers a 10-minute observation window:

1. Capture baseline `error_rate` from Sentry over the prior 60 min
2. Wait 10 min after deploy ready
3. Pull `error_rate` over the 10 min post-deploy
4. If `post_rate > baseline + 2σ` AND `post_rate > 5/min` → auto-revert:
   ```bash
   git revert HEAD --no-edit
   git push origin main
   ```
5. Log INC- with the diff + Sentry issue URL
6. Set loop cooldown 4h to break feedback loop

The autonomous loop runs this check in `app/api/cron/post-deploy-health/route.ts` (Phase H.8, to add).

## Anti-patterns

- ❌ Logging full request bodies (PII leak)
- ❌ Sentry without tags (issues unsortable later)
- ❌ `console.log("err", err)` — use JSON
- ❌ Different correlation ID formats per system
- ❌ Capturing the same error N times across the call chain (use breadcrumbs, not multiple captures)
