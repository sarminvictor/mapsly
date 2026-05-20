# Agent orchestration · concurrency budget + sequencing

The autonomous loop spawns many agents per task. Without discipline, this trips rate limits and produces inconsistent verdicts. This rule constrains both **how many** fire in parallel and **which order** they must run.

## Concurrency budget

Per task, the orchestrator MUST cap parallel agent invocations:

| Phase                           | Default cap | When to override                                           |
| ------------------------------- | ----------: | ---------------------------------------------------------- |
| Research (M+ tasks)             |       **6** | Genuinely novel domain → spec `depth: thorough` for cap 10 |
| Research (S tasks)              |       **3** | Skip research entirely for trivial fixes                   |
| Review (any task)               |       **5** | XL tasks touching ≥ 5 files → cap 8                        |
| Browser validation (multi-user) |       **4** | One per user-type (anon/SMB/agency/admin) max              |

Stagger launches by 500ms within a batch to smooth token-rate spikes. Anthropic's API rate limit is 50 req/min on Sonnet; bursting 16 agents at t=0 trips it inside one task.

If > cap is genuinely needed, **split**: launch first cap, `await` results, spawn next batch. Do not blow the budget.

## Sequencing rules · mandatory order

Some agents MUST run in sequence because later agents need the earlier verdicts:

| Earlier                  | Later                                 | Why                                  |
| ------------------------ | ------------------------------------- | ------------------------------------ |
| `code-reviewer`          | `scorer`                              | Scorer reads code-review verdict     |
| `test-writer`            | `performance-auditor`                 | New tests inform performance budget  |
| `ux-reviewer-{audience}` | `copy-reviewer`                       | Copy review needs the chosen wording |
| `security-auditor`       | `payments-auditor` (if billing route) | Security scope is broader            |
| Any reviewer             | `scorer` (always last)                | Scorer aggregates                    |

When two agents conflict on the same files (e.g. security-auditor + payments-auditor both lint `app/api/webhooks/stripe/`), run them sequentially — concurrent invocations produce inconsistent verdicts.

## Token-aware scheduling

Before launching a batch, estimate input token cost:

```
batch_tokens ≈ Σ (agent input prompt tokens × files_in_scope)
```

If `batch_tokens > 0.4 × remaining_session_budget`, defer half the batch to a follow-up session and log it as a TaskRun.notes entry. Don't blow the 5h window on research.

## Backpressure pattern

When `await Promise.all([...agents])` is used, any slow agent stalls all the others' value. For research where order doesn't matter, use `Promise.allSettled` so partial results are usable even if one agent times out.

## Idempotency

Each agent invocation should be deterministic given identical inputs. The loop records inputs to `AgentInvocation.inputSummary` so a failed run can be replayed without re-running upstream work.

## Failure handling per agent

| Failure mode                             | Response                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Agent times out (> 5 min)                | Mark `AgentInvocation.status = TIMED_OUT`, capture partial output if any, continue with degraded scoring |
| Agent returns malformed output           | Retry once with explicit format reminder; on second fail, mark FAILED and use default verdict            |
| Agent crashes (exception in tool)        | Capture stack to `errorMessage`, mark FAILED, skip — do not block the task on a single agent             |
| Multiple agents (≥ 3) fail in same batch | Halt the task; this signals infra issue. Set cooldown 1h.                                                |

## Tracing

Every agent invocation creates an `AgentInvocation` row with:

- `taskRunId` (foreign key)
- `agentName`, `startedAt`, `finishedAt`, `durationMs`
- `inputSummary` (first 2KB of prompt)
- `outputSummary` (first 4KB of response)
- `tokensInput`, `tokensOutput`, `costUsd`
- `verdict`: PASS / WARN / FAIL / NEUTRAL
- `scoreReturned` (when scoring agent)
- `filesReviewed`: JSON array of paths

The `/dev/tasks/[id]` detail page renders a span tree per TaskRun — like Honeycomb traces — so Viktor sees every agent's contribution.

## Replayability

Given a failed TaskRun, the loop can rebuild the exact agent inputs from `AgentInvocation.inputSummary` records and re-run a single failed agent without redoing the whole task. This pattern beats most production multi-agent systems.

## Anti-patterns

- ❌ Launching 16 agents at t=0 (rate-limit trip)
- ❌ Scorer firing before code-reviewer (no upstream verdict to aggregate)
- ❌ Parallel security-auditor + payments-auditor on same files (verdict conflicts)
- ❌ `Promise.all` for research (one slow agent blocks all)
- ❌ Not capturing AgentInvocation rows (debugging impossible)
- ❌ Re-running entire task when one agent failed (waste — only re-run the failed agent)
