---
name: deploy-gate
description: Run the project's deploy gate. Use before any commit/ship, or when the owner says "run the checks" / "is it green?". Reads the deployGate command from .claude/product-spec.json; falls back to `pnpm deploy-check`.
---

# Deploy gate

The single pass/fail answer to "is this safe to ship?".

## Steps

1. **Resolve the command.** Read `.claude/product-spec.json` → `deployGate`. If the file or key is missing, fall back to `pnpm deploy-check` and note the fallback in the output.
2. **Run it** with a generous timeout (builds are slow). Capture full output.
3. **Report pass/fail.** On pass: one line per step, with timing if the tool prints it. On fail: name the FIRST failing step and quote only its error output — never the whole log. Add the likely fix in plain English.
4. **Never auto-fix silently.** If the fix is obvious (e.g. formatting), offer it; apply only on confirmation, then re-run the gate to confirm green.

## Output format

```
✓ Format       (0.3s)
✓ Typecheck    (4.2s)
✗ Build

app/foo/page.tsx:12 — Type 'X' is not assignable to type 'Y'
Likely fix: …

Deploy gate FAILED — nothing ships until green.
```

## Relationship to /ship

/ship runs this skill as its gate step and hard-stops on failure. Running /deploy-gate standalone after any substantial edit is encouraged — cheaper to catch here than after a push (a push to the deploy branch is a production deploy).

## Anti-patterns

- ❌ Committing or pushing from this skill — validate only
- ❌ Truncating the failure to "build failed" with no error text
- ❌ Dumping the entire build log when only one step failed
- ❌ Skipping the gate because "it's just a doc change" — run it anyway; it's cheap when nothing broke
- ❌ Inventing a gate command when the spec file exists — the spec is the source of truth
