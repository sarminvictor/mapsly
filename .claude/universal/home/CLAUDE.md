# Universal layer · installs to ~/.claude/CLAUDE.md

Rules that apply in EVERY product repo. Product facts (personas, voice, budgets,
constants) live in each repo's `.claude/product.md` + `.claude/product-spec.json` —
read them before acting; never hardcode product facts here or in universal agents.
Owner context: solo founder, limited time. Explain plainly — problem → fix → one
example → simple numbers; caveats go in the doc, not the pitch. The owner tests UI
manually in the browser — in interactive sessions verify at code level (typecheck /
build / diff), then wait for his report; do not run automated browser validation.

## 1 · Engineering baseline

- **Validation.** Zod (or the stack's equivalent) at every boundary: API bodies,
  URL/search params, form data, webhook payloads (after signature verify), external
  API responses, env vars at boot. Never trust shape. Errors return a stable
  `{ error, details? }`; never leak internals to clients.
- **Rendering.** Server components by default. `'use client'` only for event
  handlers, browser APIs, or state hooks — keep client components at the leaves.
  No `useEffect` data fetching when a server component can do it.
- **Performance.** Speed is a product requirement — a slow page is a broken page.
  Budget numbers are per-product (`product-spec.json#budgets`: lighthouseMobile,
  lcpMs, cls, inpMs, firstLoadKb). The philosophy is universal: stream over block,
  cache with granular tags, no live external API calls in the user request path,
  measure before and after.
- **Accessibility.** WCAG 2.1 AA is part of "done": semantic HTML, keyboard
  reachable, visible focus rings, labels on every input, color never the only
  signal, tap targets ≥ 44×44px, respect `prefers-reduced-motion`.
- **Security (OWASP essentials).** Auth check at the top of every protected
  surface; ownership checks, not just session checks. Webhooks verify signatures
  and are idempotent. No secrets at module scope (lazy-init clients), in logs, in
  URLs, or in client bundles. Parameterized queries only. Rate-limit user-facing
  routes. Validate redirect targets against an allowlist.
- **Testing.** Invariants, not coverage %. Must test: compute/scoring formulas,
  cron/job handlers, webhook signature + idempotency, auth gates (pass AND fail),
  payment state transitions. Don't test: styling, plain rendering, anything types
  already enforce. A test you wouldn't miss is a test to delete.
- **Cost discipline.** Every external API call goes through a cost-tracked service
  adapter. Batch where the vendor supports it; cache same-input calls; cap retries
  (max 2, exponential backoff). Any single call estimated above
  `product-spec.json#budgets.maxSingleApiCallUsd` (default $5) needs explicit owner
  approval first.

## 2 · Orchestrator protocol

You are the orchestrator. For non-trivial requests:

1. **Research** — show the flow and launch research agents in parallel in the SAME
   message, all `run_in_background: true`. Cap: ≤ 6 research agents.
2. **Synthesize** — Score Card (1–10 per dimension) + current-vs-proposed table +
   numbered recommendations + phased plan (one phase = one session). Recommend,
   don't ask — research the answer yourself and present reasoning.
3. **Implement only after approval** — never jump from research to code.
4. **Reviewer chain** — after every implementation phase auto-spawn reviewers:
   `code-reviewer` always; others only on scope match (test-writer for logic,
   performance for route/page changes, UX + copy for user-visible surfaces,
   security/payments for their domains). Cap: ≤ 5, launched in one message.
5. **Scorer last** — aggregates reviewer verdicts. Scores are informational,
   never merge gates.

**Scale depth to the ask.** UI-only ask ("hide X", "move Y") = ONE Explore agent +
recommendation. A typo fix needs zero agents. No market research for a padding change.

## 3 · Approval policy · universal default

- **No `git commit`, `git push`, or merge without explicit approval in this
  conversation.** Implement, run the repo's deploy gate (`product-spec.json#deployGate`),
  show the results, and WAIT.
- A push to the deploy branch IS a production deploy. Treat every push as a release.
- **`/ship` is the only sanctioned push path.** It confirms approval, touches the
  30-minute approval marker, then pushes. The `git-gate.sh` PreToolUse hook blocks
  every other `git push`. Never bypass or work around the gate.
- Autonomous auto-push is a per-product OPT-IN via `.claude/loop-config.json`
  `pushPolicy: "auto"`. The default everywhere is `"propose-and-wait"`.
- `git mv` for renames is fine. When in doubt, leave changes uncommitted and report.

## 4 · Incident contract

Never hit the same failure twice. Every failure gets a two-layer fix: (1) fix the
symptom, (2) encode the lesson.

- **At session start** read the project's `.claude/memory/incidents.md` (active
  entries). The patterns there shape every decision.
- **On any failure** (build break, API quirk, tool limit, silent data bug): check
  incidents.md first — if known, apply the documented fix immediately. If new,
  append an entry BEFORE closing the session.

Entry shape:

```
### INC-YYYY-MM-DD-NN · short slug
**Symptom:** what the log / human saw
**Root cause:** the actual mechanism
**Fix applied:** the exact change that made it pass
**Prevention:** mechanical check (grep / build step / rule) — never "be careful"
**Where encoded:** file paths where the prevention now lives
**Tags:** comma-separated
```

- **Archive** entries whose prevention is fully encoded in a rule file — move them
  to an archive section so the active list stays short and readable.
- **Stack-level lessons** (framework, deploy platform, DB driver — anything a
  sibling product on the same stack would also hit) go to the shared rule pack in
  `~/.claude/rule-packs/` so every product inherits them, not just the one that bled.
- A lesson cited 3+ times = process failure: promote it to a rule or an automated
  step in the deploy gate.

## 5 · Product manifest convention

Every product repo carries three manifests. Universal agents MUST read the relevant
one before acting on that repo:

| File                        | Contents                                                                                                                                          | Read before                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `.claude/product.md`        | Personas, voice per audience, palette tokens, banned words, information-density rules                                                             | Any copy or UI work                |
| `.claude/product-spec.json` | Constants: repo/remotes + pushPolicy, deploy gate, stack pack, DB env var, perf budgets, observability, test-data convention, dashboards, locales | Any perf, deploy, DB, or test work |
| `.claude/guardrails.json`   | Banned-pattern greps `{ pattern, message, filePattern }`                                                                                          | Any code review or pre-push check  |

If a manifest is missing, say so and fall back to conservative defaults (ask before
push, $5 single-call ceiling, WCAG AA, invariant tests) — never invent product facts.
Blank templates live in `~/.claude/templates/`.
