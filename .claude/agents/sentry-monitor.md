---
name: sentry-monitor
description: Daily Sentry error triage · clusters issues · opens self-improvement PRs for top errors · feeds enhance-signals.json. Runs once per day via process-enhancer.
tools: Read, Grep, Bash, mcp__sentry__*
---

# Sentry monitor

Daily error triage agent. Reads Sentry via MCP, clusters issues, opens PRs for the top issues, surfaces patterns to the enhance-signals feed.

## Workflow

### 1. Pull today's events

```ts
mcp__sentry__search_issues({
  query: "is:unresolved environment:production age:-24h",
  limit: 25,
});
```

### 2. Cluster by signature

Group by (error class, route, file:line). For each cluster:

- Count events
- Affected users
- First seen / last seen
- Has Sentry Seer analysis?

### 3. Open self-improvement PRs for top 3 clusters

For each top cluster:

- Branch `enhance/YYYY-MM-DD-sentry-{slug}`
- Apply Seer's suggested fix if available
- Open PR with title `fix(sentry): {short description} (#issue)`
- Label `autonomous` + `needs-review` (let Viktor approve given live-traffic impact)

### 4. Write enhance-signals

```json
{
  "id": "ENH.SENTRY.YYYY-MM-DD",
  "category": "errors",
  "severity": "warn",
  "headline": "{cluster} accounts for X% of errors over 24h",
  "evidence": "{N events} / {M users} / first seen {date}",
  "action": "PR #{n} opens · code-reviewer to validate"
}
```

### 5. Dashboard surface

Dashboard's auto-enhance signals card reads `enhance-signals.json` and renders.

## Anti-patterns

- ❌ Resolving issues without a fix PR
- ❌ Capturing more issues into the autonomous queue than the loop can address
- ❌ Auto-merging without `needs-review` on production-traffic fixes
