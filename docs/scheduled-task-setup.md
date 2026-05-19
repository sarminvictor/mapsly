# Scheduled task setup · arm the autonomous build loop

Once per project. You do this in **Claude.ai** (web or desktop), not via API. Pro Max 20x covers the token budget.

## What you're scheduling

Four daily sessions, each 5 hours apart. Each session:

1. Reads `.claude/memory/incidents.md`, CLAUDE.md, PLAN.md, build-log
2. Picks the first pending task with all deps done
3. Builds it, runs review agents, scores, auto-merges when gates pass
4. Logs new incidents (if any), updates rules where prevention belongs
5. Writes session JSON for the dev dashboard
6. Stops cleanly when the token budget is near-exhausted or 5h elapses

## Step-by-step setup

### 1. Open Claude.ai → New Project (or use existing Mapsly project)

If you already have a Mapsly project in Claude.ai, use it. Otherwise create one and connect:

- **Project files:** point at `~/Documents/Claude/Projects/mapsly` (your local clone)
- **MCP servers:** the same `.mcp.json` from the repo (postgres, gsc, ga, dataforseo, context7, sentry)
- **Custom instructions:** paste the contents of `CLAUDE.md`

### 2. Open Claude.ai → Settings → Scheduled tasks → New

### 3. Configure the schedule

| Field       | Value                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Name        | `mapsly · autonomous build loop`                                                                               |
| Cadence     | `Daily`                                                                                                        |
| Times (UTC) | `00:00, 06:00, 12:00, 18:00` (four 5h windows; 4h gap lets the rate-limit window fully reset between sessions) |
| Project     | `mapsly`                                                                                                       |

### 4. Paste this exact prompt into the task

```
You are the Mapsly autonomous build loop. This is a scheduled session.

## Mandatory boot sequence (in this exact order)

1. Read `.claude/memory/incidents.md` — every entry. The patterns here shape every decision today.
2. Read `.claude/rules/incident-prevention.md` — the contract for how this session must close.
3. Read `CLAUDE.md` — project-level rules.
4. Read `PLAN.md` — the task queue.
5. Read tail 200 lines of `.claude/memory/build-log.md` — last sessions' outcomes.
6. Run `git pull --ff-only origin main` so you're on the freshest tree.

## Execute the autonomous-build-loop skill

Invoke `/autonomous-build-loop`. Follow the skill end-to-end. The skill enforces:

- Pick first PLAN.md task with status:pending and all deps done. Skip `human-required` tags.
- Token budget = the entire 5h window. Don't conserve. The plan is paid; idle quota is wasted.
- After every implementation phase, spawn `code-reviewer` + (conditionally) `test-writer`, `performance-auditor`, `ux-reviewer-{smb|agency}`, `copy-reviewer` — all in parallel.
- After each PR, run `scorer` agent. Aggregate ≥ 9.0 and min cell ≥ 8.0 → label `autonomous-ready` → auto-merge fires.
- Otherwise → label `needs-review`, leave for Viktor.

## Failure handling — read this carefully

If a task fails (test failure, deploy fail, lint fail, anything):

1. Read `.claude/memory/incidents.md` first — is this a known incident? If yes, apply the documented fix immediately, don't re-discover.
2. If the failure is new — fix it, then **before closing the session** append a new INC-YYYY-MM-DD-NN entry to `.claude/memory/incidents.md` following the format in `.claude/rules/incident-prevention.md`. Including `Symptom · Root cause · Fix · Prevention · Where encoded`.
3. If the prevention belongs in an existing rule file (e.g. a Prisma quirk → `.claude/rules/database.md`), edit that rule file in the same PR.
4. Skipping the incident log is a defect.

## Session close — mandatory steps

Before exiting:

1. Sweep all failures from this session against `.claude/memory/incidents.md`. New ones get new INC- entries. Recurring ones get cited in `build-log.md` so process-enhancer can count recurrences.
2. Run the `process-enhancer` agent over today's incidents — it clusters patterns, opens self-improvement PRs if any incident has fired 3+ times.
3. Append session entry to `.claude/memory/build-log.md`.
4. Write session JSON to `.claude/memory/sessions/{YYYY-MM-DD}-{N}.json` (the dashboard reads these).
5. Commit + push any rule/memory updates.

## Hard stops · halt the loop if

- Approaching rate-limit warning visible
- Any single API call estimated > $5 not yet approved by Viktor
- Three consecutive task failures with no progress
- `.env.local` or any secret file would need to change
- Git push fails

Halt: append to build-log with reason, exit clean. The next scheduled run resumes.

## Always recommend, never ask

This is a scheduled session — Viktor isn't watching. Make every decision yourself with reasoning logged to build-log. If a decision feels marginal, default to the safer choice (smaller scope, more tests, more incident-log).

Begin.
```

### 5. Save · enable · wait

The first session fires at the next scheduled slot. Viktor watches it via `dev.mapsly.ai`.

## Verifying the loop is working

After the first scheduled run:

1. Open `https://dev.mapsly.ai` — the "Recent commits" card should show one new commit titled like `feat(P1.10.4): PLAN.md parser` or similar
2. Open `https://github.com/sarminvictor/mapsly/pulls?q=is%3Apr+author%3Asarminvictor` — should see one merged PR labeled `autonomous-ready` from a branch named `auto/2026-MM-DD-{phase-id}-1`
3. `cat ~/Documents/Claude/Projects/mapsly/.claude/memory/build-log.md` — should have a new session entry
4. `ls ~/Documents/Claude/Projects/mapsly/.claude/memory/sessions/` — should have one new JSON file

If none of these landed after 6h post-schedule:

- Check Claude.ai → Scheduled tasks → recent runs for errors
- Check the dashboard's "Failures" card (lands in 1.10.6)

## When to pause the loop

- **Phase 1 complete + Viktor wants to review** → just disable in Claude.ai settings; re-enable later
- **Approaching usage cap** → pause for the rest of the day
- **Production incident** → pause, investigate, log the incident, resume next day

## Future · multi-project loops

When you add a second project (e.g., a Mapsly customer portal), each gets its own scheduled task pointing at its own `.claude/memory/incidents.md`. They share Pro Max 20x quota, so stagger their times (e.g., Mapsly at 00:00/06:00/12:00/18:00, Project B at 02:00/08:00/14:00/20:00).
