# No-verify · trust the tool · ban post-write verification turns

The single highest-volume source of avoidable turn waste in the loop's v0.6.x history was post-write verification: the agent writes a file via `Write` / `Edit`, then runs `wc -l file`, `ls -la dir`, `cat file | head`, or `find . -name file` to "make sure it worked". This is **never** valuable.

## The rule

After any `Write`, `Edit`, or successful bash that creates/modifies a file:

**DO NOT** invoke any tool whose only purpose is to confirm the write happened. Specifically:

- ❌ `wc -l <just-written-file>`
- ❌ `ls -la <just-written-file or its dir>`
- ❌ `cat <just-written-file> | head`
- ❌ `find . -name <just-written-file>`
- ❌ `stat <just-written-file>`
- ❌ "Let me verify the file is correct" → any Read tool call on a file you just wrote
- ❌ Re-running prettier/typecheck "just to confirm"

## Why

- The `Write` tool throws on failure (file system error, permission denied, disk full). Success means the file is on disk.
- The `Edit` tool throws on failure (old_string not found, file unchanged, file write error). Success means the file is changed.
- A bash heredoc `cat > file <<EOF` exits non-zero on failure. The shell already verified.
- Each verify-turn is 1 turn against the 100-turn budget. In pre-v0.7.0 traces, the loop burned 5–10 turns per task on verification alone.

## Allowed exceptions

- Reading a file you wrote in a _prior session_ (state unknown across sessions)
- Reading a file the agent modified _via a subagent_ (caller doesn't have the subagent's verdict yet)
- Reading a file that another bash call may have raced with (concurrent processes)
- Reading the OUTPUT of a build/test that was supposed to compile your code (e.g., `next build` exit code) — this IS verification but of the build, not the write

## How it shows up in defects

A TaskRun whose `turns` count exceeds the budget AND whose bash history contains `wc -l`/`ls`/`cat`/`find`/`stat` calls referencing files the same TaskRun just wrote = defect against this rule. Process-enhancer flags it via the `incident-recurrence` signal on INC-36.

## Why prose doesn't fix this without enforcement

LLM agents are trained on patterns where "verify your work" is a virtue. Telling the agent "don't verify" in prose doesn't change the pattern; it just adds context the agent then rationalizes around ("but THIS time I really should check…"). The mechanical fix is the `/tmp/mapsly-turn-counter` budget combined with this rule cited at every step boundary — when budget is tight, the verifies are the first thing cut.

## Cites

- INC-36 (v0.7.0 · prose ≠ enforcement)
- `.claude/skills/autonomous-build-loop/rules/compound-steps.md` (the other half of the enforcement model)
- `.claude/loop.md` STEP 4, STEP 6, STEP 8 — every one cites this rule
