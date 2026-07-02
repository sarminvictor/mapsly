#!/bin/bash
# install.sh - installs the universal Claude Code layer into ~/.claude.
# Idempotent: safe to re-run. Touches nothing outside ~/.claude.
# Review the bundle first - nothing takes effect until this script runs.
set -euo pipefail

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.claude"

echo "== Universal layer installer =="
echo "Bundle: $BUNDLE"
echo "Target: $TARGET"
echo

mkdir -p "$TARGET"/{agents,skills,hooks,rule-packs,templates}

# 1 · CLAUDE.md - never overwrite an existing one without a backup
if [ -f "$TARGET/CLAUDE.md" ] && ! cmp -s "$BUNDLE/home/CLAUDE.md" "$TARGET/CLAUDE.md"; then
  bak="$TARGET/CLAUDE.md.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$TARGET/CLAUDE.md" "$bak"
  echo "Backed up existing CLAUDE.md -> $bak"
fi
cp "$BUNDLE/home/CLAUDE.md" "$TARGET/CLAUDE.md"
echo "Installed CLAUDE.md"

# 2 · agents / skills / rule-packs / templates - copy whatever the bundle has
copy_dir() {
  local src="$1" dest="$2" label="$3"
  if [ -d "$src" ] && [ -n "$(ls -A "$src" 2>/dev/null)" ]; then
    cp -R "$src/." "$dest/"
    echo "Installed $label ($(ls -1 "$src" | wc -l | tr -d ' ') files)"
  else
    echo "Skipped $label (nothing in bundle at $src)"
  fi
}
copy_dir "$BUNDLE/home/agents"     "$TARGET/agents"     "agents"
copy_dir "$BUNDLE/home/skills"     "$TARGET/skills"     "skills"
copy_dir "$BUNDLE/home/rule-packs" "$TARGET/rule-packs" "rule-packs"
copy_dir "$BUNDLE/templates"       "$TARGET/templates"  "templates"

# 3 · git-gate hook (must be executable)
cp "$BUNDLE/home/hooks/git-gate.sh" "$TARGET/hooks/git-gate.sh"
chmod +x "$TARGET/hooks/git-gate.sh"
echo "Installed hooks/git-gate.sh (+x)"

# 4 · settings.json merge (writes its own settings.json.bak-<pid> first)
cp "$BUNDLE/home/settings-merge.py" "$TARGET/settings-merge.py"
python3 "$BUNDLE/home/settings-merge.py"

cat <<'CHECKLIST'

== Post-install checklist ==
1. Restart Claude Code - settings, hooks, and ~/.claude/CLAUDE.md load at startup.
2. In any project, type /ship - it should appear in the skill list.
3. Run /mcp (or `claude mcp list`) - every MCP server should list its tools.
4. In a scratch repo, try `git push` WITHOUT approval - git-gate.sh should block it.
5. For each product repo: copy ~/.claude/templates/{product.md,product-spec.json,guardrails.json}
   into <repo>/.claude/ and replace every placeholder.

Uninstall instructions: README.md next to this script.
CHECKLIST
