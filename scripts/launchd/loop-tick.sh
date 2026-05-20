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

# Spawn N background workers. Each worker claims one task or exits.
for SLOT in $(seq 1 "$MAX_PARALLEL"); do
  WORKER_LOG="$LOG_DIR/worker-$DATE_TAG-slot$SLOT.log"
  (
    SESSION_ID="SES-$(date +%Y-%m-%d)-$(date +%H%M%S)-slot$SLOT"
    echo "[$(date)] WORKER $SLOT START · session=$SESSION_ID · model=$MODEL" >> "$WORKER_LOG"

    # Inject session context as additional env so the loop prompt can use it
    SESSION_ID="$SESSION_ID" \
    CLAUDE_MODEL="$MODEL" \
    "$CLAUDE_BIN" --print --model "$MODEL" "$(cat "$PROMPT_PATH")" \
      >> "$WORKER_LOG" 2>&1
    EXIT=$?

    # Detect rate-limit pattern in last 100 lines
    if tail -100 "$WORKER_LOG" | grep -qiE "rate.?limit|usage.?limit|quota.?exceeded|429"; then
      echo "[$(date)] WORKER $SLOT RATE-LIMIT detected · session=$SESSION_ID exit=$EXIT" >> "$WORKER_LOG"
      echo "[$(date)] WORKER $SLOT RATE-LIMIT detected · session=$SESSION_ID" >> "$SUPERVISOR_LOG"
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
