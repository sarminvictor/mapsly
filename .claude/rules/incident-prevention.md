# Incident prevention · never repeat the same issue twice

This is the load-bearing rule for the autonomous system. Read first on every session. Update before closing every session.

## The contract

When something breaks — a deploy fails, a test flakes, an external API returns 4xx, a tool hits a sandbox limit, a library upgrade silently shifts an API — that **must not** recur in the next session. The fix is two layers:

1. **Fix the immediate symptom** (code, config, env, etc.)
2. **Encode the lesson** so the next session catches it without re-discovering

Layer 2 is non-negotiable. Skipping it is a defect against this rule.

## Where lessons live

| Lesson type                                       | Goes in                                                                                           | Why                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A specific code pattern to avoid / prefer         | `.claude/rules/{relevant-rule}.md` (existing or new)                                              | Loaded automatically with affected file types   |
| A library/runtime API quirk                       | `.claude/memory/incidents.md` entry + reference in the relevant rule                              | Discoverable + searchable across sessions       |
| A workflow/tooling friction (CI, Vercel, sandbox) | `.claude/memory/incidents.md` + checklist item in `.claude/skills/autonomous-build-loop/SKILL.md` | The loop reads it at start-of-session           |
| A recurring agent failure mode                    | `.claude/agents/{agent}.md` rules section                                                         | Agent re-reads its own spec on every invocation |
| A pattern across many incidents                   | `.claude/agents/process-enhancer.md` updates rule files automatically                             | Meta-loop closes the gap                        |

## Incident record shape

Every entry in `.claude/memory/incidents.md` follows this format:

```markdown
### INC-YYYY-MM-DD-NN · {short slug}

**Symptom:** what the human / log / build report saw
**Root cause:** the actual underlying mechanism
**Fix applied:** the exact change that made it pass
**Prevention:** the rule / check / pattern that prevents recurrence
**Where encoded:** file paths where prevention lives now
**Confidence:** high / medium / low
**Tags:** comma-separated · used by process-enhancer for clustering
```

## The session loop integration

Every autonomous session, in this order:

1. **Open** session — read `.claude/memory/incidents.md` (full file, all entries). The patterns there shape every decision.
2. **Read MEMORY.md** for active rules and recent context.
3. **Pick a task** from PLAN.md.
4. **Execute** the task. When something fails:
   - Check `incidents.md` first — is this a known incident? If yes, apply the documented fix immediately.
   - If new — fix it, then write a fresh INC- entry **before** closing the session. No exceptions.
5. **Close** session — append session entry to `build-log.md`, run process-enhancer over the day's incidents.

## When an incident keeps recurring

If the same INC- record gets cited 3+ times, that's a process failure, not a knowledge failure. Escalate:

- The prevention text wasn't strong enough → rewrite as an explicit rule in `.claude/rules/`
- The rule isn't loaded in the right context → check `.claude/rules/*.md` frontmatter globs
- The check is manual when it should be automated → add a step to `pnpm deploy-check` or a CI job
- The fix is documented in the wrong place → move it where it actually gets read

Process-enhancer flags this automatically when it sees the same INC- ID twice in `build-log.md`.

## What NOT to log as an incident

- Routine task completion (use build-log.md)
- One-off typos with no broader lesson
- Decisions that worked the first time (no failure → no incident)
- Things already captured in `.claude/rules/*.md` (duplicate noise)

## When the orchestrator can override

The user (Viktor) can explicitly say "don't follow that incident this time, here's why" — and the override goes into the **same INC- entry** as an amendment. That way the next session sees both the rule and the exception.

## Quality bar

A good incident entry:

- A future Claude can read it cold (no context from this conversation) and immediately know what to do differently
- The prevention is **mechanical** — a checklist or grep or build-step — not a vague "be careful"
- The fix isn't just "do the right thing", it's the exact command / file / line

A bad incident entry:

- ❌ "Sometimes the build fails — be careful"
- ❌ "Prisma is tricky in v7"
- ❌ "Watch out for env vars"

Compare:

- ✅ "INC-2026-05-19-02 · Prisma 7 removed `url` from datasource block. Fix: move to prisma.config.ts as `datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL }`. Prevention: any `schema.prisma` PR must keep the datasource block to `{ provider }` only."

## Anti-patterns

- ❌ Logging the incident _after_ closing the session (memory faded, details lost)
- ❌ Burying the fix in a commit message instead of in `incidents.md`
- ❌ Skipping the "where encoded" line — that's how we measure if the prevention actually shipped
- ❌ Recording 50 trivial incidents to look thorough — file rot makes the real ones invisible
