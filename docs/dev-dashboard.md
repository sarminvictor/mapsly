# dev.mapsly.ai · the build status dashboard

A single public no-auth page that shows the autonomous loop's health 24/7. Mockup in `_design/dev/index.html`.

## What it shows

1. **Hero KPIs** — sessions last 7d, phases shipped, avg quality score, current-session token budget, API spend today, open PRs needing review
2. **Session timeline** — 7-day × 4-sessions-per-day heatmap (green/amber/red/idle)
3. **Currently working on** — live phase ID, what step, ETA
4. **Context usage this session** — token budget bar
5. **Open PRs needing review** — gates failed, why
6. **PLAN.md progress** — task list with status pills + scores
7. **Recently shipped** — last 5 auto-merges with score
8. **Recent scorecards** — 5-dim grid for last 8 phases
9. **MCP + API health** — connection status + latency + spend
10. **Failures + warnings** — recent fails with recovery action
11. **Auto-enhance signals** — what process-enhancer detected
12. **Live commits** — last 6 commits to main

## How it gets built

### Subdomain routing

`dev.mapsly.ai` and `mapsly.ai` are the same Vercel project. We discriminate by `Host` header in `middleware.ts`:

```ts
// middleware.ts (additive — runs after next-intl middleware)
export default async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = req.headers.get('host') ?? '';

  // Route dev.mapsly.ai to /dev internally
  if (host.startsWith('dev.') && !url.pathname.startsWith('/dev')) {
    url.pathname = `/dev${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  // Hide /dev from main domain
  if (!host.startsWith('dev.') && url.pathname.startsWith('/dev')) {
    return new NextResponse('Not found', { status: 404 });
  }

  return intlMiddleware(req);
}
```

Vercel:
- Add `dev.mapsly.ai` as a domain alias on the project
- Same deployment serves both
- No separate build

### Page location

```
app/(dev)/
  dev/
    page.tsx         ← the dashboard (server component)
    queries.ts       ← data aggregation
    components/
      hero-tiles.tsx
      session-timeline.tsx
      plan-progress.tsx
      mcp-health.tsx
      scorecard-grid.tsx
      failure-feed.tsx
      enhance-signals.tsx
      commits-feed.tsx
```

The `(dev)` route group keeps it out of the main app navigation.

### Data sources

All data lives in places Claude already writes during the autonomous loop:

| Section | Source |
|---|---|
| Sessions timeline | `.claude/memory/sessions/{date}-{n}.json` files |
| Current session | parse the latest non-finalized session file |
| PLAN.md progress | parse `PLAN.md` (`gray-matter` or simple regex on the task tables) |
| Scorecards | parse PLAN.md `*.score` rows |
| Recent merges | GitHub API (`GET /repos/{owner}/{repo}/commits`) with our `GITHUB_TOKEN` |
| MCP health | live ping each MCP, cache 60s in KV |
| API spend today | aggregate `CronRun.costUsd` from Postgres |
| Failures | parse `.claude/memory/build-log.md` + recent FAILED CronRuns |
| Auto-enhance signals | `.claude/memory/enhance-signals.json` (process-enhancer writes this) |
| Commits feed | GitHub API |

Everything cached with `'use cache'` + `cacheLife('seconds')` so the page is fast but ~live.

### Cache strategy

```ts
// app/(dev)/dev/queries.ts
'use cache'
import { cacheLife, cacheTag } from 'next/cache';

