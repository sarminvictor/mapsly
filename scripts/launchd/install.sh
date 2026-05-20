#!/bin/bash
# Mapsly autonomous build loop · one-shot launchd installer.
# Idempotent: re-running re-installs cleanly.

set -euo pipefail

PROJECT_DIR="$HOME/Documents/Claude/Projects/mapsly"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ai.mapsly.loop.plist"
PLIST_SRC="$PROJECT_DIR/scripts/launchd/$PLIST_NAME"
PLIST_DST="$LAUNCHD_DIR/$PLIST_NAME"
WRAPPER_REPO="$PROJECT_DIR/scripts/launchd/loop-tick.sh"
LABEL="ai.mapsly.loop"
UID_NUM="$(id -u)"

echo "→ Mapsly loop · launchd install"

# 1. Sanity checks
if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
  echo "✗ Project not found at $PROJECT_DIR"; exit 1
fi
if [ ! -f "$PLIST_SRC" ]; then
  echo "✗ Plist source missing: $PLIST_SRC · run 'git pull' first"; exit 1
fi
if [ ! -f "$WRAPPER_REPO" ]; then
  echo "✗ Wrapper source missing: $WRAPPER_REPO · run 'git pull' first"; exit 1
fi
# Ensure wrapper is executable in the repo (git permission bit can drift)
chmod +x "$WRAPPER_REPO"
if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.claude/local/claude" ]; then
  echo "⚠ claude CLI not in PATH and not at ~/.claude/local/claude"
  echo "  The wrapper still tries common locations — install will continue."
fi

# 2. Unload any prior version (idempotent)
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "→ Unloading existing agent"
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || \
    launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# 3. Create directories
mkdir -p "$LAUNCHD_DIR"
mkdir -p "$HOME/.mapsly/logs"

# 4. Clean up legacy installed wrapper · we now run from the repo directly
LEGACY_WRAPPER="$HOME/.mapsly/loop-tick.sh"
if [ -f "$LEGACY_WRAPPER" ]; then
  echo "→ Removing legacy installed wrapper at $LEGACY_WRAPPER"
  echo "  (plist now points to the repo wrapper · git pull is enough)"
  rm -f "$LEGACY_WRAPPER"
fi

# 5. Install plist (substitute $HOME for the placeholder · plist points
#    straight at the repo wrapper path, so future updates need only git pull)
echo "→ Installing plist to $PLIST_DST"
sed "s|HOME_PLACEHOLDER|$HOME|g" "$PLIST_SRC" > "$PLIST_DST"

# 6. Bootstrap the agent (modern launchctl API)
echo "→ Bootstrapping agent"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_DST"

# 7. Verify
sleep 1
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "✓ Loaded successfully · $LABEL"
  echo "  Fires every 5 minutes · also at load (now)"
  echo "  Logs: $HOME/.mapsly/logs/"
  echo "  Inspect: launchctl print gui/$UID_NUM/$LABEL"
  echo "  Disable: launchctl bootout gui/$UID_NUM/$LABEL"
else
  echo "✗ Bootstrap reported success but agent isn't running. Check stderr above."
  exit 1
fi

# 8. Tail the first log so the user sees what happened
sleep 2
LATEST_LOG="$(ls -t $HOME/.mapsly/logs/loop-*.log 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_LOG" ]; then
  echo ""
  echo "── First tick output ($LATEST_LOG) ──"
  tail -30 "$LATEST_LOG" || true
fi
