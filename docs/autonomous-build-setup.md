# Autonomous build setup

How to wire up Claude Code (cloud) to build Mapsly autonomously on a schedule, 24/7, with self-awareness and 5h-session discipline.

## Mental model

- **Claude Code cloud** = a hosted instance of Claude Code that runs on a schedule. Like a cron job, but the worker is a Claude agent.
- **`autonomous-build-loop` skill** = the brain. Tells Claude what to do when it starts a session.
- **`PLAN.md`** = the roadmap. Source of truth for "what to build next."
- **`.claude/memory/build-log.md`** = the diary. Tracks what each session accomplished.
- **GitHub PRs** = the work product. Every session ends in a PR (or commits to an `auto/...` branch).

## Setup steps

### 1. Provision Claude Code cloud access

You need a Claude Code cloud account with **scheduled-task** capability. Sign up at https://console.anthropic.com (Claude Code → scheduled jobs).

### 2. Connect GitHub repository

In the cloud UI:
- Connect `github.com/sarminvictor/mapsly` (this repo)
- Grant: `Read & write` on contents, PRs, and actions
- Working branch: leave blank — the loop creates `auto/...` branches per session

### 3. Set runtime environment variables

Add these as **secret env vars** in the cloud workspace (NOT to .env.local):

```
DATABASE_URL=<your Neon prod connection string>
DIRECT_URL=<your Neon prod direct connection string>
ANTHROPIC_API_KEY=<your Anthropic key>
DATAFORSEO_USERNAME=<your DFS username>
DATAFORSEO_PASSWORD=<your DFS password>
GITHUB_TOKEN=<a PAT with repo write access — only if SSH isn't available>
```

The cloud worker mirrors these into the running environment automatically — autonomous Claude reads them through `process.env`.

### 4. Configure the scheduled task

In the cloud UI, create a new scheduled task:

| Field | Value |
|---|---|
| Name | Mapsly autonomous build |
| Repository | github.com/sarminvictor/mapsly |
| Branch | main |
| Cron schedule | `0 */6 * * *` (every 6 hours — 4× per day) |
| Max duration | 4h 30min |
| Skill to run | `/autonomous-build-loop` |
| On failure | Email viktor@... |

The 6-hour cadence gives Claude 4 sessions per day. Each session is up to 4h30m. Total daily compute budget: 18 hours.

### 5. Configure the branch protection

In GitHub repo settings:
- Protect `main` branch
- Require PRs from `auto/*` branches
- Require at least one human approval (you) before merge
- Require `deploy-check` GitHub Action to pass

This makes sure no autonomous code lands without you signing off.

### 6. First manual run

Before scheduling, run the loop manually once to validate:

```
@claude /autonomous-build-loop
```

Watch the first session. Confirm:
- It reads `PLAN.md`
- It picks a sensible task
- It creates a branch
- It commits + pushes
- It opens a PR
- It updates `build-log.md`
- It exits cleanly

## What Claude does each session

1. **Boot** — read CLAUDE.md, PLAN.md, MEMORY.md, build-log
2. **Pull** — `git pull origin main` to get latest
3. **Pick task** — first `pending` phase with all deps `completed`, effort ≤ 3h
4. **Branch** — `auto/2026-05-19-phase-1-3-prisma-init`
5. **Orchestrate** — research agents in parallel for non-trivial work
6. **Implement** — phase by phase, code-reviewer + test-writer after each phase
7. **Validate** — `pnpm deploy-check`
8. **Commit** — conventional message with phase reference
9. **Push** — to the auto branch
10. **PR** — open against main, tag Viktor for review
11. **Update** — `PLAN.md` status, `build-log.md` entry
12. **Loop** — if time remaining > next-task-estimate, go to step 3
13. **Wrap** — push final state, log summary, exit

## Self-awareness

The skill tracks:

- **Session deadline** — `now + 4h30m` at start. Hard stop.
- **Disk usage** — halt if > 80%
- **API spend** — halt if session total > $10
- **Consecutive failures** — halt after 3
- **Git push failures** — halt immediately, alert Viktor

Halt always: write to build-log, exit cleanly. Never leave the repo in a broken state.

## What you (Viktor) do

- Review PRs daily. Merge what's good, request changes on what isn't.
- When you give feedback in a PR comment, the next session reads it and adjusts.
- Keep `MEMORY.md` updated when you discover a recurring preference.
- Tag tasks `human-required` in PLAN.md if they need your decision before proceeding (e.g. naming, copy, paywall logic).
- Watch the build-log weekly for patterns — recurring failures = a process issue.

## Cost ballpark

- Claude API cost per session: ~$2–6 (depends on context size and orchestration)
- 4 sessions/day × ~$4 average = ~$16/day = ~$480/mo Claude spend
- Plus actual product API costs (DataForSEO, etc.) — see `docs/data-cadence.md`

At $480/mo Claude + ~$300/mo DataForSEO + ~$50/mo other = **~$830/mo total infra**. Profitable at ~25 paying customers across SMB + Agency tiers.

## Failure modes + fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Claude can't push | GitHub token expired | Rotate token in cloud UI |
| Claude picks the same task twice | PLAN.md status not committed | Check the loop's commit step is running |
| Sessions go silent | Cloud worker crashed | Check cloud UI dashboard, restart |
| Sessions complete but nothing ships | All remaining tasks blocked | Manual review of PLAN.md to unblock |
| Costs spike | Runaway cron in production | Check `CronRun` table, find the runaway job |

## Disable autonomous mode

In an emergency, disable in the cloud UI (one toggle). All scheduled tasks pause until re-enabled. The repo is untouched.
