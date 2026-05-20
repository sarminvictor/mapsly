# Mapsly autonomous build loop · v0.6.6 strict per-iteration prompt

Read by Claude Code's Desktop Scheduled Task → fires every 5 min → executes this file as the prompt for one iteration. Each iteration ships AT MOST one task end-to-end (claim → implement → review → score → auto-merge OR hold) OR exits cleanly with one-line status.

**This prompt is the contract.** Skipping any non-skippable step = the iteration is `INCOMPLETE`, not `SUCCESS`. The next iteration picks up.

---

## STEP 0 · Bootstrap · run from a FUSE-free working directory

The Cowork scheduled task is the canonical scheduler (per INC-22). Cowork sandboxes mount the project via FUSE, which blocks `unlink()` (INC-29). Rather than fight the wall, the loop bootstraps a fresh working copy in `/tmp` (sandbox-writable, unlink works) and runs ALL subsequent steps from there. The FUSE-mounted project directory is touched only to read `.env.local` for secrets.

```bash
# 0a · Detect environment
case "$PWD" in
  */sessions/*|*/mnt/*) IS_SANDBOX=1 ;;
  *) IS_SANDBOX=0 ;;
esac

# 0b · Pick the canonical working directory.
# Sandbox: clone into /tmp. Real macOS: use $PWD directly (mount IS writable).
if [ "$IS_SANDBOX" = "1" ]; then
  WORK_DIR=/tmp/mapsly-work
  MOUNT_DIR="$PWD"

  # Load secrets from the mount before we leave it. The mount's .env.local
  # is readable; we just can't write tracked files there.
  if [ -f "$MOUNT_DIR/.env.local" ]; then
    # Export everything from .env.local. Tolerates quoted/unquoted values.
    set -a
    . "$MOUNT_DIR/.env.local" 2>/dev/null || true
    set +a
  fi

  # Fresh clone (or refresh) on every tick. /tmp doesn't persist between
  # sandbox sessions, so we always assume cold start. Clone is < 1s, cheap.
  if [ ! -d "$WORK_DIR/.git" ]; then
    rm -rf "$WORK_DIR" 2>/dev/null
    AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/sarminvictor/mapsly.git"
    git clone "$AUTH_URL" "$WORK_DIR" 2>&1 | tail -2
  else
    cd "$WORK_DIR"
    git fetch origin main 2>&1 | tail -2
    git reset --hard origin/main 2>&1
    git clean -fd 2>&1
  fi

  cd "$WORK_DIR"
  git config user.email "sarminvictor@gmail.com"
  git config user.name "Viktor"

  echo "[step-0] sandbox bootstrap: WORK_DIR=$WORK_DIR · HEAD=$(git rev-parse --short HEAD)"
else
  # Real macOS: standard hard-sync to origin/main when clean
  WORK_DIR="$PWD"
  if [ -z "$(git status --porcelain 2>/dev/null | head -1)" ]; then
    git fetch origin main 2>/dev/null || true
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [ "$CURRENT_BRANCH" = "main" ] && ! git diff --quiet HEAD origin/main 2>/dev/null; then
      git reset --hard origin/main 2>/dev/null
      git clean -fd 2>/dev/null
    fi
  fi
fi

# 0c · Capability flags (advisory only — never halt the loop).
# In sandbox, /tmp has unlink but limited disk (~1 GB free). pnpm install for
# this project is ~600 MB — too big to install reliably in every tick. So:
# CAN_PNPM_INSTALL=0 in sandbox unless we add a tar-archive caching strategy.
# CAN_DEPLOY_CHECK=0 because deploy-check needs pnpm install + next build.
# Code-ship tasks defer compile/lint/build/test to Vercel CI on push.
if [ "$IS_SANDBOX" = "1" ]; then
  CAN_UNLINK=1                # /tmp unlink works
  CAN_PNPM_INSTALL=0          # /tmp is too small for full install
  CAN_DEPLOY_CHECK=0          # deferred to Vercel CI
  CAN_VERCEL_CI=1             # CI is the validator
else
  CAN_UNLINK=1
  CAN_PNPM_INSTALL=1
  CAN_DEPLOY_CHECK=1
  CAN_VERCEL_CI=1
fi
CAN_GIT_PUSH=1
echo "[step-0] capabilities: UNLINK=$CAN_UNLINK PNPM_INSTALL=$CAN_PNPM_INSTALL DEPLOY_CHECK=$CAN_DEPLOY_CHECK"
```

