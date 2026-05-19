---
name: autonomous-build-loop
description: Mapsly autonomous build loop · runs on Claude Pro Max 20x via scheduled tasks (NEVER the API). Maxes out token budget per 5h window. Auto-merges to main when all gates pass. Self-scores 5 dimensions. Loops until 9/10 everywhere.
---

# Autonomous build loop · v3

> **🔒 Constraint:** Pro Max 20x only. **Never** the Anthropic API. The plan covers our cost ceiling.

> **🚀 Throughput rule:** Use **every available token** in the 5h window. Don't conserve. The plan is paid; idle quota is wasted. Stop only when token budget is near-exhausted **or** when 5h elapses (whichever comes first).

> **📦 Ship rule:** When all gates pass, **auto-merge to `main`**. `mapsly.ai` always reflects latest autonomous work. Viktor reviews already-shipped code, not pending PRs.

## The loop · high level

```
┌────────────────────────────────────────────────────┐
│ START SESSION · MANDATORY READS (in this order)    │
│  1. .claude/memory/incidents.md ← every entry      │
│  2. .claude/rules/incident-prevention.md           │
│  3. CLAUDE.md                                      │
│  4. PLAN.md                                        │
│  5. .claude/memory/MEMORY.md                       │
│  6. .claude/memory/build-log.md (tail 200 lines)   │
│  7. git pull --ff-only origin main                 │
│  8. Session deadline = now + 5h                    │
│  9. Token budget = Pro Max 20x quota               │
│  10. Cost ceiling per call = $5 (permissions.md)   │
│                                                    │
│  Skipping the incidents read is a defect.          │
│  Every incident has a fix you must apply if the    │
│  symptom appears — do NOT re-discover.             │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ PICK NEXT TASK                                     │
│  Read PLAN.md → find first row where:              │
│   - status: pending                                │
│   - all deps: completed                            │
│   - not tagged human-required                      │
│   - effort fits remaining budget                   │
│  Update PLAN.md status: in_progress · commit       │
│  Branch: auto/2026-MM-DD-{phase-id}-{n}            │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ ORCHESTRATE                                        │
│  M+ tasks: spawn research agents in parallel       │
│  S tasks: skip research, implement directly        │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ IMPLEMENT · phase by phase                         │
│  After each phase:                                 │
│   - code-reviewer (always)                         │
│   - test-writer (if logic-heavy)                   │
│   - performance-auditor (if route changed)         │
│   - ux-reviewer-smb (if /(smb)/ touched)           │
│   - ux-reviewer-agency (if /(agency)/ touched)     │
│   - copy-reviewer (if copy strings changed)        │
│   - /deploy-check                                  │
│  If clean: commit                                  │
│  If failing: log + halt this task, pick next       │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ SCORE                                              │
│  Spawn scorer agent. Get 5-dim scorecard.          │
│  Append row to PLAN.md.                            │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ AUTO-MERGE GATE                                    │
│  ALL of these must be true to auto-merge:          │
│   - aggregate score ≥ 9.0                          │
│   - min cell ≥ 8.0                                 │
│   - deploy-check passed                            │
│   - code-reviewer APPROVE                          │
│   - performance-auditor pass (if applicable)       │
│   - ux-reviewer-* APPROVE (if applicable)          │
│   - copy-reviewer APPROVE (if applicable)          │
│   - GitHub Actions CI green                        │
│   - Vercel preview deployed cleanly                │
│   - No new Sentry errors on preview                │
│                                                    │
│  YES → squash-merge to main · auto-delete branch   │
│  NO  → leave PR open · tag Viktor · move on        │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ BUDGET CHECK                                       │
│  Estimate next task cost (~50–150k tokens for M)   │
│  Check token budget remaining (current usage / max)│
│  Check time remaining (5h - elapsed)               │
│                                                    │
│  If (tokens > 100k available) AND (time > 30min):  │
│   → PICK NEXT TASK                                 │
│  Else → WRAP UP                                    │
└────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│ WRAP UP                                            │
│  1. Push final state                               │
│  2. Append session summary to build-log.md         │
│  3. Update dev.mapsly.ai dashboard data            │
│  4. Exit cleanly                                   │
└────────────────────────────────────────────────────┘
```

