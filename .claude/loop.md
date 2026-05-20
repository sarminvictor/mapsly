# Mapsly autonomous build loop · v0.6.0 strict per-iteration prompt

Read by Claude Code's Desktop Scheduled Task → fires every 5 min → executes this file as the prompt for one iteration. Each iteration ships AT MOST one task end-to-end (claim → implement → review → score → auto-merge OR hold) OR exits cleanly with one-line status.

**This prompt is the contract.** Skipping any non-skippable step = the iteration is `INCOMPLETE`, not `SUCCESS`. The next iteration picks up.

---

## STEP 0 · Sandbox pre-flight (autonomous self-heal · NEVER surface to user)

Before reading anything, recover from common stale states. Per CLAUDE.md Blockers contract, sandbox housekeeping is NEVER a user-facing blocker.

```bash
cd ~/Documents/Claude/Projects/mapsly

# Stale pnpm tmp orphans (cause "Operation not permitted" cascade on next pnpm install)
rm -f _tmp_*_tmp_* _tmp_[0-9]* 2>/dev/null

# Stale .git lock files (only if no active git process)
if ! pgrep -f 'git ' >/dev/null 2>&1; then
  find .git -maxdepth 2 -name '*.lock' -mmin +1 -delete 2>/dev/null
fi

# Stale rebase / merge state from a prior aborted iteration
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  git rebase --abort 2>/dev/null
fi
if [ -f .git/MERGE_HEAD ]; then
  git merge --abort 2>/dev/null
fi

# FUSE unlink wall fallback (INC-01 pattern): relocate .git to /tmp if unlink fails
# Only attempted if a normal git operation reports "Operation not permitted"
```

If any recovery action prints an error, log it to the supervisor field of TaskRun.errorMessage with the prefix `[sandbox-self-heal]` — but DO NOT abort the iteration. Continue.

---

## STEP 1 · Honor the loop-lock

Read `.claude/memory/loop-lock.json`.

| state | cooldownUntil | Action |
|---|---|---|
| `paused` | any | Exit ≤1 line: `loop paused via dashboard, skipping`. No DB writes, no file writes. |
| `cooldown` | future | Exit ≤1 line: `cooldown until {time}, skipping`. |
| `cooldown` | past | Flip to `idle`, proceed |
| `idle` | — | Proceed |

Stamp `lastTickAt` = now ISO UTC on EVERY iteration (even skip iterations) via Edit tool. The dashboard's "live" indicator depends on this.

---

## STEP 2 · Mandatory boot reads

Per `.claude/rules/incident-prevention.md`, read these files first. Skipping any = defect:

1. `.claude/memory/incidents.md` (full file) — apply every documented prevention rule below
2. `CLAUDE.md` — project context, audience rules, hard reminders
3. `PLAN.md` — phase context
4. `.claude/memory/MEMORY.md` — Viktor's preferences

Cache these mentally for this iteration. Do not re-read mid-iteration.

---

## STEP 3 · Claim the next task atomically

Query Postgres (DATABASE_URL from `.env.local`):

```sql
SELECT t.id, t.title, t.priority, t.deps, t."parallelLane", g."name" AS group_name
FROM "Task" t
JOIN "TaskGroup" g ON g.id = t."groupId"
WHERE t.status = 'PENDING'
  AND (t.tags IS NULL OR t.tags NOT LIKE '%human-required%')
ORDER BY t.priority NULLS LAST, g."sortOrder", t."sortOrder", t.id
LIMIT 20;
```

Filter for deps-satisfied (all comma-separated `deps` must be DONE). If none → exit ≤1 line: `no eligible tasks, queue empty`.

**Before claiming**: look for prior INCOMPLETE TaskRun on this task with a `branchName`. If found, this iteration RESUMES that branch (`git checkout branchName`), not start fresh.

Atomic claim:

```sql
UPDATE "Task" SET status='IN_PROGRESS', "startedAt"=now(), "lastSessionId"='{sessionId}'
WHERE id='{taskId}' AND status='PENDING';
```

Verify `rowsAffected == 1`. If 0, race — try next eligible.

Open a fresh TaskRun row (or update the INCOMPLETE one if resuming):

