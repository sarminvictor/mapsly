---
name: mapsly
description: Mapsly skills menu. Shows every project skill in one place.
---

# Mapsly skills

Slash-commands available in this repo:

## Build flow
- `/new-feature [name]` — orchestrated feature build (research → plan → implement)
- `/change-feature [module]` — orchestrated modification
- `/new-signal [name]` — add a new filterable signal to the 60+ vocabulary
- `/autonomous-build-loop` — the scheduled self-driving build loop

## Quality
- `/review` — spawn code-reviewer agent on the last commit
- `/deploy-check` — format + typecheck + lint + build + cost-budget audit
- `/cost-audit` — last-7d API spend vs budget
- `/seo-check` — spawn seo-auditor on current state

## Data
- `/db-snapshot` — capture current DB metrics baseline to `.claude/memory/db-snapshots/`
- `/keyword-research [topic]` — DataForSEO-powered keyword expansion

## Meta
- `/mapsly` — this menu
- `/sync-docs` — detect drift between Feature Map (CLAUDE.md) and actual code
