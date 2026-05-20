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

**Orphan IN_PROGRESS sweep** — recover from any prior iteration that closed without resetting Task.status:

```sql
-- Reset any Task stuck IN_PROGRESS whose most recent TaskRun is closed
UPDATE "Task" SET status='PENDING', "lastSessionId"=NULL
WHERE status='IN_PROGRESS'
  AND id IN (
    SELECT DISTINCT t.id FROM "Task" t
    JOIN "TaskRun" r ON r."taskId" = t.id
    WHERE t.status='IN_PROGRESS'
      AND NOT EXISTS (
        SELECT 1 FROM "TaskRun" r2
        WHERE r2."taskId" = t.id AND r2.outcome='IN_PROGRESS'
      )
  );
```

If any recovery action prints an error, log it to the supervisor field of TaskRun.errorMessage with the prefix `[sandbox-self-heal]` — but DO NOT abort the iteration. Continue.

**Incidents that auto-recovered are NOT new incidents.** If STEP 0 self-heal succeeded (e.g. INC-14 pattern cleared via `_tmp_*` removal or `git rebase --abort`), write ONE LINE to TaskRun.errorMessage: `[self-heal] INC-14 recurrence auto-mitigated`. Do NOT amend the canonical incidents.md entry. Amendments are reserved for NEW failure modes we haven't seen.

---

## STEP 1 · Honor the loop-lock

Read `.claude/memory/loop-lock.json`.

| state      | cooldownUntil | Action                                                                             |
| ---------- | ------------- | ---------------------------------------------------------------------------------- |
| `paused`   | any           | Exit ≤1 line: `loop paused via dashboard, skipping`. No DB writes, no file writes. |
| `cooldown` | future        | Exit ≤1 line: `cooldown until {time}, skipping`.                                   |
| `cooldown` | past          | Flip to `idle`, proceed                                                            |
| `idle`     | —             | Proceed                                                                            |

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

| Task touches                     | Required agents                          |
| -------------------------------- | ---------------------------------------- |
| Any task                         | `code-reviewer`                          |
| Logic / scoring / cron / webhook | + `test-writer`                          |
| New route or layout              | + `performance-auditor`                  |
| `app/[locale]/(smb)/**`          | + `ux-reviewer-smb`, `copy-reviewer`     |
| `app/[locale]/(agency)/**`       | + `ux-reviewer-agency`, `copy-reviewer`  |
| `app/api/payments/**`            | + `payments-auditor`, `security-auditor` |
| Auth / signin / session          | + `security-auditor`                     |
| User-visible UI                  | + `a11y-reviewer`                        |
| Any commit                       | + `scorer` (LAST, after all above)       |

Cap = 5 concurrent. Sequence rule: `scorer` always runs AFTER every other agent — it reads their verdicts.

Record on TaskRun:

- `agentsUsed`: JSON array of agent names invoked
- `validationStrategy`: JSON of which validation modes ran (see STEP 6)
- `validationOutcomes`: JSON of per-mode pass/fail counts

---

## STEP 6 · MANDATORY validation · NO "deferred to CI" ESCAPE

Every applicable mode MUST run **inside this iteration**, not "deferred." If a mode genuinely cannot run (no UI changes → skip browser; no DB writes → skip db), record `reason` explaining WHY it's N/A. "deferred to CI" / "needs preview URL" / "needs Gmail tab" are NEVER valid reasons.

### Validation order (do in this exact sequence)

1. **`pnpm deploy-check`** locally · ALWAYS. Self-heal any `_tmp_*` orphans from STEP 0 first. If this fails, the iteration is broken — fix or INCOMPLETE.
2. **Unit + integration tests** · run `pnpm test:run` locally. If any pre-existing test fails, fix before proceeding.
3. **Push branch + open PR** if not already done.
4. **Wait for Vercel preview URL** · poll `gh pr view {n} --json statusCheckRollup,deployments` every 15s for up to 4 min. Vercel posts a preview comment with `https://*.vercel.app` URL within ~60s of push. THIS is the URL for browser/email/Lighthouse validation.
5. **Browser validation** via Claude in Chrome MCP against the preview URL:
   - Navigate, screenshot, assert key content, click interactive elements
   - For auth tasks: full magic-link flow including the Gmail tab check (see test-scenarios.md Scenario A)
   - Record screenshot paths + console errors + network 4xx/5xx in `validationOutcomes.browser`
6. **Lighthouse mobile** against preview URL via Claude in Chrome MCP. Record perf, a11y, lcp, cls, inp.
7. **axe-core** a11y check via Chrome MCP. Record violations count + critical ones.
8. **DB validation** via Prisma direct query. SELECT the rows the task touched, assert expected state.
9. **Cleanup test data** per `.claude/rules/browser-testing.md` — every `test+{taskId}@mapsly.ai` user/business created during validation gets deleted.

### Mode applicability cheat-sheet

| Mode          | Required when                                               | Valid skip reasons             |
| ------------- | ----------------------------------------------------------- | ------------------------------ |
| `deployCheck` | ALWAYS                                                      | none                           |
| `unit`        | Pure logic added (scorer, parser, validator, compute fn)    | "no pure logic in this task"   |
| `integration` | Crossed a service boundary (DB, API, webhook, cron handler) | "no service boundary crossed"  |
| `browser`     | Any UI route added/changed                                  | "no UI changes — backend only" |
| `db`          | Any DB write/migrate                                        | "no DB writes from this task"  |
| `email`       | Magic link, transactional, cohort, billing email triggered  | "no email triggered"           |
| `performance` | Route or layout changed                                     | "no route changes"             |
| `a11y`        | UI added/changed                                            | "no UI changes"                |