```sql
INSERT INTO "TaskRun" (id, "taskId", "sessionId", outcome, "startedAt", "resumedFromRunId", "branchName")
VALUES ('{newId}', '{taskId}', '{sessionId}', 'IN_PROGRESS', now(), {priorRunId or NULL}, {priorBranch or NULL});
```

---

## STEP 4 · Implement via the autonomous-build-loop skill

Read `.claude/skills/autonomous-build-loop/SKILL.md` and follow its phases:

1. **Research phase** — spawn parallel research agents IN ONE message (Promise.allSettled). Use the orchestrator pattern from CLAUDE.md. Cap = 6 concurrent per `.claude/rules/agent-orchestration.md`. Agents to consider: `competitive-researcher`, `db-analyst`, `integration-specialist`, `signal-engineer`, `Explore`. Skip research for S-size tasks.
2. **Implement phase** — edit files. Honor every rule in `.claude/rules/`.
3. **Review phase** — see STEP 5 below.

Branch naming: `auto/YYYY-MM-DD-{taskId}-{n}` per `git-discipline.md`. Author: `Viktor <sarminvictor@gmail.com>`. Conventional commits.

---

## STEP 5 · MANDATORY review agents (non-skippable)

After implementation, BEFORE touching the PR or scorer, spawn the required review agents in ONE message (parallel). Each writes its verdict to `AgentInvocation` rows on the TaskRun. **Skip = defect against `.claude/rules/agent-orchestration.md`.**

Required by task type (always include code-reviewer; add others per scope):

| Task touches | Required agents |
|---|---|
| Any task | `code-reviewer` |
| Logic / scoring / cron / webhook | + `test-writer` |
| New route or layout | + `performance-auditor` |
| `app/[locale]/(smb)/**` | + `ux-reviewer-smb`, `copy-reviewer` |
| `app/[locale]/(agency)/**` | + `ux-reviewer-agency`, `copy-reviewer` |
| `app/api/payments/**` | + `payments-auditor`, `security-auditor` |
| Auth / signin / session | + `security-auditor` |
| User-visible UI | + `a11y-reviewer` |
| Any commit | + `scorer` (LAST, after all above) |

Cap = 5 concurrent. Sequence rule: `scorer` always runs AFTER every other agent — it reads their verdicts.

Record on TaskRun:
- `agentsUsed`: JSON array of agent names invoked
- `validationStrategy`: JSON of which validation modes ran (see STEP 6)
- `validationOutcomes`: JSON of per-mode pass/fail counts

---

## STEP 6 · MANDATORY validation per `.claude/rules/validation.md`

Pick validation modes by task type (see `.claude/rules/test-scenarios.md` for the 10 playbooks). NEVER skip silently — record `reason` if a mode is genuinely N/A.

For a typical UI task (e.g. B.6 sign-in):

| Mode | Required? | What to record |
|---|---|---|
| Unit tests (Vitest) | If pure logic added | `validationOutcomes.unit: {passed, failed}` |
| Integration tests | If crossed a service boundary | `validationOutcomes.integration: {…}` |
| **Browser validation** via Claude in Chrome MCP | YES for any UI route | `screenshotsUrls`, `validationOutcomes.browser: {status, errors}` |
| **DB validation** via Postgres MCP | YES if writing/reading DB | `validationOutcomes.db: {rowsAsserted}` |
| **Email-flow** via Gmail tab | YES if email triggered (magic link, transactional) | `validationOutcomes.email: {received, subject, clicked}` |
| Lighthouse mobile | YES if route changed | `validationOutcomes.performance: {perf, a11y, lcp, cls, inp}` |
| `axe-core` a11y | YES if UI added | `validationOutcomes.a11y: {violations}` |
| `pnpm deploy-check` | ALWAYS | `validationOutcomes.deployCheck: pass|fail` |

A TaskRun closing with empty `validationOutcomes` = the iteration is `INCOMPLETE`, not `SUCCESS`. Hard rule.

---

## STEP 7 · Auto-merge gate (non-skippable evaluation)

Compute the merge decision EXPLICITLY:

