#!/bin/bash
# Mapsly autonomous build loop · launchd tick wrapper.
# Invokes the Claude Code CLI with the loop prompt, logs to ~/.mapsly/logs/.
# Runs natively on macOS, full filesystem access, no sandbox.

set -uo pipefail

PROJECT_DIR="$HOME/Documents/Claude/Projects/mapsly"
LOG_DIR="$HOME/.mapsly/logs"
PROMPT_PATH="$PROJECT_DIR/scripts/launchd/loop-prompt.md"
TICK_LOG="$LOG_DIR/loop-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# Use full path to claude — launchd has a minimal PATH
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
  echo "[$(date)] FAIL · claude CLI not found in PATH or standard locations" >> "$TICK_LOG"
  exit 1
fi

cd "$PROJECT_DIR" || {
  echo "[$(date)] FAIL · project dir missing: $PROJECT_DIR" >> "$TICK_LOG"
  exit 1
}

# Source .env.local so secrets are available (claude reads from current env)
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env.local"
  set +a
fi

# Model selection · always use the latest/strongest Opus available.
# Override via CLAUDE_MODEL env var (loaded from .env.local above) if needed.
# Fallback chain: explicit env → known latest Opus → "opus" alias → CLI default.
MODEL="${CLAUDE_MODEL:-claude-opus-4-6}"

echo "[$(date)] TICK START · claude=$CLAUDE_BIN · model=$MODEL" >> "$TICK_LOG"

# Headless one-shot. --print = non-interactive. Read prompt from file.
"$CLAUDE_BIN" --print --model "$MODEL" "$(cat "$PROMPT_PATH")" \
  >> "$TICK_LOG" 2>&1

EXIT_CODE=$?
echo "[$(date)] TICK END · exit=$EXIT_CODE" >> "$TICK_LOG"
exit $EXIT_CODE
