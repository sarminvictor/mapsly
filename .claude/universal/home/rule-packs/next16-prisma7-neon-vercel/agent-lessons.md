# Agent-harness lessons · portable principles

Hard-won lessons about running Claude Code / agent-SDK sessions autonomously (schedulers, loops, subagents). Stack-independent but earned on this stack; INC ids cite the originating product's incident log.

## 1 · Pin the model explicitly (INC-16)

Any wrapper that invokes the CLI headless MUST pass `--model` (and effort level) explicitly. Inheriting the user's CLI default is fragile — it can be a different, weaker model on every machine, and quality degradation is silent. Make the pin an env var with a documented default.

## 2 · Headless sessions need permission flags (INC-19, INC-20)

`claude --print` without a TTY blocks (or silently auto-denies) on every tool-approval prompt — the session emits planning text and produces ZERO side effects. Headless invocations MUST include `--dangerously-skip-permissions`. Companion lesson (INC-20): schedulers must point at the canonical script in version control, never an installed copy — copies go stale silently. Stamp a heartbeat (`lastTickAt`) unconditionally at the top of every tick so "is the scheduler firing?" is answerable from data.

## 3 · Turn budget · compound steps (INC-35)

Sessions have a hard turn cap (~100); one turn = one model invocation including its tool calls. The natural pattern (one Bash per command, one Read per file) blows the cap on non-trivial tasks. Discipline:

- **ONE tool call per logical step** — bash heredoc, multi-statement SQL, batched MCP call. N calls where 1 suffices is a defect.
- **Poll with exponential backoff inside a single bash call** (sleeps inside the script cost 0 turns) — never one tool call per poll.
- **Ban same-session retries.** On failure, persist state (branch, run row) and exit; the next session resumes. A 5-min wall-clock delay beats a killed session.
- **Checkpoint the budget at step boundaries** and exit gracefully to a resumable state before the cap kills you mid-write.

## 4 · No post-write verification (INC-36)

Write/Edit tools throw on failure; a bash heredoc exits non-zero on failure. Success means the file is on disk. Post-write `wc -l` / `ls` / `cat` / `find` / `stat` / re-reads burn turns for zero information — measured at 5–10 wasted turns per task. Verify the BUILD or TEST that consumes your code, never the write itself. Allowed exceptions: files from a prior session, files a subagent modified, genuine concurrent-writer races.

## 5 · Prose is not enforcement (INC-36, INC-38)

Instructions in a prompt do NOT override training-derived tool-use defaults. Agents read "bundle these reads", acknowledge, then make 17 separate calls anyway — observed repeatedly. If a behavior matters, enforce it mechanically or architecturally:

- **Mechanical:** disk-resident counters checked by bash (not agent memory), force-functions ("the FIRST tool call MUST be X — anything else is a defect"), pre-push hooks, CI greps.
- **Architectural:** if the agent's natural pattern would cost N turns, move the work where the natural pattern is affordable (see §6) instead of asking the agent to be unnatural.

Escalation ladder observed: polite prose → strong prose → mechanical rules → architecture. Only the last one held.

## 6 · Delegate heavy work to subagents (INC-38, INC-39)

Each subagent runs in a fresh conversation with its OWN turn budget and isolated context; the parent pays 1 turn per `Agent` call and receives only the final message. The winning architecture:

- **Parent is orchestration-only:** bash for I/O, `Agent` for everything heavy (exploration, implementation, validation, review). No Read/Grep/Edit in the parent.
- **Subagent prompts are fully self-contained** — the subagent inherits nothing: no history, no tool results. Embed every path, error message, and decision it needs.
- **Subagents cannot spawn subagents** — fan-out happens only from the parent; batch parallel agents in ONE message.
- **Prefer built-in subagent types** (`general-purpose`) over filesystem-defined ones in ephemeral/sandboxed sessions — custom `.claude/agents/` definitions load at session startup only and may be invisible (INC-39).
- **Bookkeeping first:** order close-out writes most-recoverable-first (push the metadata commit BEFORE the DB transaction), so a mid-step kill leaves a resumable state.

## Anti-patterns

- ❌ Headless wrapper without `--model` or `--dangerously-skip-permissions`
- ❌ One tool call per shell command / per file read in a budgeted session
- ❌ `wc -l` / `ls` / `cat` on a file you just wrote
- ❌ Same-session retry loops on CI/build failure
- ❌ "The prompt says so" as the only enforcement of a critical behavior
- ❌ Parent session doing exploration or implementation itself
- ❌ Subagent prompt that assumes shared context with the parent
