# Mapsly · setup guide

> Follow this in order. Each section has a time estimate and a "✓ verify" step. Total: **~3–4 hours** of work + waiting for DNS/deploy.

## Cost summary upfront

| Item                                          | One-time       | Monthly                  |
| --------------------------------------------- | -------------- | ------------------------ |
| Domain (mapsly.ai)                            | $80–120/yr     | —                        |
| DataForSEO deposit (pay-as-you-go)            | $50            | ~$10–60 (usage-based)    |
| Anthropic API credits (for in-product AI)     | $20            | ~$10–50                  |
| Neon Postgres                                 | $0 (free tier) | $0–19 (when scaling)     |
| Vercel Pro (needed for cron + Speed Insights) | $0             | $20                      |
| Resend (3k emails free)                       | $0             | $0–20                    |
| Sentry (free tier)                            | $0             | $0                       |
| Stripe (transaction fees only)                | $0             | 2.9% + 30¢ per txn       |
| **Total upfront**                             | **~$150**      | **~$30–150/mo at scale** |

You already have **Claude Pro Max 20x** (autonomous dev runs on this, $0 marginal).

---

## Phase A · Local repo (15 min)

### A.1 · Push the initial commit

On your laptop:

```bash
cd ~/Documents/Claude/Projects/mapsly
git status
# should show ~62 untracked files + the docs/_design folders
```

Initial commit + push:

```bash
git add -A
git commit -m "feat: Phase 0 · scaffold + quality gates + i18n + autonomous loop v3"
git push -u origin main
```

✓ **Verify:** open `https://github.com/sarminvictor/mapsly` — you should see all files.

### A.2 · Activate hidden-dotfiles (sandbox can't write `.claude/` directly)

```bash
mv _claude-setup .claude
mv .mcp.example.json .mcp.json
git add -A
git commit -m "chore: activate .claude/ + .mcp.json"
git push
```

✓ **Verify:** `ls -la .claude/` shows `agents/`, `rules/`, `skills/`. `cat .mcp.json` shows the 6 MCP servers.

### A.3 · Install dependencies

```bash
pnpm install
```

(Use Node 24 · `nvm use 24` or rely on `.nvmrc`)

✓ **Verify:**

```bash
pnpm typecheck    # should pass (will pass on empty modules)
```

If you get errors here, that's OK — some are about generated Prisma client which we haven't run yet. Continue.

---

## Phase B · Vendor accounts (45 min)

### B.1 · Neon (Postgres) — required first

1. Sign up: https://console.neon.tech
2. Create a new project named `mapsly` · region: `US East (Ohio)` or your nearest
3. From the project dashboard, click **Connection Details**
4. Copy two URLs:
   - **Pooled connection string** — for `DATABASE_URL`
   - **Direct connection string** — for `DIRECT_URL`

Create `.env.local` from the template:

```bash
cp .env.example .env.local
```

Edit `.env.local` and paste both URLs:

```
DATABASE_URL="postgres://user:pass@ep-xxx-pooler.us-east-1.aws.neon.tech/mapsly?sslmode=require"
DIRECT_URL="postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/mapsly?sslmode=require"
```

Generate auth secret:

```bash
openssl rand -base64 32
```

Paste into `AUTH_SECRET` in `.env.local`.

Generate cron secret:

```bash
openssl rand -hex 32
```

Paste into `CRON_SECRET`.

Push the Prisma schema:

```bash
pnpm db:generate    # generates Prisma Client
pnpm db:push        # creates tables in Neon
```

✓ **Verify:** open Neon dashboard → tables. You should see `Business`, `BusinessSnapshot`, `Review`, `Lead`, `List`, etc.

### B.2 · Resend (email) — required for sign-in

1. Sign up: https://resend.com
2. Add domain `mapsly.ai` (or temporarily use the auto-generated one). DNS propagation takes ~10min.
3. Create API key: **API Keys → Create**
4. Copy the key

