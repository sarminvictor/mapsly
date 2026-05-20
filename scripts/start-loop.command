#!/bin/bash
# Mapsly autonomous build loop · one-click launcher
#
# Double-click this file in Finder. macOS opens it in Terminal automatically
# (since .command files default to Terminal.app). It cd's into the project
# and starts Claude Code. Once Claude is at the prompt, type:
#
#     /loop 5m
#
# Then leave the window open. The loop ticks every 5 minutes for 7 days,
# after which you double-click this again + retype /loop 5m.
#
# Why this exists: starting a session is two keystrokes, but seven days
# from now you won't remember which directory or which command — the
# launcher removes that friction.

cd "$HOME/Documents/Claude/Projects/mapsly" || {
  echo "✗ Project directory not found at ~/Documents/Claude/Projects/mapsly"
  echo "  Press any key to close."
  read -n 1
  exit 1
}

echo "→ Mapsly autonomous build loop launcher"
echo ""
echo "  Project: $(pwd)"
echo "  Branch:  $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(no git)')"
echo "  Version: $(node -p "require('./package.json').version" 2>/dev/null || echo '?')"
echo ""
echo "  Starting Claude Code session..."
echo "  Once Claude is ready, type:  /loop 5m"
echo "  Then leave this window open."
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Locate claude (same logic as the launchd wrapper)
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
  echo "✗ claude CLI not found · install via brew or https://claude.com/code"
  echo "  Press any key to close."
  read -n 1
  exit 1
fi

# Start Claude Code in interactive mode. exec replaces this script so
# the user's session IS the Claude Code session.
exec "$CLAUDE_BIN"
