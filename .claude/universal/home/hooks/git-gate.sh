#!/bin/bash
# git-gate.sh - universal PreToolUse hook on Bash: blocks 'git push' unless approved.
# Approval: /ship touches /tmp/claude-ship-approved (valid 30 min), or CLAUDE_AUTOPUSH_OK=1 (opted-in loop).
# Fail-open: any parse error exits 0 so normal work never breaks.
set -u
payload=""
if [ ! -t 0 ]; then payload=$(cat 2>/dev/null || true); fi
if [ -z "$payload" ] && [ -n "${TOOL_INPUT:-}" ]; then payload="$TOOL_INPUT"; fi
[ -z "$payload" ] && exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // .command // empty' 2>/dev/null || true)
[ -z "$cmd" ] && exit 0
if ! printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push([[:space:]]|$)'; then exit 0; fi
if [ "${CLAUDE_AUTOPUSH_OK:-0}" = "1" ]; then exit 0; fi
marker=/tmp/claude-ship-approved
if [ -f "$marker" ] && [ -n "$(find "$marker" -mmin -30 2>/dev/null)" ]; then exit 0; fi
echo "BLOCKED by git-gate.sh: 'git push' requires explicit approval. Confirm with Viktor, then use /ship (touches $marker, valid 30 min). Never bypass this gate." >&2
exit 1
