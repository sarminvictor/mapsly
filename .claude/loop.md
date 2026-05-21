# Mapsly autonomous build loop · v0.7.0 strict per-iteration prompt · MECHANICAL ENFORCEMENT

Read by Claude Code's Desktop Scheduled Task → fires every 5 min → executes this file as the prompt for one iteration. Each iteration ships AT MOST one task end-to-end (claim → implement → review → score → auto-merge OR hold) OR exits cleanly with one-line status.

**This prompt is the contract.** Skipping any non-skippable step = the iteration is `INCOMPLETE`, not `SUCCESS`. The next iteration picks up.

---

## STEP 0 · COMPOUND BOOTSTRAP (single bash heredoc · v0.7.0 mechanical enforcement)

**Pro-engineering rule (compound-steps.md):** STEP 0 is exactly ONE `Bash` tool call. The agent does NOT make 17 small bash calls to "probe + GC + toolchain + clone + env + capability flags + counter init". The entire bootstrap runs in one heredoc that outputs structured JSON the agent parses. Subsequent steps follow the same pattern.

Issuing more than one bash call for STEP 0 = defect against `.claude/rules/compound-steps.md`. Banned.

```bash
# === STEP 0 single bash · prints JSON to stdout, exits 0 on success ===
{
  # 0a · detect env
  case "$PWD" in
    */sessions/*|*/mnt/*) IS_SANDBOX=1 ;;
    *) IS_SANDBOX=0 ;;
  esac

  # 0a.1 · /tmp GC (INC-33) — under disk pressure, aggressive sweep
  BEFORE=$(df --output=avail / 2>/dev/null | awk 'NR==2'); BEFORE=${BEFORE:-0}
  find /tmp -maxdepth 1 -name 'mapsly-*' \( -mmin +30 -o -name 'mapsly-git*' -o -name 'mapsly-work-*' -o -name 'mapsly-loop-*' -o -name 'mapsly-commit*' -o -name 'mapsly-scratch*' -o -name 'mapsly-wt-*' -o -name 'mapsly-env-*' -o -name 'mapsly-run-id*' -o -name 'mapsly-session-id*' \) -exec rm -rf {} + 2>/dev/null
  rm -rf /tmp/lock-gen /tmp/prettier-* /tmp/fmt-pkg /tmp/zen-loop /tmp/mw /tmp/db-helper /tmp/pg-cwk /tmp/dbprobe /tmp/fmt /tmp/v0*-edit /tmp/v07*-edit /tmp/audit-rules /tmp/check-* 2>/dev/null
  rm -f /tmp/*.tar.xz /tmp/*.tar.gz /tmp/_probe_* 2>/dev/null
  AVAIL=$(df --output=avail / 2>/dev/null | awk 'NR==2'); AVAIL=${AVAIL:-0}
  if [ "$AVAIL" -lt 1048576 ]; then
    rm -rf /tmp/.pnpm-store /tmp/pnpm-store /tmp/.npm 2>/dev/null
    find /tmp -maxdepth 1 -name 'mapsly-*' ! -name 'mapsly-work' -exec rm -rf {} + 2>/dev/null
    find /tmp -maxdepth 2 -name 'node_modules' -mmin +5 -exec rm -rf {} + 2>/dev/null
  fi
  AVAIL=$(df --output=avail / 2>/dev/null | awk 'NR==2'); AVAIL=${AVAIL:-0}

  # 0a.2 · sticky toolchain (single command -v probe)
  NODE_BIN=/tmp/node24/bin; NPM_GLOBAL=/tmp/npm-global
  if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then
    [ -x "$NODE_BIN/node" ] || {
      ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && NA=arm64 || NA=x64
      cd /tmp && curl -sSLO "https://nodejs.org/download/release/v24.5.0/node-v24.5.0-linux-${NA}.tar.xz" 2>/dev/null
      tar -xJf "node-v24.5.0-linux-${NA}.tar.xz" 2>/dev/null && mv "node-v24.5.0-linux-${NA}" node24 && rm -f "node-v24.5.0-linux-${NA}.tar.xz"
    }
    export PATH="$NODE_BIN:$NPM_GLOBAL/bin:$PATH"
    command -v pnpm >/dev/null 2>&1 || { mkdir -p "$NPM_GLOBAL"; npm install -g pnpm@9.15.0 --prefix "$NPM_GLOBAL" >/dev/null 2>&1; }
    command -v gh   >/dev/null 2>&1 || {
      ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && GA=arm64 || GA=amd64
      cd /tmp && curl -sSLO "https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_${GA}.tar.gz" 2>/dev/null
      tar -xzf "gh_2.63.2_linux_${GA}.tar.gz" 2>/dev/null && cp "gh_2.63.2_linux_${GA}/bin/gh" "$NPM_GLOBAL/bin/" && rm -rf "gh_2.63.2_linux_${GA}.tar.gz" "gh_2.63.2_linux_${GA}"
    }
  fi
  export PATH="$NODE_BIN:$NPM_GLOBAL/bin:$PATH"

  # 0b · pick canonical work dir
  if [ "$IS_SANDBOX" = "1" ]; then
    WORK_DIR=/tmp/mapsly-work
    [ -f "$PWD/.env.local" ] && { set -a; . "$PWD/.env.local" 2>/dev/null; set +a; }
    if [ ! -d "$WORK_DIR/.git" ]; then
      rm -rf "$WORK_DIR" 2>/dev/null
      git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/sarminvictor/mapsly.git" "$WORK_DIR" >/dev/null 2>&1
    else
      cd "$WORK_DIR" && git fetch origin main >/dev/null 2>&1 && git reset --hard origin/main >/dev/null 2>&1 && git clean -fd >/dev/null 2>&1
    fi
    cd "$WORK_DIR"
    git config user.email "sarminvictor@gmail.com" && git config user.name "Viktor"
    set -a; . .env.local 2>/dev/null; set +a   # re-source after clone-refresh
  else
    WORK_DIR="$PWD"; set -a; . .env.local 2>/dev/null; set +a
  fi

  # 0c · capability flags
  if [ "$IS_SANDBOX" = "1" ]; then
    CAN_UNLINK=1; CAN_PNPM_INSTALL=0; CAN_DEPLOY_CHECK=0; CAN_VERCEL_CI=1
  else
    CAN_UNLINK=1; CAN_PNPM_INSTALL=1; CAN_DEPLOY_CHECK=1; CAN_VERCEL_CI=1
  fi

  # 0d · mechanical turn counter file (v0.7.0 · INC-36)
  echo "0" > /tmp/mapsly-turn-counter
  TURN_BUDGET=80

  # 0e · STEP 1 folded in: read loop-lock + orphan sweep
  LOCK=$(cat "$WORK_DIR/.claude/memory/loop-lock.json" 2>/dev/null || echo '{"state":"idle"}')
  HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo none)

  # Output structured JSON the agent parses (one read)
  cat <<EOF
{
  "is_sandbox": ${IS_SANDBOX:-0},
  "work_dir": "${WORK_DIR}",
  "head_sha": "${HEAD_SHA}",
  "disk_free_kb": ${AVAIL:-0},
  "capabilities": {
    "unlink": ${CAN_UNLINK:-0},
    "pnpm_install": ${CAN_PNPM_INSTALL:-0},
    "deploy_check": ${CAN_DEPLOY_CHECK:-0},
    "vercel_ci": ${CAN_VERCEL_CI:-0}
  },
  "turn_budget": ${TURN_BUDGET},
  "loop_lock": ${LOCK}
}
EOF
} 2>&1
# Increment turn counter
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

After this ONE bash call, the agent has every piece of state it needs for STEPS 1, 2, 3 to make decisions — no further probes required.

If the JSON's `loop_lock.state` is `paused` or `cooldown` (future) → exit ≤1 line per the table below. Otherwise proceed to STEP 2.

| state | cooldownUntil | Action |
|---|---|---|
| `paused` | any | Exit ≤1 line: `loop paused via dashboard, skipping`. |
| `cooldown` | future | Exit ≤1 line: `cooldown until {time}, skipping`. |
| `cooldown` | past | Treat as idle, proceed. |
| `idle` | — | Proceed. |

Stamp `lastTickAt` at the END of the iteration (STEP 8), not now.

**Capability flags are advisory** per `.claude/rules/capability-routing.md`. Never halt the loop.

---


## STEP 2 · Bundled boot reads (single bash · v0.7.0)

ONE bash call dumps incidents + CLAUDE.md + PLAN + MEMORY + cache-components rule. Agent parses the section headers; does NOT call Read tool five times.

```bash
{
  for f in .claude/memory/incidents.md CLAUDE.md PLAN.md .claude/memory/MEMORY.md .claude/rules/cache-components.md; do
    echo "===== ${f} ====="
    cat "$f" 2>/dev/null || echo "(missing)"
  done
} | head -c 200000
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