## Token budget · Pro Max 20x

The Pro Max 20x plan delivers ~20× the message volume of a Pro plan per 5h rolling window. The exact token quota varies by model, but the operating rule is:

- **Use it all.** The plan is fixed cost. Idle quota = wasted money.
- **Don't pace artificially.** If a task fits, take it.
- **Reserve ~10% for wrap-up.** Final commit, build-log update, dashboard push.
- **Watch for the rate-limit indicator.** Claude surfaces approaching-limit warnings — when you see one, finish the current task cleanly and exit.

### Budget heuristics per task type

| Task effort | Token estimate | Approx duration                         |
| ----------- | -------------- | --------------------------------------- |
| S (≤ 1h)    | 30–80k         | 10–20 min                               |
| M (1–3h)    | 80–200k        | 30–90 min                               |
| L (3–8h)    | 200–500k       | not done autonomously — flag for Viktor |

For a 5h window, expect 4–8 M-sized tasks per session.

### Halt conditions (token-aware)

Stop immediately if:

- Approaching rate-limit indicator visible
- Last task consumed > 2× its estimated tokens (signal of model thrashing or task complexity creep)
- Three consecutive task failures
- Any single API call estimated > $5 not yet approved
- Git push fails
- Any `.env.local` or secret file would need to change
- Disk usage > 80%

Halt always: append to build-log with reason, exit clean.

## CLOSE SESSION · mandatory steps (in this order)

Before the loop exits — even on a clean stop, even when the session ran perfectly — these must run:

1. **Sweep for new incidents.** Review every failure encountered this session (failed test, failed deploy, failed agent invocation, sandbox limitation, API quirk). For each:
   - Check `.claude/memory/incidents.md` — is this already logged?
   - If yes: cite the existing INC- ID in `build-log.md` (so process-enhancer can count recurrences)
   - If no: append a new INC- entry following the format in `.claude/rules/incident-prevention.md`. **No exceptions.** A failure with no incident entry is a leaked lesson.
2. **Update rules where appropriate.** If an incident's prevention belongs in an existing rule file (e.g., a Prisma quirk goes in `.claude/rules/database.md`), edit that rule and mark the incident's `Where encoded:` line accordingly.
3. **Run process-enhancer agent.** It clusters today's incidents, looks for patterns of 3+ similar entries, and opens a self-improvement PR if warranted.
4. **Append session entry to `build-log.md`** with the schema below.
5. **Write session JSON** to `.claude/memory/sessions/{date}-{n}.json` so the dashboard can render the timeline.
6. **Commit + push** any rule/memory updates as part of the session's last PR (or as a stand-alone `chore: session N memory updates` commit).

Skipping any of these is a defect. The whole point of the system is institutional learning — without close-session sweep, every session starts from zero.

## Auto-merge policy

Before this version: every PR waited for Viktor. **Now: when gates pass, the loop merges itself.**

### Why auto-merge

