# Validation · the loop decides what testing each task needs

Every task is different. A copy tweak doesn't need browser validation; a login flow needs end-to-end with email + token verification + cleanup. The autonomous loop MUST think through what validation a task needs **before** marking it done, and record that decision on the TaskRun row so Viktor can review it later.

## The contract

For every PLAN task the loop ships, it answers these questions and records the answers:

1. **Does this task need unit tests?** If logic is non-trivial: yes. If pure presentation/copy: no.
2. **Does it need integration tests?** If it crosses a service boundary (DB, external API, webhook): yes.
3. **Does it need browser validation via Claude in Chrome MCP?** If it ships a UI surface or user-visible behavior: yes.
4. **Does it need DB validation via Postgres MCP?** If it writes, reads, or computes from DB rows: yes.
5. **Does it need email-flow validation?** If it triggers email (magic link, transactional, cohort): yes.
6. **Does it need performance validation (Lighthouse + bundle)?** If a route or layout changed: yes.
7. **Does it need accessibility validation (axe)?** If new UI: yes.
8. **What test data lifecycle?** Seed → test → cleanup. Always.
9. **Does it need temporary tooling?** Install / pnpm add / uninstall in same session if so.

Pick whichever apply. Skipping is OK — but record WHY ("doc-only change, no validation needed") on the TaskRun. Silent skipping is a defect.

## Validation modes — when each fires

### Unit tests (Vitest)

- Pure functions, scoring formulas, parsers, validators
- Pattern: `*.test.ts` next to source. `pnpm test:run` runs them.
- Skip when: only presentation / copy / docs

### Integration tests (Vitest hitting Neon test branch)

- Cron handlers, webhook handlers, API routes, server actions
- Pattern: `__tests__/handler.test.ts`
- Seed test data → call handler → assert DB state → cleanup in `afterEach`
- Skip when: not crossing a service boundary

### Browser validation (Claude in Chrome MCP) · `.claude/skills/autonomous-build-loop/rules/browser-testing.md`

- Any user-visible route: navigate to preview URL, read page text, click interactive elements, take screenshot
- Validate as anonymous + SMB + agency + admin where relevant
- Watch for console errors + 4xx/5xx network requests
- Required artifacts: screenshot saved to `.claude/memory/screenshots/{taskId}-{date}.png`, URLs visited recorded on TaskRun.screenshotsUrls

### DB validation (Postgres MCP)

- After crons write data: SELECT row count, schema columns, sample values
- After server actions: SELECT the updated row, verify field values match expectations
- For computed scores: spot-check a known business — does the formula produce the expected number?
- Use cast `::text` for `name`-type columns (see INC-2026-05-19-08)

### Email-flow validation

- For magic-link, signup, password-reset, cohort, billing emails:
- Browser tab 1: trigger the email (click sign-in)
- Browser tab 2 (Viktor's signed-in Gmail at sarminvictor@gmail.com): wait for delivery, verify subject + sender + content
- Click the link in the email → validate landing
- Cleanup: delete the test email if it was sent to a test+ address

### Performance validation (Lighthouse + bundle)

- After any UI route change: run Lighthouse mobile via Claude in Chrome
- Required: Performance ≥ 90, LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 150ms
- Bundle size check: `pnpm next build` output — fail if any route > 200kB First Load JS
- Record numbers on TaskRun

### Accessibility validation (axe-core via Chrome)

- After any UI change: inject axe-core via Chrome MCP, check Lighthouse a11y score
- Required: ≥ 95
- Record any failures on TaskRun

## Test data lifecycle · MANDATORY

For ANY task that touches data:

1. **Seed**: create the minimum records needed via `scripts/test-seed.ts`. Emails MUST start with `test+{taskId}@mapsly.ai` so they're identifiable and don't collide with real users.
2. **Test**: run the validation.
3. **Cleanup**: delete the records via `scripts/test-cleanup.ts` OR by transaction rollback.

A cron at `app/api/cron/test-cleanup` runs daily and deletes any User where `email LIKE 'test+%@mapsly.ai'` AND `createdAt < now - 24h` — backstop.

If cleanup fails, log an INC entry. Leftover test data is a defect.

## Temporary tools

If a task needs a temporary tool to validate (e.g., `puppeteer` for a one-off screenshot, `axe-core` for a11y, a Chrome extension for testing OAuth), the loop:

1. `pnpm add -D <tool>` at start of validation
2. Use it
3. `pnpm remove <tool>` at end
4. Record on TaskRun.toolsInstalled (JSON array) what was used so a future task can re-use without re-installing

Persistent tools (vitest, prettier, eslint) stay; one-off validators get uninstalled.

## Recording validation on TaskRun

Every TaskRun stores:

```
validationStrategy   String?  @db.Text  // JSON: { unit: true, integration: true, browser: false, db: true, email: false, performance: true, a11y: true, reason: "..." }
validationOutcomes   String?  @db.Text  // JSON: { unit: { passed: 12, failed: 0 }, browser: { screenshots: [...], errors: [] }, db: { rowsAsserted: 5 }, ... }
testsAddedFiles      String?  @db.Text  // JSON array of paths
screenshotsUrls      String?  @db.Text  // JSON array of paths/URLs
toolsInstalled       String?  @db.Text  // JSON array of pkg names temporarily added
```

The /dev/tasks/[id] detail page surfaces these:

- Validation strategy: checkbox grid showing what was chosen
- Outcomes: per-mode result (✓ pass / ✗ fail / — skipped) with counts
- Artifacts: links to screenshots, test files added, etc.

## Reasoning chain · the loop's internal monologue

For each task, before validation, the loop writes a brief reasoning block to the TaskRun.notes field:

```
This is a UI route change shipping the SMB dashboard. Validation needed:
- Browser: YES — must verify the page renders at /(smb)/dashboard, KPI tiles load, 6 tiles visible, no console errors.
- DB: YES — verify BusinessSnapshot.findFirst returns the correct row for the test user.
- Email: NO — no email triggered by this change.
- Perf: YES — new route; need Lighthouse pass.
- A11y: YES — new UI; need ≥95.
- Unit: NO — no pure logic added.

Test data: seed BusinessSnapshot with mapslyScore=6.2 for test+E.1@mapsly.ai's owned business. Validate dashboard renders 6.2. Cleanup snapshot row after.
```

This is shown verbatim on the detail page so Viktor sees the loop's thinking, not just its output.

## When to skip validation entirely

- Documentation-only changes (README, docs/\*.md): skip all validation modes. Record `reason: "doc-only"`.
- Comment-only changes: skip. Record `reason: "comments-only"`.
- Refactors with no behavior change (verified by tests passing unchanged): skip browser. Record `reason: "no-behavior-change-refactor"`.

The reason field is mandatory when validation is skipped. "Couldn't be bothered" is not a valid reason — that's a defect.

## Anti-patterns

- ❌ Skipping validation because "the change is small"
- ❌ Marking a task DONE without recording validationOutcomes
- ❌ Leaving test data in the DB
- ❌ Test emails that don't start with `test+`
- ❌ Forgetting to remove temporary tools
- ❌ Lighthouse score recorded but no link to the report
- ❌ Browser validation without a screenshot artifact