**Orphan IN_PROGRESS sweep** — recover from any prior iteration that closed without resetting Task.status. Run this AFTER bootstrap so DATABASE_URL is loaded:

```sql
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

**Why this design works for Cowork-only mode:**

- `/tmp` is fully writable; no FUSE wall. Every git operation works normally.
- Clone is ~1s and 4 MB — trivial cost per tick.
- Vercel CI runs the full deploy-check on every push. The loop reads CI verdict via `gh pr checks` or HTTP API and acts on it.
- The 60s extra wall-clock vs local deploy-check is acceptable because ticks run every 5 min anyway.
- The FUSE-mounted project directory at `~/Documents/Claude/Projects/mapsly` is the user's read-only window into what's on `main`. The loop never writes there.

---

## STEP 1 · Honor the loop-lock · capability flags are advisory

Read `.claude/memory/loop-lock.json`.

| state      | cooldownUntil | Action                                                                             |
| ---------- | ------------- | ---------------------------------------------------------------------------------- |
| `paused`   | any           | Exit ≤1 line: `loop paused via dashboard, skipping`. No DB writes, no file writes. |
| `cooldown` | future        | Exit ≤1 line: `cooldown until {time}, skipping`.                                   |
| `cooldown` | past          | Flip to `idle`, proceed                                                            |
| `idle`     | —             | Proceed                                                                            |

Stamp `lastTickAt` = now ISO UTC on EVERY iteration (even skip iterations). The dashboard's "live" indicator depends on this.

**Capability flags from STEP 0 are advisory, not gating.** Per `.claude/rules/capability-routing.md` and INC-30/INC-31, capability gaps narrow validation strategy — they NEVER halt the loop. Both the sandbox (Cowork) and real-macOS (`/loop`) environments run the same code path through STEP 1; the difference is only in STEP 6 where sandbox defers compile/build/test to Vercel CI.

No dashboard Notification is written for capability gaps; the dashboard reads the loop-lock to show which env is currently driving ticks. The user does not need to be alerted.

---

## STEP 2 · Mandatory boot reads

Per `.claude/rules/incident-prevention.md`, read these files first. Skipping any = defect:

1. `.claude/memory/incidents.md` (full file) — apply every documented prevention rule below
2. `CLAUDE.md` — project context, audience rules, hard reminders
3. `PLAN.md` — phase context
4. `.claude/memory/MEMORY.md` — Viktor's preferences
5. `.claude/rules/cache-components.md` — **MANDATORY** if the task touches a Next.js page, route, or `'use cache'` query. The 5 patterns documented there will save you 4-7 round-trip fix commits.

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

Filter for deps-satisfied (all comma-separated `deps` must be DONE).

**Then filter by current capabilities** per `.claude/rules/capability-routing.md`:

- If `CAN_PNPM_INSTALL=0` (Cowork sandbox), exclude any Task whose `tags` contains `requires:pnpm-install` OR `requires:deploy-check`.
- If `CAN_DEPLOY_CHECK=0`, exclude tasks that would need `pnpm typecheck/lint/build` to validate. Code-ship tasks typically need this; pure docs/memory/research tasks do not.
- Tasks with NO `requires:*` tag are treated as env-agnostic (Read/Write/Edit/Bash/Postgres/Agent calls only) and always eligible.

If the eligible queue is empty AFTER capability filtering → exit ≤1 line: `no eligible tasks for current capabilities (CAN_UNLINK={0|1}), idle`. **No cooldown.** The next tick re-probes; a `/loop` tick on the real Mac will see CAN_UNLINK=1 and pick up the same task.

If the eligible queue is empty for DEPENDENCY reasons (everything blocked on incomplete predecessors) → exit ≤1 line: `no eligible tasks, queue empty`. **No cooldown.**

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

1. **Local `pnpm deploy-check`** — gated on `CAN_DEPLOY_CHECK`.
   - **If `CAN_DEPLOY_CHECK=1`** (real macOS): run `pnpm deploy-check` locally. Check exit code; on failure, read output, fix code, retry (counts against STEP 7 retry budget of 6). This is the fastest feedback loop.
   - **If `CAN_DEPLOY_CHECK=0`** (Cowork sandbox): SKIP local deploy-check. Push the branch instead and let Vercel CI run the full validation (format/typecheck/lint/build/tests). Record `validationStrategy.deployCheck = "deferred-to-vercel-ci"` on the TaskRun. This is the canonical pattern for Cowork-only mode (INC-31).

   The "deferred to CI" path is the right pattern when local deploy-check is not feasible (no node_modules, no unlink, no disk space). Vercel runs the same `pnpm deploy-check` script in its build pipeline. The 60s extra wall-clock is acceptable because ticks run every 5 min and CI takes 2-3 min typically.

   For env-agnostic tasks (docs/memory/research/dashboard queries with no compiled code change), deploy-check is N/A — record `validationStrategy.deployCheck = "not-applicable"` with reason.

2. **Unit + integration tests** · run `pnpm test:run` locally. If any pre-existing test fails, fix before proceeding.
3. **Push branch + open PR** if not already done.
4. **Wait for CI + Vercel preview URL** · poll `gh pr view {n} --json statusCheckRollup,deployments` every 15s.
   - If `CAN_DEPLOY_CHECK=0` (Cowork): wait up to 6 min for CI to finish (typecheck/lint/build/tests). Read each check's conclusion. If any check FAILED, read its log via `gh run view`, fix the issue in the working copy, push, and retry (counts against STEP 7 retry budget of 6).
   - Vercel posts a preview comment with `https://*.vercel.app` URL within ~60s of push. THIS is the URL for browser/Lighthouse validation.
   - If CI passes but Vercel preview status is "Building" — wait up to 4 more min for deploy.
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