One turn, five files. Banned to issue separate Read calls for these — see `.claude/rules/compound-steps.md`.


## STEP 3 · Atomic SKIP LOCKED claim + TaskRun INSERT in ONE bash call (v0.7.0)

Single bash call: psql with multi-statement transaction. Returns claimed task + INCOMPLETE-resume metadata + Task.contextBundle JSON inline.

```bash
psql "$DATABASE_URL" <<'SQL'
BEGIN;

-- Build capability literal from env
\set caps_literal :requires_pnpm_install_caps  -- shell-injected via -v

WITH eligible AS (
  SELECT t.id
  FROM "Task" t
  JOIN "TaskGroup" g ON g.id = t."groupId"
  WHERE t.status = 'PENDING'
    AND (t.tags IS NULL OR t.tags NOT LIKE '%human-required%')
    -- Capability gate
    AND (t.tags IS NULL OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.tags, ',') tag
      WHERE trim(tag) LIKE 'requires:%'
        AND NOT (trim(tag) = ANY(:'caps_array'::text[]))
    ))
    -- Deps gate
    AND (t.deps IS NULL OR t.deps = '' OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.deps, ',') dep_id
      LEFT JOIN "Task" td ON td.id = trim(dep_id)
      WHERE td.status IS DISTINCT FROM 'DONE'
    ))
  ORDER BY t.priority NULLS LAST, g."sortOrder", t."sortOrder", t.id
  LIMIT 1
  FOR UPDATE OF t SKIP LOCKED
)
UPDATE "Task" t
SET status='IN_PROGRESS', "startedAt"=now(), "lastSessionId"=:'session_id'
FROM eligible
WHERE t.id = eligible.id
RETURNING t.id, t.title, t.priority, t.tags, t.deps, t."parallelLane", t."contextBundle",
  (SELECT json_build_object('runId', r.id, 'branchName', r."branchName")
   FROM "TaskRun" r WHERE r."taskId" = t.id AND r.outcome = 'INCOMPLETE'
   ORDER BY r."startedAt" DESC LIMIT 1) AS resume;

INSERT INTO "TaskRun" (id, "taskId", "sessionId", outcome, "startedAt", "resumedFromRunId", "branchName")
SELECT :'run_id', t.id, :'session_id', 'IN_PROGRESS', now(),
  (resume->>'runId')::text, (resume->>'branchName')::text
FROM (SELECT id, NULL::json AS resume FROM "Task" WHERE id = :'task_id') t;

COMMIT;
SQL
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

**ONE turn for STEP 3.** Returns task row + contextBundle inline. If 0 rows → exit ≤1 line `no eligible tasks, idle`. No cooldown.

If `contextBundle` is non-null, the agent uses it directly in STEP 4 (no separate exploration). If null (legacy tasks not yet auto-populated), STEP 4 invokes one `Agent(Explore)` to derive context — see STEP 4.


## STEP 4 · Implementation · MANDATORY Agent-first when no contextBundle (v0.7.0)

**Force-function rule (compound-steps.md):** If `Task.contextBundle` is null, the FIRST tool call of STEP 4 MUST be `Agent(subagent_type="Explore", ...)`. Any Read/Grep/Bash issued before that = defect → mark TaskRun INCOMPLETE + exit.

The Explore subagent has its own turn budget; its work counts as ONE turn in the parent session. This saves ~20 turns vs serial Read/Grep exploration in the main session.

```
Agent({
  description: "Investigate {Task.id} context",
  subagent_type: "Explore",
  prompt: `Find: (1) files relevant to "${Task.title}", (2) existing patterns I should follow,
           (3) files to modify vs files to create new, (4) tests I should mirror.
           Output under 600 words. Cite paths absolute from repo root.`
})
```

After the Explore agent returns, the parent session writes files via Write/Edit. **DO NOT verify writes via `wc -l`, `ls -la`, or `cat` of the file just written** — per `.claude/rules/no-verify.md`. The Write tool throws on failure; trust it.

**Templated branch + commit names (v0.7.0):**

```bash
BRANCH="auto/$(date +%Y-%m-%d)-${TASK_ID}-1"
COMMIT_TITLE="feat(${TASK_LANE}): ${TASK_ID} · ${TASK_TITLE:0:60}"
git checkout -b "$BRANCH" 2>&1
```

No decision turns wasted on naming.

Increment turn counter: `echo $(( $(cat /tmp/mapsly-turn-counter) + N )) > /tmp/mapsly-turn-counter` where N = number of Write+Edit calls.


## STEP 5 · MANDATORY review agents · ONE message · ALL parallel (v0.7.0)

All required review agents are spawned in ONE assistant message containing ALL `Agent` tool-use blocks. Splitting across messages = defect against `.claude/rules/compound-steps.md`.

Required agents by task type — pick the applicable set, dispatch in ONE message:

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

Cap = 5 concurrent per `.claude/rules/agent-orchestration.md`. The `scorer` agent runs AFTER all others (read their verdicts) — second batch, 1 turn.

```
# ONE message · all parallel
Agent({ name: "code-reviewer", ... })
Agent({ name: "test-writer", ... })
Agent({ name: "performance-auditor", ... })
Agent({ name: "ux-reviewer-smb", ... })
Agent({ name: "copy-reviewer", ... })
# All 5 run in parallel → 1 parent turn for the spawn

