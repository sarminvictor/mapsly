---
name: audit-agents
description: Meta health check of .claude/ itself — verify every agent/skill/rule/MCP cross-reference resolves. Use quarterly, after framework or stack changes, or when the owner says "audit the claude setup". Spawns spec-auditor for the deep pass.
---

# Audit agents

Fresh gap analysis of the project's `.claude/` directory: what's missing, stale, or orphaned.

## Steps

1. **Inventory.** Glob + read:
   - `.claude/agents/*.md` — agent definitions
   - `.claude/skills/*/SKILL.md` — skills
   - `.claude/rules/*.md` — rules
   - `.claude/settings.json` + `.claude/settings.local.json` — settings + hooks
   - `.mcp.json` — registered MCP servers
2. **Cross-reference.** Every reference must resolve, in both directions:
   - Every agent/skill listed in CLAUDE.md indexes exists as a file; every file appears in an index
   - Every `mcp__<server>__` mention in agents/skills maps to a server in `.mcp.json`; every server has ≥1 consumer
   - Every rule, memory file, doc, or script path cited by an agent or skill exists on disk
3. **Stale checks.** Rules referenced by nothing; agents citing removed docs; skills whose steps reference renamed scripts or commands; hooks pointing at missing files.
4. **Deep pass — spawn `spec-auditor`.** Launch the `spec-auditor` agent (Task tool) with the inventory as input: it validates frontmatter shape (name/description/tools), tool grants vs actual tool use, description/trigger quality, and line-budget compliance. If the agent doesn't exist in this repo or `~/.claude/agents/`, do this pass inline and note the absence as a finding.
5. **MCP health.** Cheap availability probes only (e.g. `SELECT 1` on postgres). Never make MCP calls that cost money.
6. **Report + Score Card.** Write to `.claude/AGENTS_SKILLS_AUDIT.md` (overwrite previous). Print a short summary for the owner.

## Output format

### Findings

- **Missing** — referenced but not present
- **Orphaned** — present but referenced nowhere
- **Stale** — points at a path/command that no longer exists

### Score Card

| Dimension           | Score (1-10) | Notes |
| ------------------- | ------------ | ----- |
| **Agent coverage**  |              |       |
| **Skill coverage**  |              |       |
| **Rule coverage**   |              |       |
| **MCP utilization** |              |       |
| **Index sync**      |              |       |
| **Overall**         |              |       |

### Recommendations

Prioritized list with effort (S/M/L/XL).

## Anti-patterns

- ❌ Modifying agent/skill/rule files — audit only (except the audit report itself)
- ❌ Live MCP calls that cost money without explicit approval
- ❌ Skipping the Score Card
- ❌ Reporting a broken reference without saying which file cites it
