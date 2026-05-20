# Mapsly autonomous build loop · per-iteration prompt

Read by Claude Code's `/loop` skill — one iteration runs this file as a fresh prompt every 5 minutes (when started as `/loop 5m`) or at a dynamically-chosen interval (when started as bare `/loop`).

Per-iteration checklist. Read CLAUDE.md project context if you haven't already this session. **Mandatory first read:** `.claude/memory/incidents.md` — apply every documented prevention rule.

## 1. Honor the loop-lock

Read `.claude/memory/loop-lock.json`. Possible states:

- `state: "paused"` → exit this iteration in ≤1 line: "loop paused via dashboard, skipping". Don't claim a task. Don't write anything else.
- `state: "cooldown"` AND `cooldownUntil` is future → exit ≤1 line: "cooldown until {time}, skipping".
- `state: "cooldown"` AND `cooldownUntil` ≤ now → flip to `idle`, proceed.
- `state: "idle"` → proceed.

Stamp `lastTickAt` to `now` (UTC ISO) on every iteration regardless of outcome, so the dashboard's "live" indicator works. Use the Edit tool, not Bash.

## 2. Atomically claim one task

Query Postgres (DATABASE_URL from `.env.local`) for the next eligible PENDING task:

```sql
SELECT t.id, t.title, t.priority, t.deps, t."parallelLane", g."name" AS group_name
FROM "Task" t
JOIN "TaskGroup" g ON g.id = t."groupId"
WHERE t.status = 'PENDING'
  AND (t.tags IS NULL OR t.tags NOT LIKE '%human-required%')
ORDER BY t.priority NULLS LAST, g."sortOrder", t."sortOrder", t.id
LIMIT 20;
```

Filter for deps-satisfied (all comma-separated `deps` must be DONE). If none → exit ≤1 line: "no eligible tasks, queue empty". Don't do speculative work.

Claim the first eligible (atomic):

```sql
UPDATE "Task" SET status='IN_PROGRESS', "startedAt"=now(), "lastSessionId"='{sessionId}'
WHERE id='{taskId}' AND status='PENDING';
```

Check `rowsAffected == 1`. If 0, someone else claimed it — try the next eligible.

## 3. Open a TaskRun + check for resume

Before opening a fresh TaskRun, look for a prior INCOMPLETE TaskRun on this task (from a previous quota-exhausted iteration). If one exists with a `branchName`, **resume on that branch** via `git checkout {branch}` — pick up where the prior run left off rather than restart from scratch.

```sql
INSERT INTO "TaskRun" ("taskId", "sessionId", "outcome", "resumedFromRunId", "branchName")
VALUES ('{taskId}', '{sessionId}', 'IN_PROGRESS', {priorRunId or NULL}, {priorBranch or NULL});
```

## 4. Execute the autonomous-build-loop skill

The skill at `.claude/skills/autonomous-build-loop/SKILL.md` defines the full implementation flow: research agents in parallel → implement → review agents in parallel → scorer → conditional auto-merge.

Honor these load-bearing rules:

- `.claude/rules/agent-orchestration.md` — concurrency caps (research ≤6, review ≤5), sequencing, `Promise.allSettled` for parallel research.
- `.claude/rules/validation.md` — per-task validation strategy recorded on the TaskRun.
- `.claude/rules/git-discipline.md` — branch pattern `auto/YYYY-MM-DD-{taskId}-{n}`, author `Viktor <sarminvictor@gmail.com>`, conventional commits.
- `.claude/rules/incident-prevention.md` — every failure surfaces a lesson; log new INC- entries in `.claude/memory/incidents.md`.

## 5. Score + ship-or-hold

Spawn the `scorer` agent. Aggregate ≥ 9.0 AND every cell ≥ 8.0 AND CI green AND no new Sentry errors → auto-merge to main + bump `package.json` patch. Otherwise label the PR `needs-review` and leave for Viktor.

## 6. Close out

Update the TaskRun row with `finishedAt`, `outcome`, `scoreAggregate`, `agentsUsed`, etc. Update the parent Task's `lastRunOutcome`. Append a one-line entry to `.claude/memory/build-log.md`. Stamp `lastTickAt` on loop-lock again.

## 7. Quota guard

If during execution you detect approaching usage limit (warning in output, `usage_limit` field, or rate-limit response):

1. Do NOT panic-revert — whatever you've committed stays.
2. Mark the current TaskRun `outcome=INCOMPLETE`, save `branchName`, set `finishedAt=now`.
3. Reset the Task back to `PENDING` so the next iteration can resume it.
4. Write `loop-lock.cooldownUntil = now + 4h` (Pro Max rolling-5h-window estimate).
5. Exit the iteration cleanly. Next `/loop` tick after cooldown will pick up via §3 resume path.

## 8. Discipline

- Never start a fresh task while one is mid-execution this iteration.
- Never surface a blocker on the dashboard for something doable via API/CLI/MCP — per CLAUDE.md Blockers contract.
- Single iteration ships at most ONE task. Move on next iteration.
- If everything is green and quiet at end of iteration, say so in one line — that's the dynamic-interval signal for Claude to wait longer before the next iteration.

## 9. Restart hygiene · 7-day expiry

`/loop` recurring tasks auto-expire after 7 days (Claude Code limitation). Once a week the session will lose the loop. To detect this, count recent `lastTickAt` updates and if you notice the loop hasn't been recreated and it's >6 days since session start, write a Notification row: "Loop expiry approaching — re-run `/loop 5m` to restart."

If the user starts a fresh session with `/loop 5m` (no prompt), this file is what runs. They don't need to remember the prompt — just the command.