# Wait for all to return, then:
Agent({ name: "scorer", inputs: [code-reviewer verdict, test-writer verdict, ...] })
# 1 more parent turn
```

**Total STEP 5: 2 turns.** Was 5–10 in pre-v0.7.0.

Increment counter: `echo $(( $(cat /tmp/mapsly-turn-counter) + 2 )) > /tmp/mapsly-turn-counter`.


## STEP 6 · Validation · compound CI + browser_batch (v0.7.0)

### Step 6a · Push + open PR (single bash)

```bash
git push -u origin "$BRANCH" 2>&1
PR_URL=$(gh pr create --fill --label autonomous 2>&1 | tail -1)
PR=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo "$PR" > /tmp/mapsly-pr-number
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

One turn, push + PR open.

### Step 6b · Exponential backoff CI poll (single bash loop)

```bash
PR=$(cat /tmp/mapsly-pr-number)
for d in 15 30 60 120 240; do
  sleep $d
  RES=$(gh pr view "$PR" --json statusCheckRollup,deployments 2>&1)
  if echo "$RES" | grep -q '"conclusion":"FAILURE"\|"conclusion":"CANCELLED"\|"conclusion":"TIMED_OUT"'; then
    echo "ci_failed"; break
  fi
  if echo "$RES" | grep -q '"conclusion":"SUCCESS"' && ! echo "$RES" | grep -q '"conclusion":null'; then
    echo "ci_green"; break
  fi
done > /tmp/mapsly-ci-status
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

One turn for the entire 7-minute poll envelope (the sleeps happen inside the one bash call; agent doesn't wake between sleeps).

**On `ci_failed`:** mark TaskRun INCOMPLETE + save branch + exit. Same-session retries BANNED (`.claude/rules/loop-discipline.md`).

### Step 6c · Browser validation · ONE Chrome MCP browser_batch

Single `mcp__Claude_in_Chrome__browser_batch` call that:
1. Opens Vercel preview URL
2. Asserts hero content + key interactive selectors
3. Runs Lighthouse mobile preset
4. Runs axe-core a11y check
5. Returns combined verdict JSON

ONE turn for all browser validation. **Banned to call navigate / find / read_page / Lighthouse / axe-core as separate tool invocations** when a batch is available.

If browser_batch is not available in the current MCP set, fall back to a sequence of 3 Chrome MCP calls — but never more than 3 total for STEP 6c.

### Step 6d · DB validation (single psql)

```bash
psql "$DATABASE_URL" <<'SQL'
SELECT count(*), array_agg(id) FROM "TaskRun" WHERE "taskId" = :'task_id' AND outcome = 'IN_PROGRESS';
-- + any task-specific assertions
SQL
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