export async function getDashboardData() {
  cacheLife('seconds');  // 10s freshness
  cacheTag('dev-dashboard');

  const [sessions, planProgress, mergedPRs, mcpHealth, apiSpend, failures, signals, commits] =
    await Promise.all([
      getRecentSessions(7),
      parsePlanMd(),
      getRecentMerges(10),
      pingAllMcps(),
      getDailyApiSpend(),
      getRecentFailures(10),
      getEnhanceSignals(),
      getRecentCommits(10),
    ]);

  return { sessions, planProgress, mergedPRs, mcpHealth, apiSpend, failures, signals, commits };
}
```

Plus a server action `/api/dev/refresh` that calls `revalidateTag('dev-dashboard')` — the page itself triggers this every 15s via a client-side `setInterval` so the user sees fresh data without manual reload.

### Auto-refresh pattern

```tsx
'use client'
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const i = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(i);
  }, [router, intervalMs]);
  return null;
}
```

Embed in `app/(dev)/dev/page.tsx`. Calls `router.refresh()` which re-runs the server component with the latest cache.

### Public, no auth

The route group `(dev)` has its own `layout.tsx` that doesn't call `auth()`. The `middleware.ts` rewrite happens before any auth check.

Treat the dashboard as **internal but public**:
- No PII shown (no user emails, no payment info)
- No mutation endpoints (read-only)
- No links into authenticated areas (sign-in is hidden)
- Headers: `X-Robots-Tag: noindex, nofollow` so search engines don't index it

### Data the orchestrator reads

`process-enhancer` agent reads the same data sources (not the rendered HTML) to detect patterns:

1. Parse `.claude/memory/sessions/*.json` for trends
2. Parse `CronRun` table for cost trends
3. Parse PLAN.md scores for dimension trends
4. Parse GitHub PR history for auto-merge gate failures
5. Parse Sentry MCP for error clusters

When it spots a pattern, it writes to `.claude/memory/enhance-signals.json`:

```json
[
  {
    "id": "ENH.2026-05-19.dataforseo-monday-batch",
    "category": "cadence",
    "detected": "2026-05-19T12:30:00Z",
    "severity": "warn",
    "headline": "DataForSEO p95 latency clusters Mon 9–11 UTC · 3× higher than baseline",
    "evidence": "last 4 Mondays · p95 = 2.1s vs baseline 680ms",
    "action": "propose batch-size 100 (not 200) on Monday cron runs",
    "prDrafted": true,
    "prUrl": "https://github.com/sarminvictor/mapsly/pull/49"
  }
]
```

The dashboard reads this and renders the "Auto-enhance signals" card.

### Failure recovery flow visible on the dashboard

When something fails:

1. Cron handler catches the error → closes `CronRun` with status FAILED + error
2. Autonomous loop's next session reads `CronRun` table → sees the FAILED run
3. Loop's first action: investigate. Reads error, decides if reproducible.
4. Opens a fix-it task or follow-up in PLAN.md
5. Process-enhancer reviews recurring failures → opens .claude/rules PR if pattern is systemic

All of this is shown on the dashboard's "Failures" card.

## Phase 1.10 · in PLAN.md

This dashboard lands as a PLAN.md phase. Suggested split:

| ID | Task | Effort |
|---|---|---|
| 1.10.1 | Subdomain routing — middleware.ts dev rewrite + Vercel domain config | S |
| 1.10.2 | `app/(dev)/dev/page.tsx` layout · grid · hero tiles · all sections rendered with mock data | M |
| 1.10.3 | Real data sources — parse PLAN.md, session JSON, GitHub API, CronRun | M |
| 1.10.4 | Auto-refresh via `revalidateTag` + `router.refresh()` | S |
| 1.10.5 | MCP health ping + cache · KV-backed | S |
| 1.10.6 | Auto-enhance signals · render from `.claude/memory/enhance-signals.json` | S |
| 1.10.7 | Process-enhancer agent · detects patterns · writes signals · opens PRs | M |

Total ~6h of work. The mockup is the spec.

## Self-monitoring loop

Once the dashboard is live, the orchestrator reads it (via the data sources, not the HTML):

- At session start: if the last 3 sessions had fails or amber signals, address them first (not pick a new feature)
- On every quality-gate fail: write to enhance-signals so future sessions know
- On every successful merge: write to sessions JSON so the dashboard reflects it

This turns the dashboard from a passive view into a **closed feedback loop**:
1. Autonomous loop writes data
2. Dashboard renders data
3. Process-enhancer reads data, finds patterns
4. Process-enhancer opens PRs to refine the rules
5. Next autonomous loop reads the refined rules
6. Better outputs → better data → smarter signals → tighter rules

That's the auto-enhance system.

## Anti-patterns

- ❌ Hardcoding data on the dashboard — must always come from real sources
- ❌ Auto-refresh polling more often than 10s (KV gets hot, hits free-tier limits)
- ❌ Exposing PII on the public route
- ❌ Allowing mutations from the dev route (read-only always)
- ❌ Breaking the dashboard with PLAN.md format changes — parser must be tolerant
