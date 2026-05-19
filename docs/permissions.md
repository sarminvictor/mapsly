# Permissions · what Claude can do, what it can't

This doc is the contract between Viktor and the autonomous Claude loop. Every permission is explicit. Every restriction has a reason.

## Full access (no approval needed)

### Repos

- **`github.com/sarminvictor/mapsly`** — full read/write/PR. Claude can:
  - Read every file
  - Edit every file
  - Open branches under `auto/...` (feature work) and `enhance/...` (process-enhancer)
  - Open PRs against `main`
  - **Auto-merge its own PRs** when ALL of: scorer aggregate ≥ 9.0 · min cell ≥ 8.0 · deploy-check passed · all auditor agents APPROVE · GitHub CI green · Vercel preview deployed · no new Sentry errors. See `_claude-setup/skills/autonomous-build-loop/SKILL.md` § Auto-merge policy.
  - Comment on PRs (its own and others)
  - Read CI logs
  - **Cannot:** push directly to `main` (branch protection still on — only the GitHub App auto-merge path allowed)
  - **Cannot:** auto-merge a PR that fails ANY gate — those get tagged `needs-review` and wait for Viktor
  - **Cannot:** disable a CI check to make a PR pass

- **`github.com/sarminvictor/boxly` (reference only)** — read-only access. Claude can:
  - Read every file in the Boxly codebase as a reference for patterns (Boxly Pro engine, cron infra, scoring formulas)
  - Quote code patterns in Mapsly
  - **Cannot:** modify, push, comment, or PR

### Local files (in Mapsly workspace)

- All files in `/Users/Viktor/Documents/Claude/Projects/mapsly/`
- `.env.local` — READ access (to confirm vars are present)
- `.env.example` — full edit (additive only, no removing keys)
- `.mcp.json` — READ access (to verify MCP config)
- `_claude-setup/` and `.claude/` — full edit
- `_design/` — read only (design reference)
- `prisma/migrations/` — additive only (no migration deletion)
- `lib/generated/` — never edit (auto-generated)

### External services

- **Vercel** — full project access. Claude can:
  - Trigger preview deploys
  - Read deploy logs
  - Read env vars (verify presence, not values)
  - Trigger production deploys (only from `main` after Viktor merges)
  - Read Speed Insights data
- **Neon** — connection-string access only. Claude can:
  - Read from `DATABASE_URL` and `DIRECT_URL`
  - Run `prisma db push` against test branch
  - **Cannot:** drop databases, delete branches, modify billing
- **GitHub Actions** — read logs, retry failed runs
- **Sentry** — `mcp__sentry__*` tools (read-only by default; write tools require explicit instruction in the current turn)
- **DataForSEO** — via `services/dataforseo/` adapter only (cost-tracked)
- **Meta Ad Library** — read-only API access
- **Anthropic Claude (this account)** — for AI features (sentiment, reply drafts, one-pager copy) — paid by Viktor's API key, tracked per call

## Approval required ($5 estimate rule)

**Any single API call estimated to cost > $5 needs Viktor approval before execution.**

Examples that require approval:

- Mass keyword volume pull (> 5,000 keywords at once)
- Full market census on a new metro
- Lighthouse audit batch > 500 sites at once
- Live mode DataForSEO call (10× cost vs Standard)
- Bulk one-pager generation (> 100 in one go)
- Re-indexing 2.1M businesses

### Approval flow

When Claude estimates a call > $5:

1. Stop before calling.
2. Open or update GitHub issue titled "⚠️ Approval needed: {short description}"
3. Issue body includes:
   - **Operation:** what's being called
   - **Estimated cost:** $X
   - **Cost calculation:** rows × unit cost = $X
   - **Why now:** what this unblocks
   - **Alternatives considered:** if smaller batch was possible
4. Wait for Viktor to comment `/approve` on the issue
5. Once approved, execute. Cap at the approved amount.
6. After execution, post actual cost as a comment.

If Viktor comments `/deny`, Claude:

- Marks the related PLAN.md task as `blocked`
- Adds a follow-up task to find a cheaper approach
- Moves on

### What does NOT need approval (under $5)

- Single business profile refresh — ~$0.0006
- Single keyword volume lookup — ~$0.001
- Single Lighthouse audit — ~$0.003
- Daily ad-library diff — $0 (free API)
- Weekly snapshot pipeline per business — ~$0.06
- LLM calls within Pro Max x5 subscription — $0 marginal
- Database queries — $0 (within Neon free tier)