In `.env.local`:

```
RESEND_API_KEY="re_xxx"
RESEND_FROM_EMAIL="login@mapsly.ai"
RESEND_REPLY_TO="support@mapsly.ai"
```

✓ **Verify:** in Resend dashboard, the domain shows "Verified".

### B.3 · Anthropic API (for in-product AI features only)

> NOT for autonomous dev — that's your Pro Max 20x plan. This is for the _product_ features: AI sentiment, AI reply drafts, one-pager copy generation.

1. Sign up: https://console.anthropic.com
2. **Settings → Billing** — add $20 minimum credit
3. **API Keys → Create Key**
4. Copy

In `.env.local`:

```
ANTHROPIC_API_KEY="sk-ant-xxx"
```

✓ **Verify:** test the key:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

Returns 200 with a message.

### B.4 · Vercel (hosting)

1. Sign in: https://vercel.com (use GitHub)
2. **Add New → Project → Import** `sarminvictor/mapsly`
3. **Framework Preset:** Next.js (auto-detected)
4. **Build & Output:** defaults are fine
5. Click **Deploy** — it'll fail the first time because env vars aren't set yet. That's OK.
6. After failed deploy, go to **Settings → Environment Variables** and add **every line from `.env.local`** (paste each as a separate var)
7. Also add these Vercel-only vars:
   - `VERCEL_URL` (auto-set)
   - Set environments: Production + Preview + Development
8. **Settings → Domains** — add `mapsly.ai` and `dev.mapsly.ai`
   - DNS records: Vercel shows you what A/CNAME records to add at your registrar