**Total STEP 6: 4 turns** (6a push, 6b CI poll, 6c browser_batch, 6d DB). Was 15–30 in pre-v0.7.0.


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

- **CI red or deploy-check fail** → loop attempts repair IN THIS ITERATION: read failing logs, push fix commits, re-run CI. **Same-session retries banned in v0.6.42** (see INC-35). On CI red, mark INCOMPLETE + save branch + exit; the next iteration resumes via STEP 3 INCOMPLETE-resume path and continues fixing across-tick. If red on attempt 1 → mark TaskRun `INCOMPLETE` (v0.6.42: same-session retries are banned, see INC-35), save `branchName`, next iteration resumes the same branch and continues fixing. Record each attempt's failure mode in `TaskRun.errorMessage` so the resume iteration doesn't re-try the same dead-end.
- **Reviewer hard-reject** (security-auditor / payments-auditor veto only) → label PR `needs-review`, write reviewer's reasoning to TaskRun.notes, do NOT merge. Task.status stays IN_PROGRESS so the next iteration can fix.
- **`human-required` tag on Task** → label PR `needs-review`, do NOT merge. This is the ONLY routine `needs-review` case (e.g. payments cutover, major schema migration that needs manual confirm).

Either way, write the decision to `TaskRun.notes` verbatim:

