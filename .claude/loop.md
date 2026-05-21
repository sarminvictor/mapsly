# Mapsly autonomous build loop · v0.7.4 · PARENT-DELEGATES-EVERYTHING

> **Architecture · option B.** Parent session does ~11 turns of orchestration. Heavy work delegated to `loop-implementer` + `loop-validator` subagents (each with its OWN 100-turn budget per [Anthropic docs](https://platform.claude.com/docs/en/agent-sdk/subagents): _"Each subagent runs in its own fresh conversation. Intermediate tool calls and results stay inside the subagent; only its final message returns to the parent."_). Review agents (code-reviewer, test-writer, scorer, etc.) all spawn from the parent in ONE message, each with their own fresh session. The Claude Code 100-turn cap on the parent is no longer a constraint because parent's tool calls cap at ~11.

Read by the Cowork desktop scheduled task → fires every 5 min → executes this file as the prompt for one iteration. Each iteration ships AT MOST one task end-to-end (claim → delegate-implement → spawn-reviewers → push → wait-CI → delegate-validate → auto-merge OR hold-INCOMPLETE) OR exits cleanly with one-line status.

**This prompt is the contract.** Skipping any non-skippable step = the iteration is `INCOMPLETE`, not `SUCCESS`. The next iteration picks up.

---

## STEP 0 · COMPOUND BOOTSTRAP · ONE bash heredoc

Per `.claude/rules/compound-steps.md`, STEP 0 is exactly ONE `Bash` tool call. Outputs structured JSON the parent parses.

```bash
{
  case "$PWD" in
    */sessions/*|*/mnt/*) IS_SANDBOX=1 ;;
    *) IS_SANDBOX=0 ;;
  esac

  # /tmp GC (INC-33, INC-34): standard sweep + disk-pressure aggressive sweep
  BEFORE=$(df --output=avail / 2>/dev/null | awk 'NR==2'); BEFORE=${BEFORE:-0}
  find /tmp -maxdepth 1 -name 'mapsly-*' \( -mmin +30 -o -name 'mapsly-git*' -o -name 'mapsly-work-*' -o -name 'mapsly-loop-*' -o -name 'mapsly-commit*' -o -name 'mapsly-scratch*' -o -name 'mapsly-wt-*' -o -name 'mapsly-env-*' -o -name 'mapsly-run-id*' -o -name 'mapsly-session-id*' \) -exec rm -rf {} + 2>/dev/null
  rm -rf /tmp/lock-gen /tmp/prettier-* /tmp/fmt-pkg /tmp/zen-loop /tmp/mw /tmp/db-helper /tmp/pg-cwk /tmp/dbprobe /tmp/fmt /tmp/v0*-edit /tmp/v07*-edit /tmp/audit-rules /tmp/check-* /tmp/neon-probe 2>/dev/null
  rm -f /tmp/*.tar.xz /tmp/*.tar.gz /tmp/_probe_* 2>/dev/null
  AVAIL=$(df --output=avail / 2>/dev/null | awk 'NR==2'); AVAIL=${AVAIL:-0}
  if [ "$AVAIL" -lt 1048576 ]; then
    rm -rf /tmp/.pnpm-store /tmp/pnpm-store /tmp/.npm 2>/dev/null
    find /tmp -maxdepth 1 -name 'mapsly-*' ! -name 'mapsly-work' -exec rm -rf {} + 2>/dev/null
    find /tmp -maxdepth 2 -name 'node_modules' -mmin +5 -exec rm -rf {} + 2>/dev/null
  fi

  # Sticky toolchain probe
  NODE_BIN=/tmp/node24/bin; NPM_GLOBAL=/tmp/npm-global
  if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then
    [ -x "$NODE_BIN/node" ] || {
      ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && NA=arm64 || NA=x64
      cd /tmp && curl -sSLO "https://nodejs.org/download/release/v24.5.0/node-v24.5.0-linux-${NA}.tar.xz" 2>/dev/null
      tar -xJf "node-v24.5.0-linux-${NA}.tar.xz" 2>/dev/null && mv "node-v24.5.0-linux-${NA}" node24 && rm -f "node-v24.5.0-linux-${NA}.tar.xz"
    }
    export PATH="$NODE_BIN:$NPM_GLOBAL/bin:$PATH"
    command -v pnpm >/dev/null 2>&1 || { mkdir -p "$NPM_GLOBAL"; npm install -g pnpm@9.15.0 --prefix "$NPM_GLOBAL" >/dev/null 2>&1; }
    command -v gh >/dev/null 2>&1 || {
      ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && GA=arm64 || GA=amd64
      cd /tmp && curl -sSLO "https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_${GA}.tar.gz" 2>/dev/null
      tar -xzf "gh_2.63.2_linux_${GA}.tar.gz" 2>/dev/null && cp "gh_2.63.2_linux_${GA}/bin/gh" "$NPM_GLOBAL/bin/" && rm -rf "gh_2.63.2_linux_${GA}.tar.gz" "gh_2.63.2_linux_${GA}"
    }
  fi
  export PATH="$NODE_BIN:$NPM_GLOBAL/bin:$PATH"

  # Work dir
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
    set -a; . .env.local 2>/dev/null; set +a
  else
    WORK_DIR="$PWD"; set -a; . .env.local 2>/dev/null; set +a
  fi

  # Capability flags
  if [ "$IS_SANDBOX" = "1" ]; then
    CAN_UNLINK=1; CAN_PNPM_INSTALL=0; CAN_DEPLOY_CHECK=0; CAN_VERCEL_CI=1
  else
    CAN_UNLINK=1; CAN_PNPM_INSTALL=1; CAN_DEPLOY_CHECK=1; CAN_VERCEL_CI=1
  fi

  # Loop-lock + orphan sweep (folded from old STEP 1)
  LOCK=$(cat "$WORK_DIR/.claude/memory/loop-lock.json" 2>/dev/null || echo '{"state":"idle"}')
  psql "$DATABASE_URL" -At <<SQL >/dev/null 2>&1
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
SQL

  HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo none)

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
  "loop_lock": ${LOCK}
}
EOF
} 2>&1
```

Parent parses the JSON. If `loop_lock.state` is `paused` or `cooldown` (future) → exit ≤1 line. Otherwise proceed.

**Parent turn count after STEP 0: 1.**

---

## STEP 1 · Boot reads — done by `loop-implementer`, NOT parent (v0.7.4)

The parent does NOT read incidents.md, CLAUDE.md, PLAN.md, MEMORY.md, cache-components.md. Those reads happen INSIDE the `loop-implementer` subagent's session per its own definition. Parent stays focused on orchestration.

**Parent turn count: 0 (no parent work here).**

---

## STEP 2 · Claim next task · ONE bash with psql multi-statement

```bash
SESSION_ID=$(uuidgen 2>/dev/null || echo "SES-$(date +%s)-$$")
RUN_ID=$(uuidgen 2>/dev/null || echo "RUN-$(date +%s)-$$")

# Build capabilities array for the claim query
CAPS=()
[ "$CAN_PNPM_INSTALL" = "1" ] && CAPS+=("requires:pnpm-install")
[ "$CAN_DEPLOY_CHECK" = "1" ] && CAPS+=("requires:deploy-check")
[ "$CAN_VERCEL_CI"    = "1" ] && CAPS+=("requires:vercel-ci")
CAPS_LITERAL="{$(IFS=,; echo "${CAPS[*]}")}"

psql "$DATABASE_URL" -At <<SQL
WITH eligible AS (
  SELECT t.id
  FROM "Task" t
  JOIN "TaskGroup" g ON g.id = t."groupId"
  WHERE t.status = 'PENDING'
    AND (t.tags IS NULL OR t.tags NOT LIKE '%human-required%')
    AND (t.tags IS NULL OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.tags, ',') tag
      WHERE trim(tag) LIKE 'requires:%' AND NOT (trim(tag) = ANY('${CAPS_LITERAL}'::text[]))
    ))
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
SET status='IN_PROGRESS', "startedAt"=now(), "lastSessionId"='${SESSION_ID}'
FROM eligible
WHERE t.id = eligible.id
RETURNING t.id, t.title, t.priority, t.tags, t.deps, t."parallelLane", t."contextBundle",
  (SELECT json_build_object('runId', r.id, 'branchName', r."branchName")
   FROM "TaskRun" r WHERE r."taskId" = t.id AND r.outcome = 'INCOMPLETE'
   ORDER BY r."startedAt" DESC LIMIT 1) AS resume;
SQL
```

If 0 rows → exit ≤1 line `no eligible tasks (caps=${CAPS_LITERAL}), idle`. **No cooldown.**

If 1 row → parse the returned task fields. The agent now knows: `TASK_ID`, `TASK_TITLE`, `TASK_TAGS`, `TASK_LANE`, `CONTEXT_BUNDLE` (may be null), `RESUME` (may be null for fresh, or {runId, branchName} for resume).

Then ONE more bash to INSERT the TaskRun:

```bash
psql "$DATABASE_URL" -At <<SQL
INSERT INTO "TaskRun" (id, "taskId", "sessionId", outcome, "startedAt", "resumedFromRunId", "branchName")
VALUES ('${RUN_ID}', '${TASK_ID}', '${SESSION_ID}', 'IN_PROGRESS', now(),
  $([ -n "$RESUME_RUN_ID" ] && echo "'${RESUME_RUN_ID}'" || echo NULL),
  $([ -n "$RESUME_BRANCH" ] && echo "'${RESUME_BRANCH}'" || echo NULL));
SQL
```

**Parent turn count after STEP 2: 3.**

---

## STEP 3 · DELEGATE implementation to `loop-implementer` subagent (ONE Agent call)

The parent does NOT investigate the codebase, write files, run prettier, or commit. The `loop-implementer` subagent does all of that in its own session with its own 100-turn budget.

```
Agent({
  description: "Implement task ${TASK_ID}",
  subagent_type: "loop-implementer",
  prompt: `
TASK_ID: ${TASK_ID}
TASK_TITLE: ${TASK_TITLE}
TASK_LANE: ${TASK_LANE}
TASK_TAGS: ${TASK_TAGS}
WORK_DIR: ${WORK_DIR}
BRANCH: ${RESUME_BRANCH:-auto/$(date +%Y-%m-%d)-${TASK_ID}-1}
RESUME_FROM_RUN: ${RESUME_RUN_ID:-none}
CONTEXT_BUNDLE: ${CONTEXT_BUNDLE:-(none — do focused exploration via Read/Grep/Glob)}

Your job: implement this task, stage the working tree, and return a structured
summary. Read the boot files (incidents.md, CLAUDE.md, PLAN.md, MEMORY.md, cache-components.md)
yourself — they're available at ${WORK_DIR}. You have your own 100-turn budget.

Return STATUS + BRANCH + FILES_CHANGED + TESTS_ADDED + COMMIT_SHA + NOTES.
  `,
})
```

Parent parses the returned summary. If STATUS=failed or needs-followup → STEP 8 close-out with TaskRun.outcome=INCOMPLETE, save branch, exit.

**Parent turn count after STEP 3: 4.**

---

## STEP 4 · SPAWN review agents · ONE assistant message · ALL parallel

The parent issues ONE assistant message containing N parallel `Agent` tool-use blocks. Each review agent has its OWN 100-turn budget. Their tool calls don't accumulate in the parent.

Required agents by task type (always include code-reviewer; add others per scope):

| Task touches                     | Add agents                                          |
| -------------------------------- | --------------------------------------------------- |
| Any task                         | `code-reviewer`                                     |
| Logic / scoring / cron / webhook | `code-reviewer` (already covers this case at depth) |
| New route or layout              | + `performance-auditor`                             |
| `app/[locale]/(smb)/**`          | + `ux-reviewer-smb`, `copy-reviewer`                |
| `app/[locale]/(agency)/**`       | + `ux-reviewer-agency`, `copy-reviewer`             |
| `app/api/payments/**`            | + `payments-auditor`, `security-auditor`            |
| Auth / signin / session          | + `security-auditor`                                |
| User-visible UI                  | + `a11y-reviewer`                                   |

Up to 5 review agents in ONE message. Each gets the same context:

```
Agent({ description: "code-reviewer for ${TASK_ID}", subagent_type: "code-reviewer", prompt: ... })
Agent({ description: "performance-auditor for ${TASK_ID}", subagent_type: "performance-auditor", prompt: ... })
... (up to 5)
```

After all review agents return (parent receives their summaries), spawn the **scorer** in a separate Agent call — scorer aggregates the verdicts:

```
Agent({ description: "scorer for ${TASK_ID}", subagent_type: "scorer", prompt: "<all review-agent summaries pasted here>" })
```

Parent total: 2 turns (one for the parallel batch, one for scorer).

**Parent turn count after STEP 4: 6.**

---

## STEP 5 · Push branch + open PR · ONE bash

```bash
git push -u origin "$BRANCH" 2>&1
PR_URL=$(gh pr create --fill --label autonomous 2>&1 | tail -1)
PR=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo "$PR" > /tmp/mapsly-pr-number
```

**Parent turn count after STEP 5: 7.**

---

## STEP 6 · Wait for CI · ONE bash with exponential backoff loop (sleeps INSIDE)

```bash
PR=$(cat /tmp/mapsly-pr-number)
CI_STATUS="pending"
for d in 15 30 60 120 240; do
  sleep $d
  RES=$(gh pr view "$PR" --json statusCheckRollup,deployments 2>&1)
  if echo "$RES" | grep -qE '"conclusion":"(FAILURE|CANCELLED|TIMED_OUT)"'; then
    CI_STATUS="failed"; break
  fi
  if echo "$RES" | grep -q '"conclusion":"SUCCESS"' && ! echo "$RES" | grep -q '"conclusion":null'; then
    CI_STATUS="green"; break
  fi
done
echo "CI_STATUS=$CI_STATUS"
PREVIEW_URL=$(gh pr view "$PR" --json comments --jq '.comments[] | select(.body | contains("vercel.app")) | .body' | grep -oE 'https://[a-z0-9.-]+\.vercel\.app[^ ]*' | head -1)
echo "PREVIEW_URL=$PREVIEW_URL"
```

**On `CI_STATUS=failed`**: mark TaskRun INCOMPLETE in STEP 8, save branch, exit. Next tick resumes via STEP 2's INCOMPLETE-resume path.

**Parent turn count after STEP 6: 8.**

---

## STEP 7 · DELEGATE browser validation to `loop-validator` (ONE Agent call)

Only fires if `CI_STATUS=green` AND `PREVIEW_URL` is set. Otherwise skip.

```
Agent({
  description: "Browser-validate PR #${PR}",
  subagent_type: "loop-validator",
  prompt: `
PR: ${PR}
PREVIEW_URL: ${PREVIEW_URL}
TASK_ID: ${TASK_ID}
TASK_DESCRIPTION: ${TASK_TITLE}
EXPECTED_ASSERTIONS: <derived from task spec — e.g., "hero contains 'For Agencies'", "no console errors", "Lighthouse perf ≥ 90">

Your own 100-turn budget. Validate as anonymous + appropriate signed-in user types.
Return STATUS + LIGHTHOUSE_PERF + LIGHTHOUSE_A11Y + CONSOLE_ERRORS + AXE_VIOLATIONS + NOTES.
  `,
})
```

If validator returns STATUS=fail → block auto-merge → close as INCOMPLETE for human follow-up.

**Parent turn count after STEP 7: 9.**

---

## STEP 8 · Auto-merge · ONE bash

```bash
gh pr merge "$PR" --auto --squash --delete-branch 2>&1
MERGED_SHA=$(gh pr view "$PR" --json mergeCommit --jq '.mergeCommit.oid' 2>&1 | head -c 7)
echo "MERGED_SHA=$MERGED_SHA"
```

**Parent turn count after STEP 8: 10.**

---

## STEP 9 · CLOSE-OUT · ONE bash heredoc

Single bash: psql transaction (TaskRun + Task + Notification resolve) + build-log append + loop-lock stamp.

```bash
{
  psql "$DATABASE_URL" -At <<SQL
BEGIN;
UPDATE "TaskRun" SET outcome='${OUTCOME}', "finishedAt"=now(),
  "commitSha"='${MERGED_SHA}', "prNumber"=${PR}, "prUrl"='${PR_URL}',
  "branchName"='${BRANCH}', "filesChanged"='${FILES_CHANGED_JSON}',
  "linesAdded"=${LINES_ADD:-0}, "linesDeleted"=${LINES_DEL:-0},
  "scoreAggregate"=${SCORE:-0}, "agentsUsed"='${AGENTS_USED_JSON}',
  "tokensInput"=${TOK_IN:-0}, "tokensOutput"=${TOK_OUT:-0},
  "costUsd"=${COST:-0}, "durationSec"=${DURATION:-0}
WHERE id='${RUN_ID}';

UPDATE "Task" SET
  status=CASE WHEN '${OUTCOME}' = 'SUCCESS' THEN 'DONE' ELSE status END,
  "completedAt"=CASE WHEN '${OUTCOME}' = 'SUCCESS' THEN now() ELSE "completedAt" END,
  "lastRunOutcome"='${OUTCOME}', "lastPrNumber"=${PR}, "lastPrUrl"='${PR_URL}',
  "lastCommitSha"='${MERGED_SHA}', "scoreAvg"=${SCORE:-0}
WHERE id='${TASK_ID}';

UPDATE "Notification" SET "resolvedAt"=now()
WHERE '${OUTCOME}' = 'SUCCESS' AND "resolvedAt" IS NULL AND level='WARN'
  AND (title ILIKE '%loop stalled%' OR title ILIKE '%switch to /loop%'
       OR title ILIKE '%cowork sandbox cannot install%' OR title ILIKE '%fuse wall%'
       OR title ILIKE '%loop in degraded mode%');
COMMIT;
SQL

  echo "SES-$(date +%Y-%m-%d)-${SESSION_ID:0:8} · ${TASK_ID} · ${OUTCOME} · score ${SCORE:-0}/10 · ${LINES_ADD:-0}+/${LINES_DEL:-0}- · ${CI_STATUS} · merged=${MERGED_SHA:-none}" >> .claude/memory/build-log.md

  cat > .claude/memory/loop-lock.json <<EOF
{
  "state": "idle",
  "sessionId": null,
  "lastTickAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cooldownUntil": null,
  "consecutiveFailures": 0,
  "note": "${SESSION_ID} · ${TASK_ID} · ${OUTCOME}"
}
EOF
} 2>&1
```

**Parent turn count after STEP 9: 11.**

---

## Parent turn budget · 11–14 turns (cap = 100)

| Step                                               | Parent turns |
| -------------------------------------------------- | -----------: |
| STEP 0 bootstrap                                   |            1 |
| STEP 2 claim (psql + insert)                       |            2 |
| STEP 3 Agent(loop-implementer)                     |            1 |
| STEP 4 ONE message with 5 parallel Agents + scorer |            2 |
| STEP 5 push + PR                                   |            1 |
| STEP 6 CI wait                                     |            1 |
| STEP 7 Agent(loop-validator)                       |            1 |
| STEP 8 merge                                       |            1 |
| STEP 9 close-out                                   |            1 |
| **Total**                                          |       **11** |

Each subagent has its OWN 100-turn budget. Heavy work fits comfortably. Per [Anthropic docs](https://platform.claude.com/docs/en/agent-sdk/subagents):

> "Each subagent runs in its own fresh conversation. Intermediate tool calls and results stay inside the subagent; only its final message returns to the parent."

> "Multiple subagents can run concurrently, dramatically speeding up complex workflows."

---

## Failure modes the loop must handle without surfacing blockers

| Symptom                                  | Self-heal                                                                             | If self-heal fails               |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| `_tmp_*` orphans block pnpm              | STEP 0 GC                                                                             | Mark INCOMPLETE, cooldown 30 min |
| FUSE unlink wall                         | STEP 0 ignores mount, works in /tmp                                                   | Mark INCOMPLETE, cooldown 4h     |
| Vercel CI failed                         | Mark INCOMPLETE on CI red, next tick resumes via STEP 2 INCOMPLETE-resume             | –                                |
| `loop-implementer` returns STATUS=failed | Close TaskRun INCOMPLETE, save branch, next tick resumes                              | –                                |
| `loop-validator` returns STATUS=fail     | Skip auto-merge, label PR `needs-review`                                              | –                                |
| Subagent hits its OWN 100-turn cap       | Subagent returns whatever it has + STATUS=needs-followup, parent treats as INCOMPLETE | –                                |
| Sentry error spike post-merge            | Auto-revert per observability.md                                                      | Log INC-, cooldown 4h            |
| Quota approaching                        | Cooldown 4h, INCOMPLETE next tick                                                     | Same                             |

---

## Cooldown discipline (unchanged from v0.6.5+)

Cooldown is reserved for catastrophic / repeated failures, NEVER for:

- Capability gaps (`CAN_UNLINK=0` etc.)
- Eligible queue empty
- Single CI failure (deferred to next tick via INCOMPLETE)
- Subagent hitting its own turn cap (deferred to next tick via INCOMPLETE)

Cooldown DOES fire for:

- ≥3 consecutive failures of the SAME task → 1h + INC-
- ≥5 consecutive failures across DIFFERENT tasks → 24h + "loop unhealthy" INC-
- Quota / rate-limit approaching → 4h
- Anthropic 429 → 4h

---

**Begin iteration.**
