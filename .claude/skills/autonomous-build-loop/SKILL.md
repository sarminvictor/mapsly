---
name: autonomous-build-loop
description: Autonomous build loop — CURRENTLY PAUSED. Body/contract in .claude/loop.md; config in .claude/loop-config.json
---

# Autonomous build loop · pointer

> **PAUSED · 2026-07-02.** GitLab is primary, pushes require Viktor's approval (push to `gitlab main` = production deploy). This loop targets the GitHub mirror. Do not run until re-pointed via `.claude/loop-config.json` and explicitly re-enabled by Viktor.

- **Loop body / per-iteration contract:** `.claude/loop.md`
- **Repo + push config:** `.claude/loop-config.json` (`pushPolicy: propose-and-wait` — never push without approval)
- **Loop-only rules:** `.claude/skills/autonomous-build-loop/rules/` (loop-discipline, capability-routing, compound-steps, no-verify, agent-orchestration, validation, test-scenarios, browser-testing)

## Invariants

1. **Pro Max subscription only — never the metered Anthropic API.**
2. **Objective merge gate** — CI green · deploy-check · no critical reviewer veto · no `human-required` tag. Reviewer/scorer scores are informational, never merge gates.
3. **Cooldown discipline** per `.claude/skills/autonomous-build-loop/rules/loop-discipline.md` — cooldowns only for catastrophic/repeated failures, never for capability gaps or an empty queue.
4. **pushPolicy comes from `.claude/loop-config.json`** — `propose-and-wait` means the loop stages branches/diffs and waits; it does not merge or push to the deploy branch.

## CLOSE SESSION · incident-sweep checklist (mandatory, in order)

1. **Sweep for new incidents.** Every failure this session (test, deploy, agent, sandbox, API quirk): already in `.claude/memory/incidents.md`? Cite the INC- ID in `build-log.md`. New? Append an INC- entry per `.claude/rules/incident-prevention.md`. No exceptions.
2. **Update rules where appropriate.** If a prevention belongs in a rule file, edit it and set the incident's `Where encoded:` line.
3. **Run process-enhancer** over the day's incidents (clusters of 3+ → self-improvement proposal).
4. **Append session entry to `build-log.md`.**
5. **Write session JSON** to `.claude/memory/sessions/{date}-{n}.json` for the dashboard.
6. **Stage rule/memory updates** — commit/push only per `pushPolicy` (currently propose-and-wait).

Skipping any of these is a defect — without the sweep, every session starts from zero.
