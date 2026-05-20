#!/bin/bash
# Mapsly launchd loop · uninstaller
#
# Run this once after pivoting to `/loop` as the canonical scheduler.
# Leaves the repo wrapper + plist files in place for reference, but
# unloads the agent so it stops firing in the background.

set -uo pipefail

LABEL="ai.mapsly.loop"
UID_NUM="$(id -u)"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_RUNNER="$HOME/.mapsly/loop-runner"
LEGACY_WRAPPER="$HOME/.mapsly/loop-tick.sh"

echo "→ Mapsly launchd uninstall"

# Unload the agent if present
if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "→ Unloading agent gui/$UID_NUM/$LABEL"
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || \
    launchctl unload "$PLIST_DST" 2>/dev/null || true
else
  echo "  Agent already not loaded"
fi

# Remove the installed plist
if [ -f "$PLIST_DST" ]; then
  echo "→ Removing $PLIST_DST"
  rm -f "$PLIST_DST"
fi

# Clean up legacy files
for f in "$LEGACY_RUNNER" "$LEGACY_WRAPPER"; do
  if [ -f "$f" ]; then
    echo "→ Removing $f"
    rm -f "$f"
  fi
done

echo ""
echo "✓ launchd loop uninstalled."
echo "  Logs at ~/.mapsly/logs/ kept for reference (delete if you want)."
echo ""
echo "  Canonical scheduler is now /loop inside an open Claude Code session."
echo "  In your terminal:"
echo "    cd ~/Documents/Claude/Projects/mapsly"
echo "    claude"
echo "    (inside) /loop 5m"