**ABSOLUTELY INVALID skip reasons** (these will fail the iteration):

- "deferred to CI"
- "needs preview URL" (preview URL is ALWAYS available — see step 4 above)
- "needs Gmail tab" (Claude in Chrome MCP has Gmail access)
- "validation infrastructure not yet built"
- "will validate manually later"

A TaskRun closing with `validationOutcomes` containing ANY of the invalid skip reasons = the iteration is `INCOMPLETE`, not `SUCCESS`. Hard rule.

---

## STEP 7 · Auto-merge gate · DEFAULT TO MERGE

**The loop ships to main. Period.** PRs sitting at `needs-review` are the exception, not the norm. Viktor watches `mapsly.ai` (production) to verify, not per-PR diffs.

Compute the merge decision based on OBJECTIVE signals only:

```
canAutoMerge = (
  CI green on the PR (all required checks passed)
  AND deploy-check passed locally (typecheck + lint + build)
  AND no `code-reviewer` agent returned verdict='REJECT'
  AND no `security-auditor` veto (if invoked)
  AND no `payments-auditor` veto (if invoked)
  AND no new Sentry errors in last 60 min on production
  AND Task.tags does NOT contain 'human-required'
)
```

**The scorer's aggregate is informational** (logged for DORA trends + Plan progress), **not a merge gate.** A 6/10 task that compiles, passes tests, and doesn't break prod ships. We refactor for quality in follow-up tasks.

If `canAutoMerge`:

1. Push branch (if not already pushed)
2. `gh pr merge --auto --squash --delete-branch`
3. Bump `package.json` patch + commit on main
4. Tag if phase boundary crossed (per `.claude/rules/versioning.md`)
5. Write TaskRun: `outcome=SUCCESS`, note `MERGED · CI green · deploy-check pass · score X.X (informational)`
6. Update Task: `status=DONE`, `completedAt=now`

If gate fails:

- **CI red or deploy-check fail** → loop attempts repair IN THIS ITERATION: read failing logs, push fix commits, re-run CI. Repeat up to 3 times. If still red after 3 → mark TaskRun `INCOMPLETE`, save `branchName`, next iteration resumes the same branch and continues fixing.
- **Reviewer hard-reject** (security-auditor / payments-auditor veto only) → label PR `needs-review`, write reviewer's reasoning to TaskRun.notes, do NOT merge. Task.status stays IN_PROGRESS so the next iteration can fix.
- **`human-required` tag on Task** → label PR `needs-review`, do NOT merge. This is the ONLY routine `needs-review` case (e.g. payments cutover, major schema migration that needs manual confirm).

Either way, write the decision to `TaskRun.notes` verbatim:

```
CI=green/red · deploy-check=pass/fail · reviewers={code-reviewer:PASS, security-auditor:N/A, ...} · merge=AUTO|RETRY-N|HOLD-human-required
```

---

## STEP 8 · Close out · NO PARTIAL OUTCOMES

Update TaskRun:

- `outcome`: only TWO valid values for completed iterations:
  - `SUCCESS` — merged to main (the default desired outcome)
  - `INCOMPLETE` — iteration ran out of work/time/quota; next iteration resumes via STEP 3 INCOMPLETE-resume path
  - (`FAILED` reserved for catastrophic errors that prevent retry; rare)
  - **`PARTIAL` is BANNED.** If you find yourself wanting to mark PARTIAL, you actually want INCOMPLETE — the iteration didn't finish, fix in the next tick. If the PR is genuinely human-required (rare), the Task should have been tagged so at creation; the iteration should never have claimed it.
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
- Never surface a sandbox-internal issue (_tmp_\*, .git locks, FUSE unlink) as a Viktor blocker. Use STEP 0 self-heal.
- Blockers are ONLY for things requiring HUMAN action (Stripe identity verification, Meta business verification, etc.) per CLAUDE.md.
- Use Promise.allSettled for parallel agent calls so one slow agent doesn't block the rest.
- If everything is green and quiet at end of iteration, exit with one line — the dashboard reads it.
- Recurring tasks expire after 7 days; if you notice the loop hasn't been recreated and it's >6 days since first tick, write a Notification: "Loop expiry approaching — re-run via Scheduled tasks UI."

---

## Failure modes the loop must handle without surfacing blockers

| Symptom                         | Self-heal                                                     | If self-heal fails                        |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `_tmp_*` orphans block pnpm     | `rm -f _tmp_*` in STEP 0                                      | Mark INCOMPLETE, cooldown 30 min          |
| `.git/index.lock` stale         | STEP 0 `find .git -name '*.lock' -mmin +1 -delete`            | INC-01 relocate `GIT_DIR=/tmp/...`        |
| Mid-rebase from prior iteration | STEP 0 `git rebase --abort`                                   | INC-01 escape hatch                       |
| FUSE unlink wall                | INC-01 escape hatch (relocate .git to /tmp)                   | Mark INCOMPLETE, cooldown 4h              |
| Vercel build failed             | Open PR + label `needs-review` + comment                      | Same — it's a code issue, surfaces via PR |
| Sentry error spike post-merge   | Auto-revert (per `observability.md` §post-merge health check) | Log INC- entry, cooldown 4h               |
| Quota approaching               | STEP 9 quota guard                                            | Same                                      |
| CI never goes green             | After 30 min: mark PR `needs-review`, close iteration         | —                                         |

If the user starts a fresh session and the loop expires, the same Scheduled Task picks up and runs this same prompt. State lives in Postgres + git, not in the session.

**Begin iteration.**
