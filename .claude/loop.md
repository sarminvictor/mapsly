# Mapsly autonomous build loop · v0.6.42 strict per-iteration prompt

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

# 0a.1 · /tmp HYGIENE (INC-33) — delete prior-tick orphans before bootstrap.
# Cowork's /dev/nvme0n1p1 is ~9.6 GB total; each tick leaves behind a 4-MB
# clone + occasional 50-MB-1.1-GB toolchain installs (lock-gen, prettier-check,
# db-helper, etc.). After ~30 ticks the disk fills and `useradd` itself fails,
# halting the loop. STEP 0 MUST GC before bootstrap.
#
# Safe to delete (per-tick scratch):
#   /tmp/mapsly-* older than 30 min        (clone orphans + escape-hatch dirs)
#   /tmp/lock-gen, /tmp/prettier-*         (one-off install dirs from prior ticks)
#   /tmp/fmt-pkg, /tmp/zen-loop, /tmp/mw   (named tool installs from past iters)
#   /tmp/db-helper, /tmp/pg-cwk            (named tool installs)
#   /tmp/*.tar.xz, /tmp/*.tar.gz           (extracted tarballs)
#
# Keep (sticky toolchain — see 0a.2):
#   /tmp/node24      (Node 24 binary, ~207 MB, reusable across ticks)
#   /tmp/npm-global  (pnpm install location, ~19 MB, reusable)
#
# Each scheduled-task tick runs as the same sandbox user (typically `nobody`),
# so it CAN delete its own past orphans even though it can't delete files
# created by a different sandbox session. `rm -rf` errors are suppressed —
# any file we can't delete is from a different user and will be cleaned by
# that user's next tick.
BEFORE_BYTES=$(df --output=avail / 2>/dev/null | awk 'NR==2' | tr -d ' ')
BEFORE_MB=$((BEFORE_BYTES / 1024))