- `mapsly.ai` always reflects latest autonomous work
- Viktor reviews _after the fact_ via dev.mapsly.ai dashboard + GitHub history
- Removes the bottleneck (Viktor can't review 4 PRs/day in real time)
- Quality gates are strict enough — if they pass, merging is safe

### Auto-merge gate criteria (all must pass)

1. **Scorer aggregate ≥ 9.0**
2. **Scorer min cell ≥ 8.0** (no single dimension below 8)
3. **deploy-check passed** (format · typecheck · lint · build · cost audit)
4. **code-reviewer verdict: APPROVE**
5. **performance-auditor: no FAIL** (only ≥ budget metrics)
6. **ux-reviewer-{smb|agency}: APPROVE** (if route changed)
7. **copy-reviewer: APPROVE** (if copy changed)
8. **GitHub Actions CI green** (lint/test/build workflow)
9. **Vercel preview deploy succeeded**
10. **No new Sentry errors on preview within 60s of deploy**

If even one fails → leave PR open, tag Viktor with `needs-review`, dashboard shows it.

### What auto-merge does

1. Squash-merge the PR (one clean commit on main)
2. Delete the `auto/...` branch
3. Vercel auto-deploys main to mapsly.ai
4. Update PLAN.md row to `completed` with merge commit hash
5. Update dashboard's "last shipped" feed
6. Move on to the next task

### Safety nets

- **Rollback skill:** if a production deploy triggers Sentry errors within 5 min, the loop opens a revert PR and auto-merges THAT (revert is always safe).
- **Daily diff digest:** Viktor gets a once-a-day GitHub email summarizing every auto-merge, with score table per PR. Easy to scan.
- **The dashboard.** `dev.mapsly.ai` shows everything — Viktor can spot drift in real time.
- **Branch protection still on `main`** — only the loop's GitHub App token can merge (via auto-merge), not direct push. CI is still the gate.

## Self-awareness · the dashboard

Every session writes data the dashboard reads:

- `.claude/memory/build-log.md` — append-only diary of sessions
- `.claude/memory/sessions/{date}-{n}.json` — structured machine-readable session data (tokens used, tasks shipped, scores, failures)
- DB tables (`CronRun`, autonomous-build tracking added in Phase 1.10)
- GitHub PR + commit history

The orchestrator reads the dashboard at session start. If the dashboard shows recurring failures, the loop's first action is to address them (not pick a new feature task).

## Process-enhancer integration

A separate agent (`process-enhancer`) runs daily. Reads:

- build-log patterns
- scorer trends (which dimensions consistently low?)
- CronRun cost trends
- Failed PR reasons
- Sentry pattern frequency

When it spots a pattern, it opens a PR against `.claude/rules/` or `.claude/agents/` to refine the system. Example:

- "Performance dim consistently 7/10 across the last 5 phases" → propose stricter `performance.md` thresholds
- "ux-reviewer-smb keeps flagging same jargon" → add to banned-word list in `copy-voice.md`
- "DataForSEO timeouts cluster Mondays 9-11 UTC" → propose rate-limit window in `services/dataforseo/`

Process-enhancer PRs go through the same auto-merge gates as feature PRs.

## What NOT to do autonomously

- ❌ Push to `main` directly (PR + auto-merge only)
- ❌ Modify `.env.local` / secret files
- ❌ Modify `MEMORY.md` (Viktor-only) or `feedback/*.md`
- ❌ Delete `_design/`
- ❌ Modify `prisma/schema.prisma` non-additively (column rename/drop)
- ❌ Run `prisma migrate dev`
- ❌ Add new external API integrations beyond `.env.example`
- ❌ Approve API calls > $5 (open GitHub issue, wait for /approve)
- ❌ Open more than 5 PRs concurrently if any are waiting on Viktor review (`needs-review` tag)
- ❌ Use the Anthropic API

## Session log format · `.claude/memory/sessions/{date}-{n}.json`

```json
{
  "sessionId": "2026-05-19-A",
  "startedAt": "2026-05-19T14:00:00Z",
  "endedAt": "2026-05-19T18:52:00Z",
  "durationSec": 17520,
  "tokensUsed": { "input": 2_400_000, "output": 380_000, "total": 2_780_000 },
  "rateLimitWarnings": 0,
  "tasksShipped": [
    {
      "phaseId": "1.3",
      "merged": true,
      "scoreAggregate": 9.4,
      "scoreCells": {
        "completion": 10,
        "quality": 9,
        "audience": 10,
        "relevance": 9,
        "performance": 9
      }
    },
    {
      "phaseId": "1.4",
      "merged": true,
      "scoreAggregate": 9.0,
      "scoreCells": {
        /* ... */
      }
    }
  ],
  "tasksLeftOpenForReview": [
    {
      "phaseId": "1.5",
      "prNumber": 23,
      "reason": "min cell 7 on Audience (jargon found)"
    }
  ],
  "failures": [],
  "followupsOpened": ["FU.1.5.audience"],
  "costApiUsd": 0,
  "exitReason": "token-budget-low"
}
```

The dashboard reads these to render the timeline.

## When to stop forever

When ALL of:

- Every PLAN.md phase has `status: completed`
- Every score row has aggregate ≥ 9.0
- Backlog is empty or all entries < S
- No `needs-review` PRs older than 3 days

The loop writes a final celebration to build-log, posts a final PR titled "🎯 PLAN.md complete · all phases shipped 9+", and exits. The scheduled task can be paused at that point — though leaving it running is fine too (it'll pick up Viktor-added tasks).
