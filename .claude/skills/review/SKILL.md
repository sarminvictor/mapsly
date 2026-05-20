---
name: review
description: Spawn code-reviewer on the current branch · returns scorecard + blocking issues. Invoke before pushing OR after the autonomous loop opens a PR.
---

# /review

Spawn the `code-reviewer` agent against current changes.

## Usage

```
/review                         # Reviews current branch vs main
/review --files=app/(smb)/**    # Glob-scoped review
/review --pr=42                 # Reviews PR #42 (fetches diff via gh)
```

## What it does

1. Captures the diff (`git diff main...HEAD` or via gh for a PR)
2. Spawns `code-reviewer` with the diff + relevant rules
3. Returns 8-dim scorecard:
   - Functionality
   - Types
   - Data
   - Security
   - Cost
   - UX
   - Tests
   - Performance
4. Blocks merge if any < 7 or aggregate < 9.0

Output appended to PR comment (if PR present) or printed locally.

## Cost

Roughly 5K-25K tokens per review depending on diff size.
