# Browser-based user testing · validate every shipped page

The autonomous loop ships fast and often. Every UI phase MUST be validated through a real browser as a real user — not just via unit tests + lighthouse + types passing.

## The discipline

After implementing any phase that ships a user-facing route, before marking the phase done:

1. **Launch the deploy** — push to a branch, get Vercel preview URL.
2. **Browser-validate via Claude in Chrome MCP** — navigate, read page content, click interactive elements, take screenshots.
3. **Validate as multiple user types** if the route has auth:
   - Anonymous (signed-out)
   - SMB owner (free + paid tier)
   - Agency member (each plan tier where it changes behavior)
   - Admin (if applicable)
4. **Test data lifecycle:**
   - Seed test records via `scripts/test-seed.ts`
   - Run the validation
   - Clean up via `scripts/test-cleanup.ts` (or rollback transaction)
   - Test records use email pattern `test+{phaseId}-{n}@mapsly.ai` so they're identifiable + greppable
5. **Required checks per route:**
   - Page returns 200 (not 404, not 500)
   - Expected content is present (assert key copy / element selectors)
   - Permissions enforced (signed-out user can't reach `/dashboard`; SMB can't reach `/(agency)`)
   - Copy matches the audience (no SMB jargon in agency, no agency jargon in SMB)
   - No console errors
   - No 4xx network requests (open devtools, scan)
   - Lighthouse mobile Performance ≥ 90, A11y ≥ 95
6. **Record evidence** — screenshot + URL → attach to the PR via comment, or write to `.claude/memory/screenshots/{phaseId}-{date}.png`

## Tooling

| Tool                                           | Use for                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| `mcp__Claude_in_Chrome__navigate`              | Open the preview URL                                |
| `mcp__Claude_in_Chrome__get_page_text`         | Assert content (cleaner than HTML scrape)           |
| `mcp__Claude_in_Chrome__read_page`             | Full DOM inspection when get_page_text isn't enough |
| `mcp__Claude_in_Chrome__form_input`            | Sign-in flow, form submission                       |
| `mcp__Claude_in_Chrome__find`                  | Click buttons, links, interactive elements          |
| `mcp__Claude_in_Chrome__read_console_messages` | Catch JS errors                                     |
| `mcp__Claude_in_Chrome__read_network_requests` | Catch 4xx/5xx                                       |
| `mcp__Claude_in_Chrome__upload_image`          | Screenshot evidence for PR                          |

## Test data discipline

Every phase that touches data ships TWO scripts:

```
scripts/seed-{phaseId}.ts        # creates the minimum test records for this phase
scripts/cleanup-{phaseId}.ts     # removes them
```

Both:

- Use email/slug patterns starting with `test+` so production data is never touched
- Wrap in `prisma.$transaction` so partial failures roll back
- Are idempotent — running twice is safe
- Log to console what they created / removed

Test records expire automatically: a cron at `app/api/cron/test-cleanup/route.ts` deletes any `User` where `email LIKE 'test+%@mapsly.ai'` and `createdAt < now - 24h`.

## What this is NOT

- Not Playwright E2E tests (those land separately for invariants — see `.claude/rules/testing.md`)
- Not unit tests
- Not manual QA by Viktor — Viktor reviews already-shipped code via dev.mapsly.ai

This is a final "would a real human's first impression on this page work?" check, run by the autonomous loop on every UI shipment.

## Anti-patterns

- ❌ Marking a UI phase done without browser-validating
- ❌ Skipping permission checks because "the test takes too long"
- ❌ Leaving test data in the DB (always cleanup)
- ❌ Test emails that aren't greppable (always start with `test+`)
- ❌ Manual Viktor-facing screenshots when the loop should be capturing them