## Hard restrictions (NEVER permitted)

Claude will refuse and exit if asked to:

- Push to `main` directly (always PR)
- Modify `.env.local` (read-only)
- Modify `MEMORY.md` or `feedback/` (Viktor-only)
- Delete files from `_design/`
- Disable any CI gate to make a PR pass
- Skip `pnpm deploy-check`
- Commit secrets (any file matching `*.env*` except `.env.example`)
- Modify Stripe production keys
- Issue refunds or modify customer subscriptions
- Modify billing / plan tier of any user without explicit Viktor instruction
- Send marketing emails to real users
- Post AI-drafted reviews to Google on behalf of users (must be user-approved per review)
- Run any script that touches > 1,000 businesses without approval issue
- Use the Anthropic API for autonomous development (only Pro Max subscription)

## Per-MCP permissions

| MCP                    | Read           | Write                                                            | Notes                                   |
| ---------------------- | -------------- | ---------------------------------------------------------------- | --------------------------------------- |
| `mcp__postgres__query` | ✅ SELECT only | ❌                                                               | Never UPDATE/INSERT/DELETE through MCP  |
| `mcp__gsc__*`          | ✅ all         | ❌ no write                                                      | Read GSC data, no property modification |
| `mcp__ga__*`           | ✅ all         | ❌                                                               | Read GA4 data                           |
| `mcp__dataforseo__*`   | ✅ all         | n/a                                                              | Cost-tracked — $5 rule applies          |
| `mcp__context7__*`     | ✅ all         | n/a                                                              | Free, no limits                         |
| `mcp__sentry__*`       | ✅ read tools  | ⚠️ write tools require explicit user instruction in current turn |

## Boxly read access · pattern reference

Claude can `Read` and `Grep` files in `/Users/Viktor/Documents/Boxly_development/boxly_app/` for reference. Specifically useful:

- `modules/pro/` — agency-portal architecture pattern (we have similar shape)
- `app/api/cron/` — cron handler patterns
- `services/` — adapter pattern with cost counting
- `.claude/rules/` — many of Boxly's rules apply to Mapsly with minor edits (already ported into our `_claude-setup/`)
- `prisma/schema.prisma` — for reference on indexing strategies, but don't copy verbatim — Mapsly's data shape is different

Claude must NOT:

- Copy proprietary Boxly business logic without thinking through whether it applies to Mapsly
- Modify any Boxly file
- Reference Boxly customer data or internal docs in Mapsly code

## Deploy access

- **Preview deploys** — every PR auto-deploys to a Vercel preview URL. Claude can trigger, read logs, and reference the preview in PR descriptions.
- **Production deploys** — only happen when Viktor merges a PR to `main`. Vercel auto-deploys from `main`. Claude cannot bypass this.
- **Rollback** — if a production deploy errors at runtime (Sentry alerts), Claude can open a PR to revert the offending commit. Cannot directly trigger Vercel rollback without Viktor approval.

## Quick reference

| Question                                             | Answer                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Can Claude open a PR?                                | Yes, from `auto/...` or `enhance/...` branches                                   |
| Can Claude merge its own PR?                         | Yes — auto-merge when all gates pass. Else tagged `needs-review`, Viktor merges. |
| Can Claude read `.env.local`?                        | Yes (verify values present)                                                      |
| Can Claude modify `.env.local`?                      | No                                                                               |
| Can Claude call DataForSEO?                          | Yes, under $5/call                                                               |
| Can Claude call DataForSEO for a $20 batch?          | Only with approval                                                               |
| Can Claude use the Anthropic API for autonomous dev? | No — Pro Max x5 only                                                             |
| Can Claude push to `main`?                           | No                                                                               |
| Can Claude read Boxly source?                        | Yes, read-only                                                                   |
| Can Claude deploy to prod?                           | Only via PR merge by Viktor                                                      |

## Auditing

Every action Claude takes leaves a trace:

- Code changes → git history
- PR activity → GitHub events
- Cron API calls → `CronRun` table with `costUsd`
- Session summaries → `.claude/memory/build-log.md`
- Approval requests → GitHub issues tagged `approval-needed`

Audit by reading the build-log weekly. Anything unexpected → open an issue, Claude reads it next session and adjusts.
