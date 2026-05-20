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

# 4. Clean up legacy installed wrapper · we run wrapper from repo now
LEGACY_WRAPPER="$HOME/.mapsly/loop-tick.sh"
if [ -f "$LEGACY_WRAPPER" ]; then
  echo "→ Removing legacy installed wrapper at $LEGACY_WRAPPER"
  rm -f "$LEGACY_WRAPPER"
fi

# 5. Install loop-runner · a personal copy of /bin/bash that can be added
#    to Full Disk Access via the GUI file picker (see INC-21).
#    /bin/bash itself is hidden from the picker because it's a system binary.
LOOP_RUNNER="$HOME/.mapsly/loop-runner"
echo "→ Installing loop-runner (copy of /bin/bash) to $LOOP_RUNNER"
cp -f /bin/bash "$LOOP_RUNNER"
chmod +x "$LOOP_RUNNER"

# 6. Install plist (substitute $HOME for the placeholder)
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

# 8. Check if Full Disk Access is already granted to the runner
#    by attempting to read .env.local from launchd's context.
sleep 2
NEEDS_FDA=0
if launchctl asuser "$UID_NUM" "$LOOP_RUNNER" -c "test -r '$PROJECT_DIR/.env.local'" 2>/dev/null; then
  echo "✓ Loop-runner can read project files · TCC permissions look good."
else
  NEEDS_FDA=1
fi

# Tail the most recent log (supports both old loop-*.log and new supervisor-*.log)
LATEST_LOG="$(ls -t "$HOME/.mapsly/logs/"supervisor-*.log "$HOME/.mapsly/logs/"loop-*.log 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_LOG" ]; then
  echo ""
  echo "── Latest log tail ($LATEST_LOG) ──"
  tail -10 "$LATEST_LOG" || true
fi

# 9. One-time Full Disk Access grant flow
if [ "$NEEDS_FDA" = "1" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  ⚠️  ONE-TIME · GRANT FULL DISK ACCESS"
  echo "═══════════════════════════════════════════════════════════════════"
  echo ""
  echo "  macOS blocks launchd-spawned processes from reading ~/Documents/"
  echo "  unless you explicitly grant Full Disk Access."
  echo ""
  echo "  STEP 1 · Copy this path to your clipboard:"
  echo "    $LOOP_RUNNER"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$LOOP_RUNNER" | pbcopy
    echo "    ✓ Already copied · just paste into the file picker"
  fi
  echo ""
  echo "  STEP 2 · Opening System Settings → Privacy & Security → Full Disk Access"
  echo "          Click the + button, press Cmd+Shift+G, paste the path above,"
  echo "          press Enter, click 'Open'. Toggle should be ON."
  echo ""
  echo "  STEP 3 · After granting, kick the agent to verify:"
  echo "    launchctl kickstart -k gui/$UID_NUM/$LABEL"
  echo "    sleep 5 && ls -laht ~/.mapsly/logs/ | head -5"
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"

  # Open the System Settings pane (Sequoia URL scheme)
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || \
    open "/System/Library/PreferencePanes/Security.prefPane" 2>/dev/null || true
else
  echo ""
  echo "✓ Loop installed and active · ticks every 5 min · check dev.mapsly.ai"
fi
