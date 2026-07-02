#!/usr/bin/env python3
"""settings-merge.py - safely merge universal entries into ~/.claude/settings.json.

Adds:
  - permissions.ask:  "Bash(git push:*)"
  - permissions.deny: "Edit(.env*)", "Write(.env*)", "Edit(**/.env*)", "Write(**/.env*)"
  - hooks.PreToolUse: { matcher: "Bash", hooks: [{ type: "command",
                        command: "/Users/Viktor/.claude/hooks/git-gate.sh" }] }

Idempotent - re-running never duplicates entries. Everything already in the file
is preserved. A backup is written to settings.json.bak-<pid> before any change.
Aborts (exit 1) without touching anything if the existing file is not valid JSON.
"""

import json
import os
import shutil
import sys

SETTINGS = os.path.expanduser("~/.claude/settings.json")
HOOK_CMD = os.path.expanduser("~/.claude/hooks/git-gate.sh")
ASK_ENTRIES = ["Bash(git push:*)"]
DENY_ENTRIES = ["Edit(.env*)", "Write(.env*)", "Edit(**/.env*)", "Write(**/.env*)"]


def main() -> int:
    if os.path.exists(SETTINGS):
        try:
            with open(SETTINGS, "r", encoding="utf-8") as f:
                settings = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"ABORT: could not parse {SETTINGS}: {e}", file=sys.stderr)
            print("Nothing was changed. Fix the JSON by hand, then re-run.", file=sys.stderr)
            return 1
        if not isinstance(settings, dict):
            print(f"ABORT: {SETTINGS} is not a JSON object. Nothing was changed.", file=sys.stderr)
            return 1
        backup = f"{SETTINGS}.bak-{os.getpid()}"
        shutil.copy2(SETTINGS, backup)
        print(f"Backup written: {backup}")
    else:
        settings = {}
        os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
        print(f"{SETTINGS} does not exist - creating it.")

    changed = False

    # permissions.ask + permissions.deny
    permissions = settings.setdefault("permissions", {})
    for key, entries in (("ask", ASK_ENTRIES), ("deny", DENY_ENTRIES)):
        existing = permissions.setdefault(key, [])
        for entry in entries:
            if entry not in existing:
                existing.append(entry)
                changed = True
                print(f"Added permissions.{key}: {entry}")

    # hooks.PreToolUse - one Bash matcher running git-gate.sh
    hooks = settings.setdefault("hooks", {})
    pre_tool_use = hooks.setdefault("PreToolUse", [])
    already_wired = any(
        isinstance(matcher_entry, dict)
        and any(
            isinstance(h, dict) and h.get("command") == HOOK_CMD
            for h in matcher_entry.get("hooks", [])
        )
        for matcher_entry in pre_tool_use
    )
    if not already_wired:
        hook_entry = {"type": "command", "command": HOOK_CMD}
        bash_matcher = next(
            (
                m
                for m in pre_tool_use
                if isinstance(m, dict) and m.get("matcher") == "Bash"
            ),
            None,
        )
        if bash_matcher is not None:
            bash_matcher.setdefault("hooks", []).append(hook_entry)
        else:
            pre_tool_use.append({"matcher": "Bash", "hooks": [hook_entry]})
        changed = True
        print(f"Added hooks.PreToolUse Bash -> {HOOK_CMD}")

    if changed:
        with open(SETTINGS, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
            f.write("\n")
        print(f"Merged into {SETTINGS}")
    else:
        print("Nothing to do - all entries already present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