# Standard GC: orphans older than 30 min + known one-off tool dirs
find /tmp -maxdepth 1 -name 'mapsly-*' \( -mmin +30 -o -name 'mapsly-git*' -o -name 'mapsly-work-*' -o -name 'mapsly-loop-*' -o -name 'mapsly-commit*' -o -name 'mapsly-scratch*' -o -name 'mapsly-wt-*' -o -name 'mapsly-env-*' -o -name 'mapsly-run-id*' -o -name 'mapsly-session-id*' \) -exec rm -rf {} + 2>/dev/null
rm -rf /tmp/lock-gen /tmp/prettier-check /tmp/prettier-cli /tmp/prettier-tool /tmp/prettier-bin /tmp/prettier-mini /tmp/fmt-pkg /tmp/zen-loop /tmp/mw /tmp/db-helper /tmp/pg-cwk /tmp/dbprobe /tmp/fmt 2>/dev/null
rm -f /tmp/*.tar.xz /tmp/*.tar.gz 2>/dev/null

# Disk-pressure-aware aggressive GC (INC-34): when free < 1 GB, also nuke
# pnpm content-addressable store + ALL mapsly-* orphans regardless of age
# (except canonical /tmp/mapsly-work). The pnpm-store grows monotonically
# across ticks and is the largest single offender; safe to clear because
# next pnpm install repopulates from network.
PRESSURE_AVAIL=$(df --output=avail / 2>/dev/null | awk 'NR==2' | tr -d ' ')
if [ "${PRESSURE_AVAIL:-0}" -lt 1048576 ]; then
  echo "[step-0] disk pressure detected (${PRESSURE_AVAIL} KB free < 1 GB) — aggressive GC"
  rm -rf /tmp/.pnpm-store 2>/dev/null
  rm -rf /tmp/pnpm-store /tmp/.npm 2>/dev/null
  # Nuke every /tmp/mapsly-* except the canonical work dir
  find /tmp -maxdepth 1 -name 'mapsly-*' ! -name 'mapsly-work' -exec rm -rf {} + 2>/dev/null
  # Nuke prior-tick node_modules trees we don't own (best-effort)
  find /tmp -maxdepth 2 -name 'node_modules' -mmin +5 -exec rm -rf {} + 2>/dev/null
fi

AFTER_BYTES=$(df --output=avail / 2>/dev/null | awk 'NR==2' | tr -d ' ')
AFTER_MB=$((AFTER_BYTES / 1024))
FREED_MB=$((AFTER_MB - BEFORE_MB))
echo "[step-0] /tmp GC freed ${FREED_MB} MB · /tmp now ${AFTER_MB} MB free"

# 0a.2 · Sticky toolchain · install Node + pnpm + gh ONCE per sandbox lifetime, reuse forever.
# Avoids 30-second pnpm reinstalls + multi-MB tool reinstalls every 5 min.
NODE_BIN=/tmp/node24/bin
NPM_GLOBAL=/tmp/npm-global

if [ ! -x "$NODE_BIN/node" ]; then
  echo "[step-0] Installing Node 24 to $NODE_BIN (one-time, ~30s)..."
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && NODE_ARCH=arm64 || NODE_ARCH=x64
  TARBALL="node-v24.5.0-linux-${NODE_ARCH}.tar.xz"
  cd /tmp && curl -sSLO "https://nodejs.org/download/release/v24.5.0/${TARBALL}"
  tar -xJf "$TARBALL" 2>/dev/null && mv "node-v24.5.0-linux-${NODE_ARCH}" node24 && rm -f "$TARBALL"
fi

export PATH="$NODE_BIN:$NPM_GLOBAL/bin:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[step-0] Installing pnpm to $NPM_GLOBAL (one-time, ~5s)..."
  mkdir -p "$NPM_GLOBAL"
  npm install -g pnpm@9.15.0 --prefix "$NPM_GLOBAL" 2>&1 | tail -1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[step-0] Installing gh CLI to $NPM_GLOBAL/bin (one-time, ~20s)..."
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && GH_ARCH=arm64 || GH_ARCH=amd64
  GH_TAR="gh_2.63.2_linux_${GH_ARCH}.tar.gz"
  cd /tmp && curl -sSLO "https://github.com/cli/cli/releases/download/v2.63.2/${GH_TAR}"
  tar -xzf "$GH_TAR" 2>/dev/null && cp "gh_2.63.2_linux_${GH_ARCH}/bin/gh" "$NPM_GLOBAL/bin/" && rm -rf "$GH_TAR" "gh_2.63.2_linux_${GH_ARCH}"
fi

echo "[step-0] tools: $(command -v node || echo missing-node) · $(command -v pnpm || echo missing-pnpm) · $(command -v gh || echo missing-gh)"

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
if [ "$IS_SANDBOX" = "1" ]; then
  CAN_UNLINK=1 CAN_PNPM_INSTALL=0 CAN_DEPLOY_CHECK=0 CAN_VERCEL_CI=1
else
  CAN_UNLINK=1 CAN_PNPM_INSTALL=1 CAN_DEPLOY_CHECK=1 CAN_VERCEL_CI=1
fi
CAN_GIT_PUSH=1
echo "[step-0] capabilities: UNLINK=$CAN_UNLINK PNPM_INSTALL=$CAN_PNPM_INSTALL DEPLOY_CHECK=$CAN_DEPLOY_CHECK"

# 0d · Turn-budget counter (v0.6.42 · INC-35).
# Claude Code (and the Cowork desktop scheduled task) imposes a max-turns
# safety limit per session — default 100. Each step boundary stamps
# TURN_USED and the agent compares against TURN_BUDGET=80 (20% safety margin).
# At or above 80, the agent gracefully exits to INCOMPLETE for resume next tick.
# This prevents orphaned TaskRun rows from mid-iteration "Reached maximum
# number of turns (100)" kills.
TURN_BUDGET=80
TURN_USED=0
echo "[step-0] turn budget: $TURN_USED / $TURN_BUDGET (max-turns=100 with 20% margin)"
```

**Sticky toolchain detection (v0.6.42 simplification):** replace the 3 separate `if !` blocks with one shared probe. If `node`, `pnpm`, and `gh` are all already on PATH (`command -v` exits 0 for each), skip installs entirely. Otherwise install each missing tool to its canonical sticky path (`/tmp/node24`, `/tmp/npm-global`). One probe replaces three.

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

## STEP 2 · Bundled boot reads (v0.6.42 optimization)

Per `.claude/rules/incident-prevention.md`, the loop must boot with full context of incidents + project rules + plan. Prior versions used 5 separate `Read` tool calls (5 turns). v0.6.42 bundles all five files into ONE bash call:

```bash
{
  echo "===== incidents.md ====="
  cat .claude/memory/incidents.md
  echo "===== CLAUDE.md ====="
  cat CLAUDE.md
  echo "===== PLAN.md ====="
  cat PLAN.md 2>/dev/null || echo "(no PLAN.md)"
  echo "===== MEMORY.md ====="
  cat .claude/memory/MEMORY.md 2>/dev/null || echo "(no MEMORY.md)"
  echo "===== cache-components.md ====="
  cat .claude/rules/cache-components.md 2>/dev/null || echo "(no cache-components.md)"
} | head -c 200000   # truncate to ~200 KB if any file blew up
```

One turn. Five files. Parse the section headers (`===== filename =====`) to identify boundaries. **TURN_USED=$((TURN_USED + 1))** after this step.

Skip this step's bundle if the agent has high confidence the files haven't changed since a prior recent tick in the same session (rare for /tmp clones that are fresh per tick, but applies if the loop runs locally on Mac via `/loop`).

Cache these mentally for this iteration. Do not re-read mid-iteration.

---

## STEP 3 · Atomic SKIP LOCKED claim (v0.6.42 rewrite)

Prior versions did 5–7 round trips (candidate fetch → in-process deps filter → in-process capability filter → INCOMPLETE lookup → UPDATE → verify rowsAffected → TaskRun INSERT). v0.6.42 collapses this to **2 round trips** using the canonical Postgres queue pattern `FOR UPDATE SKIP LOCKED` + UPDATE-RETURNING. The CTE also embeds deps + capability filters in SQL.

**Build the capabilities array** for the claim query (one-line shell):

```bash
CAPS=()
[ "$CAN_PNPM_INSTALL" = "1" ] && CAPS+=("requires:pnpm-install")
[ "$CAN_DEPLOY_CHECK" = "1" ] && CAPS+=("requires:deploy-check")
[ "$CAN_VERCEL_CI"    = "1" ] && CAPS+=("requires:vercel-ci")
# Pass to psql as a Postgres TEXT[] literal: '{requires:pnpm-install,requires:deploy-check,...}'
CAPS_LITERAL="{$(IFS=,; echo "${CAPS[*]}")}"
```

**Round 1 · single-statement claim** (deps + capability filter + lock + UPDATE + return INCOMPLETE-resume metadata):

```sql
WITH eligible AS (
  SELECT t.id
  FROM "Task" t
  JOIN "TaskGroup" g ON g.id = t."groupId"
  WHERE t.status = 'PENDING'
    AND (t.tags IS NULL OR t.tags NOT LIKE '%human-required%')
    -- Capability gate: skip tasks needing a capability we lack.
    -- Each `requires:*` tag in a task's tags must be in $1 (CAPS_LITERAL).
    AND (t.tags IS NULL OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.tags, ',') tag
      WHERE trim(tag) LIKE 'requires:%'
        AND NOT (trim(tag) = ANY($1::text[]))
    ))
    -- Deps gate: every comma-separated dep must be Status=DONE.
    AND (t.deps IS NULL OR t.deps = '' OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(t.deps, ',') dep_id
      LEFT JOIN "Task" td ON td.id = trim(dep_id)
      WHERE td.status IS DISTINCT FROM 'DONE'
    ))
  ORDER BY t.priority NULLS LAST, g."sortOrder", t."sortOrder", t.id
  LIMIT 1
  FOR UPDATE OF t SKIP LOCKED   -- concurrent-safe; SQL-guaranteed atomicity
)
UPDATE "Task" t
SET status='IN_PROGRESS', "startedAt"=now(), "lastSessionId"=$2
FROM eligible
WHERE t.id = eligible.id
RETURNING
  t.id, t.title, t.priority, t.tags, t.deps, t."parallelLane",
  -- INCOMPLETE-resume metadata fetched inline in same statement
  (SELECT json_build_object('runId', r.id, 'branchName', r."branchName")
   FROM "TaskRun" r
   WHERE r."taskId" = t.id AND r.outcome = 'INCOMPLETE'
   ORDER BY r."startedAt" DESC LIMIT 1) AS resume;
```

Returns:

- 0 rows → queue empty for current capabilities → exit ≤1 line: `no eligible tasks (caps=${CAPS_LITERAL}), idle`. **No cooldown.**
- 1 row with `resume = null` → fresh task; checkout a new branch `auto/YYYY-MM-DD-{taskId}-{n}`.
- 1 row with `resume = {runId, branchName}` → resume the prior incomplete run; `git checkout $branchName`.

**Round 2 · open TaskRun:**

```sql
INSERT INTO "TaskRun" (id, "taskId", "sessionId", outcome, "startedAt", "resumedFromRunId", "branchName")
VALUES ($1, $2, $3, 'IN_PROGRESS', now(), $4, $5);
```

**Total: 2 turns** for full STEP 3 (was 5–7 turns). Postgres handles concurrent claim safety via row locks; no app-level retry needed. `TURN_USED=$((TURN_USED + 2))`.

If TURN_USED > TURN_BUDGET at this point → graceful exit (see STEP 10 cooldown discipline). Should never happen unless STEP 0 was unusually expensive.

---

## STEP 4 · Implement via the autonomous-build-loop skill

Read `.claude/skills/autonomous-build-loop/SKILL.md` and follow its phases:

1. **Research phase** — spawn parallel research agents IN ONE message (`Promise.allSettled`). Cap = 6 concurrent per `.claude/rules/agent-orchestration.md`. Skip research entirely for S-size tasks.

   **v0.6.42 · agent context bundle.** Pre-render a shared context bundle ONCE, attach to every spawned agent's prompt as a single block. Prevents each agent from re-deriving the same context:

   ```
   <context-bundle>
   ## Task
   {Task.id} · {Task.title} · {effort} · {priority}
   {Task.description}

   ## Phase context (from PLAN.md)
   {extracted phase header + adjacent tasks}

   ## Relevant recent incidents
   {INC- entries from incidents.md tagged with task's domain — auto-filtered}

   ## Rule files this task likely touches
   {grep -l "{Task.domain keyword}" .claude/rules/ — auto-discovered}
   </context-bundle>
   ```

   Each agent gets `<context-bundle>` + its specific mission. Saves 10–20 turns per task vs each agent's prompt independently fetching the same files.

2. **Implement phase** — edit files. Honor every rule in `.claude/rules/`.
3. **Review phase** — see STEP 5 below.

Branch naming: `auto/YYYY-MM-DD-{taskId}-{n}` per `git-discipline.md`. Author: `Viktor <sarminvictor@gmail.com>`. Conventional commits.

`TURN_USED=$((TURN_USED + N))` where N = number of agents spawned + edits.

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

## STEP 6 · MANDATORY validation · gated by capability, not by convenience

Every applicable mode MUST run **inside this iteration**. The capability-aware split:

- **Compile / build / lint / typecheck / unit-tests**: when `CAN_DEPLOY_CHECK=1` (real macOS), runs locally; when `CAN_DEPLOY_CHECK=0` (Cowork), deferred to Vercel CI (same `pnpm deploy-check` script runs in the build container). Both paths produce equivalent verdicts.
- **Browser, Lighthouse, axe-core, DB validation, test-data cleanup**: ALWAYS run inside this iteration via Claude in Chrome MCP + Prisma direct query — regardless of `CAN_DEPLOY_CHECK`. These hit the Vercel preview URL (or production for read-only DB checks), so they're independent of local toolchain state.

If a mode genuinely cannot run (no UI changes → skip browser; no DB writes → skip db), record `reason` explaining WHY it's N/A. "needs preview URL" / "needs Gmail tab" / "will validate manually later" are NEVER valid reasons.

### Validation order (do in this exact sequence)

1. **Local `pnpm deploy-check`** — gated on `CAN_DEPLOY_CHECK`.
   - **If `CAN_DEPLOY_CHECK=1`** (real macOS): run `pnpm deploy-check` locally. Check exit code; on failure, read output, fix code, retry (counts against STEP 7 retry budget of 6). This is the fastest feedback loop.
   - **If `CAN_DEPLOY_CHECK=0`** (Cowork sandbox): SKIP local deploy-check. Push the branch instead and let Vercel CI run the full validation (format/typecheck/lint/build/tests). Record `validationStrategy.deployCheck = "deferred-to-vercel-ci"` on the TaskRun. This is the canonical pattern for Cowork-only mode (INC-31).

   The "deferred to CI" path is the right pattern when local deploy-check is not feasible (no node_modules, no unlink, no disk space). Vercel runs the same `pnpm deploy-check` script in its build pipeline. The 60s extra wall-clock is acceptable because ticks run every 5 min and CI takes 2-3 min typically.

   For env-agnostic tasks (docs/memory/research/dashboard queries with no compiled code change), deploy-check is N/A — record `validationStrategy.deployCheck = "not-applicable"` with reason.

2. **Unit + integration tests** · run `pnpm test:run` locally. If any pre-existing test fails, fix before proceeding.
3. **Push branch + open PR** if not already done.
4. **Wait for CI + Vercel preview URL · exponential backoff polling (v0.6.42).** Prior versions polled `gh pr view {n}` every 15s for up to 24 polls (= 24 turns burned on waiting). v0.6.42 uses exponential backoff: poll at t=15s, t=45s, t=105s, t=225s, t=465s (5 polls, ~7 min total budget, 5 turns).

   ```bash
   for delay in 15 30 60 120 240; do
     sleep $delay
     STATUS=$(gh pr view $PR --json statusCheckRollup --jq '.statusCheckRollup | map(.conclusion)' 2>&1)
     case "$STATUS" in
       *FAILURE*|*TIMED_OUT*|*CANCELLED*) echo "ci_failed"; break ;;
       *SUCCESS*) [[ "$STATUS" != *PENDING* && "$STATUS" != *null* ]] && echo "ci_green"; break ;;
     esac
   done
   ```

   On `ci_failed`: **DO NOT retry in this iteration** (v0.6.42 change). Instead:
   1. Mark TaskRun `outcome=INCOMPLETE`, save `branchName` and a brief reason.
   2. Add a comment to the PR with the failing check log link (so next tick has context).
   3. Reset Task back to `PENDING` (so STEP 3 re-claims it next tick).
   4. Exit ≤1 line: `CI red on attempt 1 · saved INCOMPLETE for next-tick resume · PR=$PR`.
   5. The next iteration's STEP 3 will see the INCOMPLETE TaskRun, resume the branch, read the PR comment for context, and push fixes.

   This is the canonical queue-worker retry pattern (per `.claude/rules/loop-discipline.md` § Retry policy and INC-35). Same-session retries burn turns and risk hitting the 100-turn cap mid-fix. Across-tick retries cost +5 min wall-clock per attempt, which is negligible compared to a session kill.

   Vercel posts a preview comment with `https://*.vercel.app` URL within ~60s of push. THIS is the URL for browser/Lighthouse validation in steps 5–7 below. If the preview is still `Building` after 4 min, the same INCOMPLETE-and-resume pattern applies.

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
| `deployCheck` | ALWAYS (locally if CAN_DEPLOY_CHECK=1, else via Vercel CI)  | none                           |
| `unit`        | Pure logic added (scorer, parser, validator, compute fn)    | "no pure logic in this task"   |
| `integration` | Crossed a service boundary (DB, API, webhook, cron handler) | "no service boundary crossed"  |
| `browser`     | Any UI route added/changed                                  | "no UI changes — backend only" |
| `db`          | Any DB write/migrate                                        | "no DB writes from this task"  |
| `email`       | Magic link, transactional, cohort, billing email triggered  | "no email triggered"           |
| `performance` | Route or layout changed                                     | "no route changes"             |
| `a11y`        | UI added/changed                                            | "no UI changes"                |

**ABSOLUTELY INVALID skip reasons** (these will fail the iteration):

- "deferred to CI" — INVALID for compile/build/lint when CAN_DEPLOY_CHECK=1 (run locally). VALID for compile/build/lint when CAN_DEPLOY_CHECK=0 (use `deferred-to-vercel-ci` exactly).
- "deferred to CI" for browser/Lighthouse/a11y is NEVER valid — CI doesn't run those. Always invoke Claude in Chrome MCP against the Vercel preview URL after CI green.
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

- **CI red or deploy-check fail** → loop attempts repair IN THIS ITERATION: read failing logs, push fix commits, re-run CI. **Same-session retries banned in v0.6.42** (see INC-35). On CI red, mark INCOMPLETE + save branch + exit; the next iteration resumes via STEP 3 INCOMPLETE-resume path and continues fixing across-tick. If red on attempt 1 → mark TaskRun `INCOMPLETE` (v0.6.42: same-session retries are banned, see INC-35), save `branchName`, next iteration resumes the same branch and continues fixing. Record each attempt's failure mode in `TaskRun.errorMessage` so the resume iteration doesn't re-try the same dead-end.
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

**Close-out as a single transaction (v0.6.42 optimization).** Bundle the TaskRun update, Task update, stale-Notification resolve, and an audit row into ONE round trip:

```sql
BEGIN;

UPDATE "TaskRun"
SET outcome = $1, "finishedAt" = now(),
    "commitSha" = $2, "prNumber" = $3, "prUrl" = $4, "branchName" = $5,
    "filesChanged" = $6, "linesAdded" = $7, "linesDeleted" = $8, "testsAdded" = $9,
    "scoreAggregate" = $10, "scoreCompletion" = $11, "scoreQuality" = $12,
    "scoreAudience" = $13, "scoreRelevance" = $14, "scorePerformance" = $15,
    "agentsUsed" = $16, "validationStrategy" = $17, "validationOutcomes" = $18,
    "tokensInput" = $19, "tokensOutput" = $20, "costUsd" = $21, "durationSec" = $22
WHERE id = $23;

UPDATE "Task"
SET status = CASE WHEN $1 = 'SUCCESS' THEN 'DONE' ELSE status END,
    "completedAt" = CASE WHEN $1 = 'SUCCESS' THEN now() ELSE "completedAt" END,
    "lastRunOutcome" = $1,
    "lastPrNumber" = $3, "lastPrUrl" = $4, "lastCommitSha" = $2,
    "scoreAvg" = $10,
    "failureCount" = CASE WHEN $1 = 'FAILED' THEN "failureCount" + 1 ELSE "failureCount" END
WHERE id = $24;

-- Resolve stale dashboard Notifications on SUCCESS
UPDATE "Notification"
SET "resolvedAt" = now()
WHERE $1 = 'SUCCESS'
  AND "resolvedAt" IS NULL
  AND level = 'WARN'
  AND (title ILIKE '%loop stalled%'
       OR title ILIKE '%switch to /loop%'
       OR title ILIKE '%cowork sandbox cannot install%'
       OR title ILIKE '%fuse wall%'
       OR title ILIKE '%loop in degraded mode%');

COMMIT;
```

One transaction, one round trip. Was 3–4 separate UPDATEs in prior versions.

Then ONE bash call to:

1. Append to `.claude/memory/build-log.md` (`echo ">> SES-... · taskId · outcome ..." >> file`)
2. Stamp `.claude/memory/loop-lock.json` (write JSON via cat heredoc)

`TURN_USED=$((TURN_USED + 2))` (SQL transaction + bash bundle).

---

## STEP 9 · Quota guard

If during execution you detect approaching usage limit (warning in output, `usage_limit`, 429):

1. Do NOT panic-revert — committed work stays.
2. Mark TaskRun `outcome=INCOMPLETE`, save `branchName`, `finishedAt=now`.
3. Reset Task back to `PENDING`.
4. Set `loop-lock.cooldownUntil = now + 4h`.
5. Exit. Next iteration after cooldown resumes via STEP 3.

---

## STEP 10 · Discipline · turn budget + cooldown only on real failures

**Turn-budget checkpoint (v0.6.42 · INC-35):** At every step boundary (after STEPs 0, 2, 3, 4, 5, 6, 7), the agent compares `TURN_USED` against `TURN_BUDGET` (default 80, with 20% margin against the 100-turn cap).

If `TURN_USED >= TURN_BUDGET`:

1. Stop new work. Do NOT spawn additional agents, do NOT poll CI further.
2. Mark TaskRun `outcome=INCOMPLETE` with `branchName` preserved + `notes` capturing where we paused.
3. Reset Task back to `PENDING`.
4. Append `SES-{date}-{slot} · {taskId} · INCOMPLETE · turn-budget-exhausted · resumed-on-next-tick` to build-log.md.
5. Stamp loop-lock + exit ≤1 line: `turn budget exhausted at step N (used=${TURN_USED}/${TURN_BUDGET}) · INCOMPLETE · next tick resumes`.
6. The next iteration's STEP 3 sees the INCOMPLETE TaskRun and resumes the branch.

This prevents the "Reached maximum number of turns (100)" mid-iteration kills that orphan TaskRun rows. Per INC-35.

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
