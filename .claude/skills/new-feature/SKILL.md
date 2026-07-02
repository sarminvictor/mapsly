---
name: new-feature
description: Orchestrated feature build · launches parallel research agents, synthesizes scorecard + phased plan, awaits approval (or auto-executes inside the autonomous loop), then implements with reviewer chain.
---

# /new-feature

The orchestrator pattern in skill form. Use when starting a non-trivial new module.

## Usage

```
/new-feature {name}
/new-feature smb-reviews
/new-feature agency-hunter
```

## Workflow

### Phase 1 · Show flow + spawn research agents in parallel

Output the flow to the user, then spawn 4–7 agents in one message (`run_in_background: true`):

```
Flow: [research → synthesize → plan → implement → score]

Phase 1 (parallel):
  → Senior Dev — audit existing related modules, score reuse potential 1-10
  → Competitive Researcher — how do Mapsly's competitors solve this?
  → DB Analyst — what data is already there vs needs to be collected
  → Integration Specialist — external APIs required
  → UX Reviewer (audience) — wireframe sanity check
  → Signal Engineer — does this introduce new signals?
  → Performance Auditor — estimate bundle + LCP impact
```

### Phase 2 · Synthesize

When all agents return, build:

- **Score Card** (1-10 per dimension)
- **Comparison Table** (current vs proposed, with risk + effort)
- **Phased Plan** (each phase = one session = one PR)
- **Recommendations** with reasoning

### Phase 3 · Implement (after approval OR autonomous mode)

For each phase:

- Branch `auto/YYYY-MM-DD-{phase-id}-{n}`
- Implement
- Spawn review agents in parallel (`code-reviewer` + `test-writer` + `performance-auditor` + `ux-reviewer-{audience}` + `copy-reviewer`)
- Score via `scorer` agent
- Auto-merge if 9.0/8.0 floor passed; else `needs-review`
- Update Task tracker `TaskRun`

### Phase 4 · Browser validation

Per `.claude/skills/autonomous-build-loop/rules/browser-testing.md` + `.claude/skills/autonomous-build-loop/rules/validation.md` — multi-user verify.

### Phase 5 · Close

- Sweep new incidents
- Run process-enhancer
- Append session JSON
- Push memory updates

## Anti-patterns

- ❌ Skipping Phase 1 research for "obvious" features (most look obvious from outside)
- ❌ One big PR vs phased shipping
- ❌ Skipping review agents because "scope is small"