```
canAutoMerge = (
  scorer.aggregate >= 9.0
  AND every scorer cell >= 8.0
  AND CI green on the PR
  AND no new Sentry errors in last 60 min
  AND validationOutcomes.deployCheck == 'pass'
  AND validationOutcomes.browser.errors.length == 0
)
```

Write the decision to `TaskRun.notes`:
```
Score X.X/10 (min cell Y) · CI=green/red · deploy-check=pass/fail · merge=AUTO|HOLD
```

If `canAutoMerge`: `gh pr merge --auto --squash`, bump `package.json` patch, push.
Else: open PR with label `needs-review`, leave for Viktor.

---

## STEP 8 · Close out

Update TaskRun:
- `outcome`: `SUCCESS` (merged) | `PARTIAL` (PR open, awaiting review) | `INCOMPLETE` (quota or step skipped) | `FAILED` (genuine error)
- `finishedAt`: now
- `scoreAggregate`, `score{Completion,Quality,Audience,Relevance,Performance}`: from scorer
- `agentsUsed`, `validationStrategy`, `validationOutcomes`: from STEP 5+6
- `commitSha`, `prNumber`, `prUrl`, `branchName`, `filesChanged`, `linesAdded`, `linesDeleted`, `testsAdded`
- `tokensInput`, `tokensOutput`, `costUsd`, `durationSec`

Update parent Task: `lastRunOutcome` = TaskRun.outcome.

Append ONE LINE to `.claude/memory/build-log.md`:
```
SES-{date}-{slot} · {taskId} · {outcome} · score {agg}/10 · {linesAdded}+/{linesDeleted}- · {ci|no-ci} · {merge|hold}
```

Stamp `loop-lock.lastTickAt` again.

---

## STEP 9 · Quota guard

If during execution you detect approaching usage limit (warning in output, `usage_limit`, 429):

1. Do NOT panic-revert — committed work stays.
2. Mark TaskRun `outcome=INCOMPLETE`, save `branchName`, `finishedAt=now`.
3. Reset Task back to `PENDING`.
4. Set `loop-lock.cooldownUntil = now + 4h`.
5. Exit. Next iteration after cooldown resumes via STEP 3.

---

## STEP 10 · Discipline

- Ship at most ONE task per iteration. Move on next iteration.
- Never surface a sandbox-internal issue (_tmp_*, .git locks, FUSE unlink) as a Viktor blocker. Use STEP 0 self-heal.
- Blockers are ONLY for things requiring HUMAN action (Stripe identity verification, Meta business verification, etc.) per CLAUDE.md.
- Use Promise.allSettled for parallel agent calls so one slow agent doesn't block the rest.
- If everything is green and quiet at end of iteration, exit with one line — the dashboard reads it.
- Recurring tasks expire after 7 days; if you notice the loop hasn't been recreated and it's >6 days since first tick, write a Notification: "Loop expiry approaching — re-run via Scheduled tasks UI."

---

## Failure modes the loop must handle without surfacing blockers

| Symptom | Self-heal | If self-heal fails |
|---|---|---|
| `_tmp_*` orphans block pnpm | `rm -f _tmp_*` in STEP 0 | Mark INCOMPLETE, cooldown 30 min |
| `.git/index.lock` stale | STEP 0 `find .git -name '*.lock' -mmin +1 -delete` | INC-01 relocate `GIT_DIR=/tmp/...` |
| Mid-rebase from prior iteration | STEP 0 `git rebase --abort` | INC-01 escape hatch |
| FUSE unlink wall | INC-01 escape hatch (relocate .git to /tmp) | Mark INCOMPLETE, cooldown 4h |
| Vercel build failed | Open PR + label `needs-review` + comment | Same — it's a code issue, surfaces via PR |
| Sentry error spike post-merge | Auto-revert (per `observability.md` §post-merge health check) | Log INC- entry, cooldown 4h |
| Quota approaching | STEP 9 quota guard | Same |
| CI never goes green | After 30 min: mark PR `needs-review`, close iteration | — |

If the user starts a fresh session and the loop expires, the same Scheduled Task picks up and runs this same prompt. State lives in Postgres + git, not in the session.

**Begin iteration.**