```
CI=green/red · deploy-check=pass/fail · reviewers={code-reviewer:PASS, security-auditor:N/A, ...} · merge=AUTO|RETRY-N|HOLD-human-required
```

---

## STEP 8 · Compound close-out (single bash · v0.7.0)

ONE bash heredoc does: Postgres transaction (TaskRun + Task + Notification resolve) + build-log append + loop-lock stamp.

```bash
{
  psql "$DATABASE_URL" <<SQL
BEGIN;
UPDATE "TaskRun" SET outcome=:'outcome', "finishedAt"=now(),
  "commitSha"=:'sha', "prNumber"=${PR}, "prUrl"=:'pr_url', "branchName"=:'branch',
  "filesChanged"=:'files', "linesAdded"=${LINES_ADD}, "linesDeleted"=${LINES_DEL},
  "scoreAggregate"=${SCORE}, "agentsUsed"=:'agents',
  "tokensInput"=${TOK_IN}, "tokensOutput"=${TOK_OUT}, "costUsd"=${COST}, "durationSec"=${DURATION}
WHERE id=:'run_id';

UPDATE "Task" SET
  status=CASE WHEN :'outcome' = 'SUCCESS' THEN 'DONE' ELSE status END,
  "completedAt"=CASE WHEN :'outcome' = 'SUCCESS' THEN now() ELSE "completedAt" END,
  "lastRunOutcome"=:'outcome', "lastPrNumber"=${PR}, "lastPrUrl"=:'pr_url',
  "lastCommitSha"=:'sha', "scoreAvg"=${SCORE}
WHERE id=:'task_id';

UPDATE "Notification" SET "resolvedAt"=now()
WHERE :'outcome' = 'SUCCESS' AND "resolvedAt" IS NULL AND level='WARN'
  AND (title ILIKE '%loop stalled%' OR title ILIKE '%switch to /loop%'
       OR title ILIKE '%cowork sandbox cannot install%' OR title ILIKE '%fuse wall%'
       OR title ILIKE '%loop in degraded mode%');
COMMIT;
SQL

  # Append build-log
  echo "SES-$(date +%Y-%m-%d)-$$ · ${TASK_ID} · ${OUTCOME} · score ${SCORE}/10 · ${LINES_ADD}+/${LINES_DEL}- · ${CI_STATUS} · ${MERGE_STATUS}" >> .claude/memory/build-log.md

  # Stamp loop-lock
  cat > .claude/memory/loop-lock.json <<EOF
{
  "state": "idle",
  "sessionId": null,
  "lastTickAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cooldownUntil": null,
  "consecutiveFailures": 0,
  "note": "SES-$$ · ${TASK_ID} · ${OUTCOME}"
}
EOF
} 2>&1
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

**Total STEP 8: 1 turn.** Was 5–10 in pre-v0.7.0.


## STEP 9 · Quota guard

If during execution you detect approaching usage limit (warning in output, `usage_limit`, 429):

1. Do NOT panic-revert — committed work stays.
2. Mark TaskRun `outcome=INCOMPLETE`, save `branchName`, `finishedAt=now`.
3. Reset Task back to `PENDING`.
4. Set `loop-lock.cooldownUntil = now + 4h`.
5. Exit. Next iteration after cooldown resumes via STEP 3.

---

## STEP 10 · Discipline · MECHANICAL turn budget + cooldown only on real failures

**Mechanical turn-budget enforcement (v0.7.0 · INC-36):**

The turn counter lives in `/tmp/mapsly-turn-counter`. Every bash call ends with:
```bash
echo $(( $(cat /tmp/mapsly-turn-counter) + 1 )) > /tmp/mapsly-turn-counter
```

At every step boundary (between STEPs), the agent checks:
```bash
TURNS=$(cat /tmp/mapsly-turn-counter)
[ "$TURNS" -ge 80 ] && exec_graceful_incomplete
```

`exec_graceful_incomplete` runs the STEP 8 close-out with `outcome=INCOMPLETE`, branch preserved, Task reset to PENDING, exits ≤1 line.

**This is not prose. The bash file IS the budget.** Agent doesn't need to "remember" — the counter is on disk, queryable any time.

**Compound-steps rule (`.claude/rules/compound-steps.md` · NEW):**

- STEP 0: ONE bash heredoc — boot + GC + toolchain + clone + capability + counter + STEP 1 fold
- STEP 2: ONE bash heredoc — bundled boot reads
- STEP 3: ONE bash heredoc — psql with CTE + INSERT in transaction
- STEP 4 if contextBundle=null: ONE Agent(Explore) call BEFORE any Read/Grep/Bash
- STEP 5: ONE message with ALL parallel review-agent dispatches
- STEP 6c: ONE Chrome MCP browser_batch (or ≤3 calls if no batch)
- STEP 8: ONE bash heredoc — transaction + build-log + loop-lock

Issuing N separate tool calls where 1 compound call would do = defect → INC- entry + the loop-discipline.md retry log.

**No-verify rule (`.claude/rules/no-verify.md` · NEW):**

After Write/Edit, do NOT run `wc -l`, `ls -la`, `cat`, or `find` to "make sure it worked". Write throws on failure; trust it. Verification calls are the #1 source of avoidable turn waste (~5–10 per task in pre-v0.7.0).

**Cooldown is reserved for catastrophic / repeated failures, NEVER for capability gaps:**
- ≥3 consecutive failures of the SAME task → 1h + INC- entry
- ≥5 consecutive failures across DIFFERENT tasks → 24h + "loop unhealthy" INC-
- Quota / rate-limit approaching → 4h
- Anthropic 429 → 4h
- Capability gap → NEVER cooldown
- Eligible queue empty (deps or capability) → NEVER cooldown
- TURN_USED >= 80 → INCOMPLETE + resume next tick, NOT cooldown

- Ship at most ONE task per iteration. Move on next iteration.
- Never surface a sandbox-internal issue (_tmp_*, .git locks, FUSE unlink) as a Viktor blocker.
- Use Promise.allSettled for parallel agent calls so one slow agent doesn't block the rest.
- If everything is green and quiet at end of iteration, exit with one line — the dashboard reads it.

---

## Failure modes the loop must handle without surfacing blockers

| Symptom | Self-heal | If self-heal fails |
|---|---|---|
| `_tmp_*` orphans block pnpm | STEP 0a.1 GC | Mark INCOMPLETE, cooldown 30 min |
| `.git/index.lock` stale | STEP 0 `find -mmin +1 -delete` | INC-01 escape hatch via `GIT_DIR=/tmp/...` |
| Mid-rebase from prior iteration | STEP 0 `git rebase --abort` | INC-01 escape hatch |
| FUSE unlink wall | STEP 0 ignores mount, works in /tmp | Mark INCOMPLETE, cooldown 4h |
| Vercel build failed | Mark INCOMPLETE on CI red, next tick resumes | – |
| Sentry error spike post-merge | Auto-revert per observability.md | Log INC-, cooldown 4h |
| Quota approaching | STEP 9 quota guard | Same |
| CI never goes green | Mark INCOMPLETE; next tick resumes | – |
| TURN_USED >= 80 | STEP 10 mechanical exit to INCOMPLETE | – |

**Begin iteration.**
