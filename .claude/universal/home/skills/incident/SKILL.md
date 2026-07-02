---
name: incident
description: Log a failure as a properly-formatted INC- entry in .claude/memory/incidents.md. Use after anything breaks — build failure, API quirk, tooling wall — or when the owner says "log this as an incident".
---

# Incident

Every failure surfaces a lesson. The lesson lives in `.claude/memory/incidents.md` with a **mechanical** prevention so no future session re-discovers it.

## Steps

1. **Gather the four facts.** From the current conversation infer: symptom, root cause, fix applied, prevention. For any gap, ask the owner in plain English — one short question per gap, not a form.
2. **Assign the ID.** Read the project's `.claude/memory/incidents.md`; next ID is `INC-YYYY-MM-DD-NN` (today's date, NN = today's entry count + 1, zero-padded).
3. **Append the entry** in exactly this shape:

   ```markdown
   ### INC-YYYY-MM-DD-NN · {short slug}

   **Symptom:** what the log / build / human saw
   **Root cause:** the actual underlying mechanism
   **Fix applied:** the exact change that made it pass
   **Prevention:** the rule / check / grep that stops recurrence
   **Where encoded:** file paths where the prevention now lives
   **Confidence:** high / medium / low
   **Tags:** comma-separated
   ```

4. **Cross-link the rule.** Grep `.claude/rules/*.md` for the topic; add a one-line cite of the new INC- ID to the matching rule. If no rule fits and the lesson generalizes, propose a new rule file — don't create it without approval.
5. **Verify the prevention is mechanical.** A grep, a build step, a hook, a checklist line — not "be careful". If it isn't mechanical yet, say so and propose the mechanical version (e.g. add a step to the deploy gate).
6. **Recurrence check.** Grep incidents.md for the same tags/slug. If a similar INC exists, cite it and flag the recurrence — 3+ citations of the same INC means the prevention failed and the rule needs strengthening, not another entry.

## Quality bar

A future session must read the entry cold and know what to do differently. The fix is an exact command / file / line, never a vague direction.

## Anti-patterns

- ❌ "Be careful with X" as prevention
- ❌ Logging after context has faded — write it while the failure is fresh
- ❌ Skipping "Where encoded" — that line is how we measure the prevention shipped
- ❌ Logging routine completions or one-off typos as incidents
- ❌ Duplicating a lesson already in a rule file (cite it instead)
- ❌ Burying the fix in a commit message instead of the entry
