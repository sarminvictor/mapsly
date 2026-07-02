# Test scenario playbooks · per task type

The loop reads this when deciding validation strategy. Each scenario lists the exact validation chain.

## Scenario A · Auth flow

Tasks: B.6 (sign-in), E.7 / F.10 (onboarding), G.1 (Stripe checkout)

| Step                                         | Tool                   | Assert                        |
| -------------------------------------------- | ---------------------- | ----------------------------- |
| Seed test+{taskId}@mapsly.ai user            | Postgres MCP           | row exists                    |
| Navigate to auth route                       | Claude in Chrome MCP   | 200, hero copy                |
| Fill + submit form                           | form_input             | network 200                   |
| Switch to Gmail tab (sarminvictor@gmail.com) | tabs_create_mcp + find | subject + sender + body match |
| Click magic link                             | find + navigate        | redirect to expected page     |
| DB assert (Session / Customer / etc.)        | Postgres MCP           | row state matches             |
| Cleanup                                      | Postgres DELETE        | rows gone                     |

## Scenario B · Marketing page

Tasks: B.1-B.5, B.7, B.9

| Step                     | Tool                         | Assert                                   |
| ------------------------ | ---------------------------- | ---------------------------------------- |
| Navigate anon            | Chrome MCP                   | 200, hero copy, no CTA-redirects to auth |
| Lighthouse mobile preset | Chrome                       | Perf ≥ 90, a11y ≥ 95, SEO ≥ 95           |
| Mobile viewport 380px    | resize_window                | layout doesn't break                     |
| axe-core                 | inject                       | 0 violations                             |
| Schema validator         | https://validator.schema.org | JSON-LD parses                           |
| copy-reviewer agent      | parallel                     | voice consistent per audience            |

## Scenario C · External adapter

Tasks: C.3, C.4, C.5, C.6, C.7

| Step                      | Tool         | Assert                                     |
| ------------------------- | ------------ | ------------------------------------------ |
| Mocked unit tests         | Vitest + msw | parsed output shape                        |
| One real integration call | adapter      | response 200, non-empty                    |
| Cost-counter assert       | Postgres     | CronRun.costUsd incremented                |
| Cache hit on second call  | Redis        | cost not incremented                       |
| Retry on 503              | Vitest mock  | 2 retries with backoff                     |
| Timeout simulation        | Vitest mock  | aborts at 10s                              |
| No browser, no email      | —            | skip with reason="external adapter, no UI" |

## Scenario D · Cron handler

Tasks: C.8 (daily), C.9 (weekly), C.10 (monthly)

| Step                                 | Tool          | Assert                                   |
| ------------------------------------ | ------------- | ---------------------------------------- |
| Seed 10 businesses with adapter data | Postgres MCP  | test data ready                          |
| Invoke cron with CRON_SECRET         | curl          | 200                                      |
| CronRun row                          | Postgres      | status=OK, costUsd, itemsProcessed match |
| Snapshot/data row written            | Postgres      | expected rows present                    |
| revalidateTag fired                  | inspect cache | tagged keys invalidated                  |
| Failure path                         | broken biz    | CronRun.status=PARTIAL, errorMessage set |

## Scenario E · Compute / scoring

Tasks: D.1-D.7

| Step                           | Tool                         | Assert                    |
| ------------------------------ | ---------------------------- | ------------------------- |
| Unit tests                     | Vitest                       | 100% coverage on formula  |
| Inline snapshot tests          | Vitest toMatchInlineSnapshot | golden values lock        |
| Integration: seed biz, compute | Postgres                     | computed matches expected |
| Performance                    | bench                        | 1000 ops < 100ms          |
| No browser, no email           | —                            | skip                      |

## Scenario F · SMB portal page (Maria)

Tasks: E.1-E.7

| Step                                        | Tool         | Assert                   |
| ------------------------------------------- | ------------ | ------------------------ |
| Seed test+E.x@mapsly.ai with owned business | Postgres MCP | + BusinessSnapshot row   |
| Sign in as SMB user (uses Scenario A)       | Chrome MCP   | session cookie           |
| Navigate SMB route                          | Chrome MCP   | renders 200              |
| Anonymous visit assertion                   | new tab anon | redirects to /signin     |
| Mobile viewport 380px                       | resize       | layout works             |
| ux-reviewer-smb                             | agent        | warm voice, no jargon    |
| copy-reviewer                               | agent        | Maria's voice consistent |
| Lighthouse mobile                           | Chrome       | perf + a11y              |
| Cleanup                                     | Postgres     | test user + biz deleted  |

## Scenario G · Agency portal page (Tom)

Tasks: F.1-F.11

Same shape as F, but:

- Sign in as agency member (different test+F.x@mapsly.ai)
- ux-reviewer-agency (dense tables, jargon-OK, keyboard shortcuts)
- Anonymous + cross-agency permission check (must not see other agency's lists)
- F.2 (Hunter) additionally: perf-critical live count ≤ 500ms p95

## Scenario H · Billing

Tasks: G.1-G.4

| Step                             | Tool             | Assert                                    |
| -------------------------------- | ---------------- | ----------------------------------------- |
| Stripe test-mode key in env      | check            | not production                            |
| Create checkout session          | curl/integration | URL returned                              |
| Browser: complete test card 4242 | Chrome           | redirects to success URL                  |
| Webhook signature verify         | unit             | invalid sig → 400                         |
| Idempotency replay               | integration      | second event = 200 no double-process      |
| State machine                    | integration      | each event correctly updates subscription |
| payments-auditor                 | agent            | all dimensions ≥ 8                        |
| Tier enforcement                 | integration      | Solo can't access Boutique feature        |

## Scenario I · i18n

Tasks: I.2, I.3, I.4, I.5, I.6

| Step                    | Tool                  | Assert                                |
| ----------------------- | --------------------- | ------------------------------------- |
| Browser per locale      | Chrome MCP × 4        | /en, /es, /en-ca, /fr each return 200 |
| Locale-aware formatting | Chrome                | currency + date per locale            |
| Translated pathnames    | navigate              | /listas + /listes work                |
| hreflang in head        | inspect               | all 4 locales declared                |
| Visual diff per locale  | Playwright screenshot | minor changes only (text length)      |

## Scenario J · Internal ops / dashboard

Tasks: H.6, H.7, H.8

| Step                                 | Tool           | Assert                 |
| ------------------------------------ | -------------- | ---------------------- |
| Browser to /dev/\*                   | Chrome         | 200, no public leakage |
| Main domain blocks /dev              | Chrome         | 404 on mapsly.ai/dev   |
| DB assert on whatever the tool reads | Postgres MCP   | match                  |
| AutoRefresh fires every 30s          | wait + inspect | re-render              |
| No PII on public surface             | inspect        | only IDs, not emails   |
