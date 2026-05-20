# Handoff · what you do manually

Things I scaffolded vs things only you can do. Work through this list in order. Each item links to the vendor page where you'll get the credential.

## On your laptop (15 minutes)

1. **Clone the repo locally** (from your terminal, not the cloud sandbox):

   ```bash
   cd ~/Documents/Claude/Projects/
   git pull origin main  # or git clone if fresh
   ```

   The scaffold I built is in this directory. The `.git` is initialized, remote set to `git@github.com:sarminvictor/mapsly.git`. You need to push the initial commit:

   ```bash
   cd mapsly
   git add -A
   git commit -m "chore: initial scaffold (Phase 0)"
   git push -u origin main
   ```

2. **Rename hidden-file workarounds** (sandbox blocked dot-prefix writes):

   ```bash
   mv _claude-setup .claude
   mv .mcp.example.json .mcp.json
   ```

   Then commit: `git commit -am "chore: activate .claude/ and .mcp.json"`

3. **Install dependencies:**
   ```bash
   pnpm install
   pnpm typecheck   # should pass on empty modules
   ```

## Vendor accounts (1–2 hours total)

### Neon (Postgres) — required

- Sign up: https://console.neon.tech
- Create a project named `mapsly`
- Get the **pooled** and **direct** connection strings (different URLs!)
- Add to `.env.local`:
  ```
  DATABASE_URL="postgres://...pooler.../mapsly?sslmode=require"
  DIRECT_URL="postgres://.../mapsly?sslmode=require"
  ```
- Run `pnpm db:push` from your laptop to create the schema

### DataForSEO — required (largest cost)

- Sign up: https://app.dataforseo.com
- Add $50 minimum deposit (pay-as-you-go)
- Get your API username + password from `app.dataforseo.com → API Access`
- Add to `.env.local`:
  ```
  DATAFORSEO_USERNAME="your-email@example.com"
  DATAFORSEO_PASSWORD="api-password"
  ```

### Resend (email) — required

- Sign up: https://resend.com
- Verify a sending domain (e.g. `mapsly.ai`) — DNS records take ~10 min
- Create an API key
- Add to `.env.local`:
  ```
  RESEND_API_KEY="re_..."
  RESEND_FROM_EMAIL="login@mapsly.ai"
  ```

### Anthropic API — required

- Sign up: https://console.anthropic.com
- Create API key with $20 credit minimum
- Add to `.env.local`:
  ```
  ANTHROPIC_API_KEY="sk-ant-..."
  ```

### Stripe — required for billing (can be added later)

- Sign up: https://dashboard.stripe.com
- Create products for each tier:
  - SMB Paid · $29/mo
  - Agency Solo · $49/mo
  - Agency Growth · $99/mo
  - Agency Pro · $249/mo
  - Agency Boutique · $499/mo
- Get the price IDs (`price_xxx`) for each
- Get test mode keys: `Developers → API keys`
- Add all to `.env.local`

### Sentry — recommended

- Sign up: https://sentry.io
- Create a Next.js project named `mapsly`
- Run their setup wizard (it auto-configures `sentry.client.config.ts` etc.)
- Add DSN + auth token to `.env.local`

### Google Cloud (for GSC + GA MCP) — recommended for SEO insights

- Create service account: https://console.cloud.google.com/iam-admin/serviceaccounts
- Download JSON key, save to `~/.config/gsc/service-account.json`
- For GSC: grant the service account email **Read** on your verified property at `search.google.com/search-console`
- For GA4: grant the service account email **Viewer** on Property at `analytics.google.com → Admin`
- Add to `.env.local`:
  ```
  GOOGLE_APPLICATION_CREDENTIALS="/Users/yourname/.config/gsc/service-account.json"
  GA4_PROPERTY_ID="123456789"
  ```

### Vercel (hosting) — required for production

- Connect this repo via https://vercel.com/new
- Add all env vars from `.env.local` to Vercel → Project → Settings → Environment Variables
- Enable Cron Jobs (auto-detected from `vercel.json`)
- Generate `CRON_SECRET`: `openssl rand -hex 32`, paste into both `.env.local` and Vercel
- First deploy will fail until the DB exists — run `pnpm db:push` first

### Meta Ad Library — required for ad-intel signals

- Apply for access: https://developers.facebook.com/docs/marketing-api/insights
- Create a Meta app, request `ads_archive_read` permission (instant approval for public ads)
- Generate a long-lived access token
- Add to `.env.local`:
  ```
  META_AD_LIBRARY_ACCESS_TOKEN="EAA..."
  ```

### Vercel Blob — required for PDF storage

- In Vercel dashboard → Storage → Create Blob store
- Copy the read/write token to `.env.local` as `BLOB_READ_WRITE_TOKEN`

## Claude Code cloud (30 min)

Required for autonomous building. See `docs/autonomous-build-setup.md` for the detailed flow. TL;DR:

1. Sign into Claude Code cloud (Anthropic account)
2. Connect the `mapsly` GitHub repo (needs read/write contents + PR permissions)
3. Mirror your `.env.local` secrets into the cloud workspace as env vars
4. Create a scheduled task:
   - Cron: `0 */6 * * *` (4× per day)
   - Max duration: 4h 30min
   - Skill: `/autonomous-build-loop`
5. Run once manually to verify it works
6. Set up branch protection on `main` so all autonomous commits go through PRs

## Validation (15 minutes)

Once everything's wired:

```bash
# Local validation
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm db:push          # creates schema in Neon
pnpm dev              # http://localhost:3000

# Verify each MCP works (from a Claude Code session in the repo)
@claude /db-snapshot  # tests postgres MCP
@claude /seo-check    # tests gsc + ga MCPs (after creds)
```

If `pnpm build` succeeds and `pnpm dev` shows the landing page, you're ready.

## Cost expectations

For the first month of running autonomous + 1 paying customer:

| Item                                      | Monthly                                   |
| ----------------------------------------- | ----------------------------------------- |
| Neon DB (free tier)                       | $0                                        |
| Vercel hobby + cron                       | $0 (within free tier limits)              |
| Vercel Pro (when needed)                  | $20                                       |
| DataForSEO (1 customer · weekly cadence)  | ~$2                                       |
| Anthropic (Haiku + autonomous Claude)     | ~$50–500 (depends on autonomous activity) |
| Resend (free tier 3k emails)              | $0                                        |
| Sentry (free tier)                        | $0                                        |
| Stripe fees                               | 2.9% + 30¢ per transaction                |
| Meta Ad Library / Google Ads Transparency | $0                                        |
| **Total month 1**                         | **~$70–520**                              |

The autonomous Claude is the biggest variable. Cap it via cloud UI if needed.

## What to do next

After everything boots:

1. Run `@claude /autonomous-build-loop` manually once in a Claude Code session
2. Watch Claude pick task `1.1` from `PLAN.md` and run with it
3. Review the PR Claude opens
4. Merge or comment
5. Schedule the autonomous task in cloud UI
6. Check `.claude/memory/build-log.md` daily

You're now a 24/7 software team of one + Claude.

---

## Help / debugging

If something doesn't work:

- DB issue → check Neon dashboard "Compute → Recent Activity"
- DataForSEO issue → check their dashboard for API call logs
- Stripe issue → check Stripe → Developers → Webhook attempts
- Claude Code cloud issue → check the scheduled-task run history in the cloud UI

Issues we've hit before (will track in build-log going forward):

- _empty_ — fresh project

When in doubt, open a Claude Code session at the repo and ask. The context is preloaded via `CLAUDE.md`.

---

## Cowork sandbox recovery (when the loop stops shipping)

Symptom: dev.mapsly.ai shows `lastTickAt` not advancing, or a tick logs `useradd: /etc/passwd.*: No space left on device`. The Cowork sandbox's host writable volume (~9.6 GB) is exhausted by accumulated `/tmp/.pnpm-store`, prior-tick `node_modules`, or `/tmp/mapsly-*` clone orphans.

**Fix (one click):** Restart the Cowork desktop app. The sandbox volume is reprovisioned fresh on next boot — all `/tmp` orphans go away, the host root FS gets reset, the scheduled task picks up on its next 5-min cadence and runs v0.6.20+ GC from STEP 0a.1.

You can confirm recovery on `dev.mapsly.ai`: within ~10 min of the restart, `lastTickAt` should advance and at least one TaskRun row should appear with `[step-0] /tmp now N MB free` where N > 1000.

**The macOS `/loop` fallback is unaffected** by any Cowork issue. If you keep an interactive Claude Code session open on your Mac with `/loop 5m`, it ships from the real macOS filesystem (no FUSE wall, no sandbox volume) and continues even when Cowork is dead. Per CLAUDE.md "Model pin" paragraph, `/loop` is the supported Mac scheduler; per INC-31, Cowork is the supported sandbox scheduler.

## Local mount-side `.git` is read-only

Your `~/Documents/Claude/Projects/mapsly/.git` directory lives behind the Cowork FUSE mount layer, which silently blocks the `unlink()` syscall on packfile object promotion (INC-29). This means `git fetch` against the local `.git` returns exit-0 but never advances `origin/main` refs — your local `git log` lies. The autonomous loop sidesteps this by running entirely from `/tmp` clones (INC-31), so it doesn't affect shipping.

To restore your local terminal's view of the repo on your Mac (one-time, when you want to inspect recent code locally):

```bash
cd ~/Documents/Claude/Projects/mapsly
rm -rf .git
git clone --no-checkout https://github.com/sarminvictor/mapsly.git .git-fresh
mv .git-fresh/.git .git
rm -rf .git-fresh
git fetch origin main
git reset --hard origin/main
```

After that your local terminal will reflect what's actually on `origin/main`. Re-run if you ever find `git log` doesn't show recent commits you can see on GitHub.
