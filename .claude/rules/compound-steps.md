# Compound steps · ONE tool call per logical step (v0.7.0 mechanical enforcement)

The autonomous loop runs in a Claude-Code-style agent session with a hard 100-turn safety limit (`Reached maximum number of turns`). Every turn = one model invocation = the assistant's response + any tool calls inside it. A "natural" implementation pattern (one Bash per shell command, one Read per file, one Edit per change) easily blows past 100 for non-trivial tasks.

**The compound-steps rule:** each logical step in `.claude/loop.md` is exactly ONE tool call that does the entire step's work via a bash heredoc, multi-statement psql, or batched MCP call. Splitting a logical step across multiple tool calls is a defect against this rule.

## The mapping · step → required tool shape

| Step | Required shape | What's BANNED |
|---|---|---|
| STEP 0 (bootstrap) | ONE bash heredoc that does probe + GC + toolchain + clone + env + capability + counter init + STEP 1 fold. Outputs structured JSON the agent parses. | Multiple bash calls for sub-steps (0a, 0a.1, 0a.2, 0b, 0c, 0d). Each `if [ -d ... ]; then` lives in the same heredoc. |
| STEP 2 (boot reads) | ONE bash heredoc that `cat`s all 5 files into one stream. | 5 separate `Read` tool calls. The agent parses section headers (`===== filename =====`) to separate. |
| STEP 3 (claim) | ONE bash call running `psql` with multi-statement transaction (CTE-claim + UPDATE-RETURNING + TaskRun INSERT). | Separate SELECT/UPDATE/INSERT round trips. |
| STEP 4 (impl, contextBundle=null) | ONE `Agent(subagent_type="Explore")` first, THEN Write/Edit. | Read/Grep/Bash for exploration in parent session before the Agent returns. |
| STEP 5 (review) | ONE assistant message containing ALL parallel `Agent` tool-use blocks. Scorer is a second batch (1 more turn). | Spawning review agents one at a time across multiple messages. |
| STEP 6c (browser val) | ONE Chrome MCP `browser_batch` (or ≤3 calls if no batch available). | Separate navigate / find / read_page / Lighthouse / axe-core calls in sequence. |
| STEP 8 (close-out) | ONE bash heredoc that does the close-out psql transaction + build-log append + loop-lock stamp. | Three separate calls for transaction / file append / file write. |

## What makes a step "compound"

A compound step is recognizable by:

1. ONE entry in the message's tool-use list
2. Internal multi-statement-ness (heredoc, `;` separator, batched MCP)
3. Self-contained: the step succeeds or fails atomically from the agent's perspective
4. Structured output the agent can parse downstream (JSON, section markers)

## Why prose doesn't suffice

LLM agents have strong tool-use defaults: one tool call per logical sub-step. Prose saying "bundle these" doesn't override the default; agents follow patterns from training, not instructions in the prompt. Mechanical enforcement comes from:

- This rule, cited explicitly at every relevant `.claude/loop.md` step
- The `/tmp/mapsly-turn-counter` budget that mechanically forces premature exit when the agent ignores the rule
- The TaskRun.notes audit trail post-mortem: defects accumulate and process-enhancer surfaces them

## When to break the rule

- Tool-call ordering depends on the result of a prior call (true dependency, not laziness): split is allowed
- The compound form exceeds reasonable shell-heredoc complexity (>200 lines, nested heredocs that can't be quoted): split is allowed but document why on TaskRun.notes
- A subagent call where parent must wait for verdict before next step: split is unavoidable

In every case, document the split on TaskRun.notes so process-enhancer can audit.

## Cites

- INC-36 (v0.7.0 · prose ≠ enforcement · the lesson that prompted this rule)
- `.claude/rules/no-verify.md` (companion · the same enforcement philosophy)
- `.claude/loop.md` v0.7.0 (every step cites this rule)
- `.claude/rules/agent-orchestration.md` (already established the ONE-MESSAGE batch rule for parallel agents)
