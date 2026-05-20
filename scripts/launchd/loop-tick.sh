#!/bin/bash
# Mapsly autonomous build loop · launchd tick wrapper · parallel + recovery.
#
# Behavior:
# - Reads MAX_PARALLEL_SESSIONS (default 1). Spawns up to N background workers.
# - Each worker queries Postgres for an eligible task, atomically claims it,
#   and runs `claude --print --model "$CLAUDE_MODEL"`.
# - Lane-based locking: at most one IN_PROGRESS task per parallelLane.
# - On rate-limit detection in worker output → marks TaskRun outcome=INCOMPLETE.
#   Next session resumes the task from its branch (Task.status stays IN_PROGRESS).
# - All output → ~/.mapsly/logs/loop-{date}-{worker}.log
#
# Runs natively on macOS; full filesystem access; no sandbox.

set -uo pipefail

PROJECT_DIR="$HOME/Documents/Claude/Projects/mapsly"
LOG_DIR="$HOME/.mapsly/logs"
PROMPT_PATH="$PROJECT_DIR/scripts/launchd/loop-prompt.md"
DATE_TAG="$(date +%Y-%m-%d)"
SUPERVISOR_LOG="$LOG_DIR/supervisor-$DATE_TAG.log"

mkdir -p "$LOG_DIR"

# Source .env.local for CLAUDE_MODEL, MAX_PARALLEL_SESSIONS, GITHUB_TOKEN, DATABASE_URL
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env.local"
  set +a
fi

MAX_PARALLEL="${MAX_PARALLEL_SESSIONS:-1}"
MODEL="${CLAUDE_MODEL:-claude-opus-4-7}"

# Locate claude
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for try in \
    "$HOME/.claude/local/claude" \
    "$HOME/.local/bin/claude" \
    "/opt/homebrew/bin/claude" \
    "/usr/local/bin/claude"; do
    if [ -x "$try" ]; then CLAUDE_BIN="$try"; break; fi
  done
fi

if [ -z "$CLAUDE_BIN" ]; then
  echo "[$(date)] FAIL · claude CLI not found" >> "$SUPERVISOR_LOG"
  exit 1
fi

cd "$PROJECT_DIR" || {
  echo "[$(date)] FAIL · project dir missing" >> "$SUPERVISOR_LOG"
  exit 1
}

echo "[$(date)] SUPERVISOR TICK · model=$MODEL · max_parallel=$MAX_PARALLEL" >> "$SUPERVISOR_LOG"

# ---- Stamp lastTickAt unconditionally ----
# So we can tell from the dashboard whether launchd is even firing.
# Done early so a later crash still leaves evidence of the tick.
LOCK_PATH="$PROJECT_DIR/.claude/memory/loop-lock.json"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node -e "
  const fs = require('fs');
  const path = '$LOCK_PATH';
  let lock = {};
  try { lock = JSON.parse(fs.readFileSync(path, 'utf8')); } catch(e) {}
  lock.lastTickAt = '$NOW_ISO';
  fs.writeFileSync(path, JSON.stringify(lock, null, 2));
" 2>/dev/null || true

# ---- Honor loop-lock cooldown ----
# If a previous worker wrote a cooldown (quota exhausted), exit silently until it expires.
if [ -f "$LOCK_PATH" ]; then
  LOCK_STATE="$(node -e "try{const l=require('$LOCK_PATH');if(l.state==='cooldown'&&l.cooldownUntil&&new Date(l.cooldownUntil)>new Date()){console.log('COOLDOWN '+l.cooldownUntil)}}catch(e){}" 2>/dev/null)"
  if [ -n "$LOCK_STATE" ]; then
    echo "[$(date)] SUPERVISOR · $LOCK_STATE · skipping tick" >> "$SUPERVISOR_LOG"
    exit 0
  fi
fi