- **CI red or deploy-check fail** → loop attempts repair IN THIS ITERATION: read failing logs, push fix commits, re-run CI. Repeat up to **6 times** (cacheComponents/prerender errors cascade — one fix often surfaces the next layer; do not give up after 3). If still red after 6 → mark TaskRun `INCOMPLETE`, save `branchName`, next iteration resumes the same branch and continues fixing. Record each attempt's failure mode in `TaskRun.errorMessage` so the resume iteration doesn't re-try the same dead-end.
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

## STEP 10 · Discipline · cooldown only on real failures

**Cooldown is reserved for catastrophic / repeated failures, NEVER for capability gaps:**

- ≥3 consecutive task failures (same task, different runs) → 1h cooldown + INC- entry
- ≥5 consecutive failures across different tasks → 24h cooldown + "loop unhealthy" INC- entry
- Quota approaching (STEP 9) → 4h cooldown
- Rate-limit response from Anthropic API → 4h cooldown
- `CAN_UNLINK=0` is NOT a cooldown trigger. Filter the queue; if empty, exit normally.
- `code-ship task incompatible with current env` is NOT a cooldown trigger. Skip the task, try the next eligible.

The dashboard surfaces capability-degraded mode as an INFO Notification (not WARN), so Viktor knows the loop is running but in narrowed scope. Code tasks queue up until the next `/loop` tick on the Mac picks them up.

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