9. **Settings → Plans → Pro** ($20/mo) — required for:
   - Cron jobs (free hobby tier doesn't include them)
   - Speed Insights (real-user CWV)
   - Vercel Blob storage with the 100GB tier

Generate `BLOB_READ_WRITE_TOKEN`:

- **Storage → Create Database → Blob** · name it `mapsly-blob`
- Copy the `BLOB_READ_WRITE_TOKEN`, add to Vercel env vars + `.env.local`

Vercel KV (for rate-limit + dedup cache):

- **Storage → Create Database → KV** · name it `mapsly-kv`
- Copy `KV_REST_API_URL` + `KV_REST_API_TOKEN`, add to Vercel + `.env.local`

✓ **Verify:** Trigger a new deploy. Should succeed. Open `https://mapsly.ai` — landing scaffold renders.

---

## Phase C · External data APIs (30 min)

### C.1 · DataForSEO (largest cost — required)

1. Sign up: https://app.dataforseo.com
2. **Top-up balance** — minimum $50 deposit (lasts months at our usage)
3. **API Access** — copy username + password (NOT the dashboard login)

In `.env.local` + Vercel env vars:

```
DATAFORSEO_USERNAME="your-email@example.com"
DATAFORSEO_PASSWORD="api-password-not-login-password"
```

✓ **Verify:** test the credentials:

```bash
curl -X POST https://api.dataforseo.com/v3/business_data/google/my_business_info/live \
  -H "Authorization: Basic $(echo -n $DATAFORSEO_USERNAME:$DATAFORSEO_PASSWORD | base64)" \
  -H "Content-Type: application/json" \
  -d '[{"keyword":"med spa miami","location_code":2840,"language_code":"en"}]'
```

Returns 200 with results.

### C.2 · Meta Ad Library — free but requires app

1. Go to: https://developers.facebook.com/docs/marketing-api/insights/ads-archive
2. Create a Meta App (Business type)
3. Request `ads_archive_read` permission (instant approval for public ads)
4. **Tools → Graph API Explorer** — generate a User Access Token with the permission
5. Use https://developers.facebook.com/tools/debug/accesstoken/ to extend it to a long-lived token (60 days)

Set up a reminder to rotate every 50 days.

In `.env.local`:

```
META_AD_LIBRARY_ACCESS_TOKEN="EAAxxx..."
```

✓ **Verify:** test:

```bash
curl "https://graph.facebook.com/v21.0/ads_archive?search_terms=med+spa&ad_active_status=ACTIVE&ad_reached_countries=US&access_token=$META_AD_LIBRARY_ACCESS_TOKEN&limit=1"
```

Returns 200 with ads.

### C.3 · Google Cloud service account (for GSC + GA MCPs)

For the SEO + analytics MCPs.

1. https://console.cloud.google.com → create project `mapsly-mcp`
2. **APIs & Services → Library** — enable:
   - Google Search Console API
   - Google Analytics Data API
3. **IAM & Admin → Service Accounts → Create** · name `mapsly-mcp-reader`
4. Skip role assignment (we grant per-resource below)
5. After creation: **Keys → Add Key → JSON** — download the file
6. Save it as `~/.config/gsc/service-account.json` (chmod 600 it)

Grant GSC access:

- https://search.google.com/search-console → Settings → Users and permissions → Add user
- Email = the service-account email (`mapsly-mcp-reader@mapsly-mcp.iam.gserviceaccount.com`)
- Permission: **Restricted**

Grant GA4 access:

- https://analytics.google.com → Admin → Property Access Management → +
- Same service-account email
- Role: **Viewer**

In `.env.local`:

```
GOOGLE_APPLICATION_CREDENTIALS="/Users/yourname/.config/gsc/service-account.json"
GA4_PROPERTY_ID="123456789"   # from GA4 → Admin → Property Settings
```

✓ **Verify:** when Claude Code starts in the repo, it loads `.mcp.json`. From a Claude Code session: `@claude /seo-check` — should connect.

### C.4 · Stripe (billing — can be deferred to Phase 7)

1. https://dashboard.stripe.com → Sign up
2. **Products** — create:
   - SMB Paid · $29/mo recurring
   - Agency Solo · $49/mo recurring
   - Agency Growth · $99/mo recurring
   - Agency Pro · $249/mo recurring
   - Agency Boutique · $499/mo recurring
3. Copy each price ID (format `price_xxx`)
4. **Developers → API keys** — copy test mode `sk_test_xxx` and `pk_test_xxx`
5. **Developers → Webhooks** — create endpoint `https://mapsly.ai/api/webhooks/stripe` · listen for: `invoice.*`, `customer.subscription.*`, `checkout.session.completed`
6. Copy the webhook signing secret

In `.env.local`:

```
STRIPE_SECRET_KEY="sk_test_xxx"
STRIPE_PUBLISHABLE_KEY="pk_test_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
STRIPE_PRICE_SMB_PAID="price_xxx"
STRIPE_PRICE_AGENCY_SOLO="price_xxx"
STRIPE_PRICE_AGENCY_GROWTH="price_xxx"
STRIPE_PRICE_AGENCY_PRO="price_xxx"
STRIPE_PRICE_AGENCY_BOUTIQUE="price_xxx"
```

✓ **Verify:** Stripe dashboard shows webhook endpoint as "Active".

### C.5 · Sentry (error tracking)

1. https://sentry.io → Create account · org `mapsly`
2. **Projects → Create Project → Next.js** · name `mapsly-app`
3. Run their setup CLI:

```bash
npx @sentry/wizard@latest -i nextjs
```

It will:

- Add `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Add DSN + auth token to `.env.local`
- Update `next.config.ts` to wrap with Sentry

Add to Vercel env vars:

```
SENTRY_DSN
SENTRY_AUTH_TOKEN
SENTRY_ORG=mapsly
SENTRY_PROJECT=mapsly-app
```

✓ **Verify:** Sentry dashboard shows "Waiting for first event" or first event from your local dev run.

---

## Phase D · GitHub setup (15 min)

### D.1 · Branch protection on `main`

https://github.com/sarminvictor/mapsly/settings/branches

Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require approvals: **0** (Claude's auto-merge needs 0 required; the gates are the approval)
- ✅ Require status checks to pass:
  - Add `ci-passed` (from `.github/workflows/ci.yml`)
- ✅ Require branches to be up to date before merging
- ✅ Require linear history (squash-merge only)
- ✅ Do not allow bypassing the above settings
- ❌ Allow force pushes (off)
- ❌ Allow deletions (off)

### D.2 · GitHub Actions secrets

https://github.com/sarminvictor/mapsly/settings/secrets/actions

Required:

- `DATABASE_URL` — Neon test branch (NOT production) for CI runs
- `DIRECT_URL` — same Neon test branch direct

Optional but useful:

- `VERCEL_TOKEN` — for richer deploy info in PR comments
- `SENTRY_AUTH_TOKEN` — for source map uploads

### D.3 · Allow auto-merge

https://github.com/sarminvictor/mapsly/settings → **Pull Requests** section:

- ✅ Allow squash merging
- ✅ **Allow auto-merge**
- ❌ Allow merge commits (off)
- ❌ Allow rebase merging (off)

### D.4 · Label for autonomous PRs

https://github.com/sarminvictor/mapsly/labels → New label:

- Name: `autonomous-ready`
- Description: "All quality gates passed — eligible for auto-merge"
- Color: `#22c55e`

The autonomous loop adds this label after gates pass. The `.github/workflows/auto-merge.yml` workflow watches for it.

Also create:

- `needs-review` (yellow `#f59e0b`) — gates failed, Viktor must look
- `enhancement` (blue) — for process-enhancer PRs

✓ **Verify:** open the labels page · all 3 exist.

---

## Phase E · Local dev validation (15 min)

```bash
pnpm dev
```

Open http://localhost:3000

✓ **Verify:**

- Landing scaffold renders
- No console errors
- Click through to /signin (placeholder) · email field present

Run typecheck + build:

```bash
pnpm typecheck
pnpm build
```

✓ **Verify:** both pass.

---

## Phase F · Claude scheduled tasks (15 min)

This is the engine.

### F.1 · Open Claude desktop app (or web app) signed into Pro Max 20x

Verify your subscription tier — Settings → Account → Plan should say **Pro Max 20x** (or whatever the highest plan is called now).

### F.2 · Schedule the autonomous build loop

1. Open Claude
2. Start a new chat: select the `mapsly` workspace (or open it from your computer)
3. Run once manually:
   ```
   @claude /autonomous-build-loop
   ```
4. Watch what happens:
   - Claude reads CLAUDE.md, PLAN.md, build-log
   - Picks Phase 1.1 from PLAN.md (lowest pending)
   - Creates branch `auto/2026-MM-DD-1.1`
   - Implements
   - Opens PR
   - Auto-merges if gates pass, else tags `needs-review`
   - Picks next task
5. Schedule recurring: in the chat, after the first session ends:
   ```
   @claude schedule the autonomous-build-loop to run every 6 hours
   ```
   Claude uses `mcp__scheduled-tasks__create_scheduled_task` to set:
   - Cron: `0 */6 * * *`
   - Max duration: 5h
   - First action: invoke `/autonomous-build-loop`

### F.3 · Schedule process-enhancer (daily)

Similarly:

```
@claude schedule the process-enhancer to run daily at 09:00 UTC
```

This is the meta-loop that improves the build loop.

### F.4 · Verify scheduled tasks

```
@claude /mapsly  # show available skills
@claude list scheduled tasks
```

You should see:

- `autonomous-build-loop` · every 6h
- `process-enhancer` · daily at 09:00 UTC

---

## Phase G · Domain DNS (waiting time: 10min – 24h)

If you haven't yet:

### G.1 · Buy mapsly.ai

- Registrar: Cloudflare ($$80–120/yr) or Namecheap or your preference
- Buy `mapsly.ai`
- Don't bother with WHOIS privacy on `.ai` TLDs (they're public by default)