# ---- Orphan sweep · runs BEFORE spawning workers ----
# Tasks stuck IN_PROGRESS with no recent TaskRun update (> 30 min since startedAt
# AND no TaskRun.finishedAt) are orphans from a killed worker. Reset to PENDING
# and mark the prior TaskRun INCOMPLETE so it can be resumed.
node -e "
const { PrismaClient } = require('./lib/generated/prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) process.exit(0);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
const cutoff = new Date(Date.now() - 30 * 60 * 1000);
(async () => {
  const orphaned = await prisma.task.findMany({
    where: { status: 'IN_PROGRESS', startedAt: { lt: cutoff } },
    select: { id: true, lastSessionId: true },
  });
  for (const t of orphaned) {
    await prisma.taskRun.updateMany({
      where: { taskId: t.id, sessionId: t.lastSessionId || undefined, outcome: 'IN_PROGRESS' },
      data: { outcome: 'INCOMPLETE', finishedAt: new Date(), errorMessage: 'worker killed (quota or crash) · auto-reset by orphan sweep' },
    });
    await prisma.task.update({ where: { id: t.id }, data: { status: 'PENDING', lastSessionId: null } });
    console.log('orphan-reset task=' + t.id);
  }
  await prisma.\$disconnect();
})().catch(e => { console.error(e); process.exit(0); });
" >> "$SUPERVISOR_LOG" 2>&1 || true

# Spawn N background workers. Each worker claims one task or exits.
for SLOT in $(seq 1 "$MAX_PARALLEL"); do
  WORKER_LOG="$LOG_DIR/worker-$DATE_TAG-slot$SLOT.log"
  (
    SESSION_ID="SES-$(date +%Y-%m-%d)-$(date +%H%M%S)-slot$SLOT"
    echo "[$(date)] WORKER $SLOT START · session=$SESSION_ID · model=$MODEL" >> "$WORKER_LOG"

    # Inject session context as additional env so the loop prompt can use it.
    # CRITICAL: --dangerously-skip-permissions — without this, headless claude
    # blocks on every tool-use approval prompt (no TTY = silent hang).
    # See INC-19 for the symptom (0 TaskRuns ever written despite ticks firing).
    SESSION_ID="$SESSION_ID" \
    CLAUDE_MODEL="$MODEL" \
    "$CLAUDE_BIN" --print \
      --model "$MODEL" \
      --dangerously-skip-permissions \
      "$(cat "$PROMPT_PATH")" \
      >> "$WORKER_LOG" 2>&1
    EXIT=$?

    # Detect rate-limit pattern in last 100 lines
    if tail -100 "$WORKER_LOG" | grep -qiE "rate.?limit|usage.?limit|quota.?exceeded|429"; then
      echo "[$(date)] WORKER $SLOT RATE-LIMIT detected · session=$SESSION_ID exit=$EXIT" >> "$WORKER_LOG"
      echo "[$(date)] WORKER $SLOT RATE-LIMIT detected · session=$SESSION_ID" >> "$SUPERVISOR_LOG"

      # Fallback recovery · the agent may not have run §9.5 if killed mid-run.
      # Reset any task this session was working on, mark TaskRun INCOMPLETE,
      # and set loop-lock cooldown = 4h (Pro Max rolling window estimate).
      node -e "
        const { PrismaClient } = require('./lib/generated/prisma/client');
        const { PrismaNeon } = require('@prisma/adapter-neon');
        const fs = require('fs');
        const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
        if (!url) process.exit(0);
        const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
        (async () => {
          // Mark any open TaskRuns from this session as INCOMPLETE
          await prisma.taskRun.updateMany({
            where: { sessionId: '$SESSION_ID', outcome: 'IN_PROGRESS' },
            data: { outcome: 'INCOMPLETE', finishedAt: new Date(), errorMessage: 'Pro Max quota exhausted · worker terminated' },
          });
          // Unlock any Task this session was claiming
          await prisma.task.updateMany({
            where: { lastSessionId: '$SESSION_ID', status: 'IN_PROGRESS' },
            data: { status: 'PENDING', lastSessionId: null },
          });
          await prisma.\$disconnect();
        })().catch(e => { console.error(e); process.exit(0); });
      " >> "$WORKER_LOG" 2>&1 || true

      # Write loop-lock cooldown (4h is the Pro Max 5h rolling window estimate).
      # `date -u -v+4H` is BSD/macOS; `date -u -d` is GNU. Try BSD first.
      WORKER_LOCK_PATH="$PROJECT_DIR/.claude/memory/loop-lock.json"
      COOLDOWN_UNTIL="$(date -u -v+4H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+4 hours' +%Y-%m-%dT%H:%M:%SZ)"
      NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      node -e "
        const fs = require('fs');
        fs.writeFileSync('$WORKER_LOCK_PATH', JSON.stringify({
          state: 'cooldown',
          reason: 'quota-exhausted',
          cooldownUntil: '$COOLDOWN_UNTIL',
          setBy: 'worker-slot$SLOT',
          setAt: '$NOW_ISO',
        }, null, 2));
      " 2>/dev/null || true
    else
      echo "[$(date)] WORKER $SLOT END · exit=$EXIT" >> "$WORKER_LOG"
    fi
  ) &

  # Stagger workers by 5s to avoid simultaneous DB-claim races
  sleep 5
done

# Don't wait — let workers run in background; this script exits so launchd
# can fire its next tick on schedule (every 5 min).
echo "[$(date)] SUPERVISOR · $MAX_PARALLEL workers backgrounded" >> "$SUPERVISOR_LOG"
