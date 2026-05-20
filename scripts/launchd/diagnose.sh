#!/bin/bash
# Mapsly loop · one-shot diagnostic
# Run on your Mac:  bash ~/Documents/Claude/Projects/mapsly/scripts/launchd/diagnose.sh
# Prints everything needed to answer "why isn't the loop running?"

set -u

PROJECT_DIR="$HOME/Documents/Claude/Projects/mapsly"
WRAPPER="$HOME/.mapsly/loop-tick.sh"
LOG_DIR="$HOME/.mapsly/logs"
PLIST="$HOME/Library/LaunchAgents/ai.mapsly.loop.plist"
LABEL="ai.mapsly.loop"
UID_NUM="$(id -u)"

sep() { echo; echo "────────── $1 ──────────"; }

sep "1 · launchd agent state"
if launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | head -40; then
  echo "(agent is loaded)"
else
  echo "✗ Agent NOT loaded · run scripts/launchd/install.sh first"
fi

sep "2 · plist file"
ls -la "$PLIST" 2>/dev/null || echo "✗ no plist at $PLIST"

sep "3 · wrapper script (installed copy)"
ls -la "$WRAPPER" 2>/dev/null || echo "✗ no wrapper at $WRAPPER"
if [ -f "$WRAPPER" ]; then
  echo "    size:    $(wc -c < "$WRAPPER") bytes"
  echo "    repo:    $(wc -c < "$PROJECT_DIR/scripts/launchd/loop-tick.sh") bytes"
  if ! diff -q "$WRAPPER" "$PROJECT_DIR/scripts/launchd/loop-tick.sh" >/dev/null 2>&1; then
    echo "    ⚠ installed wrapper DIFFERS from repo · re-run install.sh"
  else
    echo "    ✓ matches repo"
  fi
fi

sep "4 · claude CLI"
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
  for try in "$HOME/.claude/local/claude" "$HOME/.local/bin/claude" "/opt/homebrew/bin/claude" "/usr/local/bin/claude"; do
    if [ -x "$try" ]; then CLAUDE_BIN="$try"; break; fi
  done
fi
if [ -n "$CLAUDE_BIN" ]; then
  echo "✓ found: $CLAUDE_BIN"
  "$CLAUDE_BIN" --version 2>&1 | head -3
else
  echo "✗ claude CLI not found on PATH or in common locations"
fi

sep "5 · log directory contents"
if [ -d "$LOG_DIR" ]; then
  ls -laht "$LOG_DIR" | head -20
else
  echo "✗ no log dir at $LOG_DIR"
fi

sep "6 · last 60 lines of launchd stderr"
LAUNCHD_ERR="$LOG_DIR/launchd.err.log"
if [ -s "$LAUNCHD_ERR" ]; then
  tail -60 "$LAUNCHD_ERR"
else
  echo "(empty or missing — good sign IF the loop is running, bad sign if it's not)"
fi

sep "7 · last 60 lines of supervisor log"
SUPER_LOG="$(ls -t "$LOG_DIR"/supervisor-*.log 2>/dev/null | head -1)"
if [ -n "$SUPER_LOG" ]; then
  echo "file: $SUPER_LOG"
  tail -60 "$SUPER_LOG"
else
  echo "✗ no supervisor log — wrapper has never run, or never wrote anything"
fi

sep "8 · last 60 lines of most-recent worker log"
WORKER_LOG="$(ls -t "$LOG_DIR"/worker-*.log 2>/dev/null | head -1)"
if [ -n "$WORKER_LOG" ]; then
  echo "file: $WORKER_LOG"
  tail -60 "$WORKER_LOG"
else
  echo "✗ no worker log — wrapper has never spawned a worker"
fi

sep "9 · loop-lock.json"
LOCK="$PROJECT_DIR/.claude/memory/loop-lock.json"
if [ -f "$LOCK" ]; then
  cat "$LOCK"
else
  echo "✗ no lock file"
fi

sep "10 · manual test fire"
echo "Running wrapper manually (without launchd) so we see immediate output..."
echo "(this also writes a fresh tick to logs)"
if [ -x "$WRAPPER" ]; then
  bash "$WRAPPER" 2>&1 | tail -30
  echo ""
  echo "After manual fire:"
  ls -laht "$LOG_DIR" | head -8
else
  echo "✗ wrapper not executable"
fi

sep "done · paste this entire output back to Claude"