### G.2 · DNS records pointing to Vercel

Vercel's domain setup page shows the exact records. Typically:

For `mapsly.ai`:

- A record · `@` · `76.76.21.21`
- AAAA record · `@` · Vercel's IPv6

For `dev.mapsly.ai`:

- CNAME · `dev` · `cname.vercel-dns.com`

For `app.mapsly.ai` (optional — if you want auth-gated routes on a subdomain later):

- CNAME · `app` · `cname.vercel-dns.com`

✓ **Verify:** after propagation (10min – 24h):

- `dig mapsly.ai` resolves
- `https://mapsly.ai` shows your landing
- `https://dev.mapsly.ai` shows the dashboard (after Phase 1.10 ships)

---

## Phase H · First autonomous run + handoff (30 min)

By now, the autonomous loop has already run once (from F.2). Now verify the end-to-end flow.

### H.1 · Watch the first auto-merge

1. Open the GitHub repo → Pull Requests
2. You should see PR(s) from `auto/...` branches opened by Claude
3. Check the labels — `autonomous-ready` means it passed gates
4. The auto-merge workflow squash-merges, deletes the branch, Vercel auto-deploys main

✓ **Verify:** `https://mapsly.ai` shows the latest auto-shipped content.

### H.2 · Watch the dashboard

