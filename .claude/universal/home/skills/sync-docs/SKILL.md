---
name: sync-docs
description: Reconcile CLAUDE.md indexes (feature map, agents, skills, rules, docs) with the actual filesystem. Use after adding/removing modules, agents, or skills, or when the owner says "sync the docs" / "is CLAUDE.md up to date?".
---

# Sync docs

CLAUDE.md is loaded on every session — stale rows waste context and mislead. This skill diffs its tables against reality and proposes fixes.

## Steps

1. **Feature map check.**
   - Parse the feature-map table in `CLAUDE.md`
   - List every directory under the project's module root (`modules/*/` or equivalent — infer from the table itself)
   - Flag modules with no row (missing) and rows with no directory (orphaned)
   - Spot-check `Status` columns: a module marked "pending" that has routes + tests is drift
2. **Agents / skills / rules indexes.**
   - For each index table in CLAUDE.md, verify every listed file exists and every existing file is listed
3. **Documentation index.**
   - For each doc referenced in CLAUDE.md (or a Documentation Index table if present), verify the file exists under `docs/`
   - Flag docs on disk that no index mentions
4. **Convention spot-checks.** If CLAUDE.md documents conventions with greppable signatures (cache-tag taxonomy, import aliases, route groups), grep the codebase and flag: used-but-undocumented and documented-but-unused entries.
5. **Propose edits.** Numbered list of concrete edits (exact table rows to add/remove/update, per file). Apply only after the owner approves — this skill proposes, the owner decides.

## Output format

```
FEATURE MAP
  Missing rows:       [list]
  Orphaned rows:      [list]
  Status drift:       [list]

INDEXES (agents / skills / rules)
  Missing entries:    [list]
  Orphaned entries:   [list]

DOCUMENTATION
  Missing files:      [list]
  Undocumented files: [list]

CONVENTIONS
  Used but undocumented: [list]
  Documented but unused: [list]
```

### Score Card

| Dimension               | Score (1-10) | Issues |
| ----------------------- | ------------ | ------ |
| **Feature map sync**    |              |        |
| **Index sync**          |              |        |
| **Doc index sync**      |              |        |
| **Convention hygiene**  |              |        |
| **Overall**             |              |        |

## Anti-patterns

- ❌ Applying edits automatically — propose, owner approves
- ❌ Mutating code — this skill touches docs/indexes only
- ❌ Skipping the Score Card
- ❌ Vague findings ("some rows stale") — name every row and file