After Phase 1.10 ships (the loop will build it), visit `https://dev.mapsly.ai`:

- Sessions timeline shows recent sessions
- Currently working on · shows the live task
- PLAN.md progress · shows what's done vs pending
- API spend · within budget

### H.3 · Daily routine going forward

Every morning:

1. Open GitHub → check the PRs labeled `needs-review` (these are the ones where gates failed)
2. Read the PR description — Claude tells you which dimension failed and why
3. Decide: merge anyway? Request changes? Reject?
4. Look at `https://dev.mapsly.ai` to see overall progress
5. Look at `.claude/memory/build-log.md` for session summaries

Once a week:

1. Read the daily GitHub digest email (configure in GitHub notification preferences)
2. Check the dashboard for cost trends, MCP health, failure patterns
3. Update `MEMORY.md` if you've discovered a preference you want Claude to remember

---

## Phase I · Boxly reference access (5 min)

For Claude to read Boxly as reference:

1. Open Claude Code workspace
2. Add `~/Documents/Boxly_development/boxly_app` as a workspace folder
3. From any mapsly session, Claude can read Boxly files via the Read tool

This is already configured in your Cowork desktop app (per the system reminder we've seen). Just verify by:

```
@claude can you read /Users/Viktor/Documents/Boxly_development/boxly_app/CLAUDE.md ?
```

If yes, you're set.

---

## When you're done

You'll know everything's working when:

- ✅ `https://mapsly.ai` renders the landing (Phase A through D)
- ✅ `pnpm dev` runs locally without errors (Phase E)
- ✅ Claude opens its first PR (Phase F)
- ✅ Auto-merge gates work (gates fail OR pass cleanly) (Phase H)
- ✅ `https://dev.mapsly.ai` shows the build dashboard (Phase 1.10 of PLAN.md, autonomous build will deliver)

Total: **~3 hours active + DNS wait**.

After that, the loop runs 24/7 on Pro Max 20x. You watch via the dashboard, merge PRs labeled `needs-review`, and rest.

---

## Emergency stop

If something goes wrong:

1. **Pause autonomous tasks** — Claude desktop → Scheduled tasks → toggle off
2. **Revert a bad merge** — Use GitHub's "Revert" button on the merge commit
3. **Disable Vercel auto-deploy from main** — Settings → Git → toggle off Production Branch
4. **Roll back DataForSEO spend** — DataForSEO has no rollback, but you can cap daily spend in their dashboard
5. **Rotate compromised secrets** — every vendor has a "rotate key" flow; update `.env.local` + Vercel env vars
