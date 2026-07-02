# Vercel · build + deploy semantics

Vercel's build container is narrower than local `pnpm dev`: no DB WebSockets, no user envs at module-load time, no `prisma generate` unless asked, no commit-author trust without a verified email. All checks here are mechanical — enforceable via deploy-check or a pre-push grep. Deploy branch + push policy are product-defined (`.claude/product-spec.json` → `repo`).

## 1 · Commit author identity must map to a host account with write access (INC-10)

Vercel refuses to deploy when the latest commit's author email isn't registered to an account with write access on the connected repo (GitHub or GitLab). Symptom: CI green, deploy silently never happens. Never commit as a bot identity (`claude@…`, `actions@…`) to a Vercel-connected repo.

```bash
# Pre-push hook
expected="<owner-verified-email>"   # the repo owner's registered host email
got="$(git log -1 --format='%ae')"
if [ "$got" != "$expected" ]; then
  echo "ABORT: author $got, expected $expected (INC-10 — Vercel won't deploy)"
  exit 1
fi
```

## 2 · `prisma generate` is required at install + build time (INC-06)

One line: see `prisma.md` §4 (`postinstall` + `build` script prefix). Vercel never runs it for you.

## 3 · Two-phase env model — no `process.env` reads at module load (INC-07)

The build container runs in TWO phases:

1. **Build phase** — only `VERCEL_*` envs exist. User-defined envs are NOT injected.
2. **Runtime phase** — all envs available.

Any client constructed at module scope with a secret (`new Stripe(SK)`, `new PrismaClient()`, …) reads envs during build → throws → opaque failure. The fix is the lazy-Proxy pattern — `prisma.md` §3 owns it; replicate for every secret-bearing vendor client.

**Mechanical check** — reproduce the build phase locally:

```bash
env -i PATH=/usr/local/bin:/usr/bin pnpm build
# Failure on a client constructor = INC-07.
```

The one allowed module-load env read: a Zod-validated `lib/env.ts` that is a runtime entry (never imported by build-phase code) — intentional fail-fast.

## 4 · `vercel link` is a one-time bootstrap, not a noop (INC-12)

`vercel env`, `vercel deploy`, `vercel logs` all require `.vercel/project.json`. On any fresh clone:

```bash
vercel link --yes --project <project> --scope <team>
```

Add to the repo's handoff/bootstrap doc. Not a per-session step — only on new checkouts.

## 5 · Build worker cannot open Neon WebSockets (INC-27)

The build container can fetch HTTP but the WebSocket upgrade to Neon fails. Every `'use cache'` Prisma query must short-circuit at build phase — `cache-components.md` Pattern 1 owns the NEXT_PHASE + `EMPTY_*` pattern.

## 6 · Cron jobs can be disabled project-wide, silently (INC-45)

Vercel has a project-level Cron Jobs toggle (`Settings → Cron Jobs`). When OFF, `vercel crons ls` reports `(disabled)` and NOTHING errors — every async pipeline (webhook reconciliation, snapshot/scoring chains, cleanup jobs) silently starves. Downstream symptom: pages render dashes/empties while raw data exists.

**Mechanical check (launch + handoff checklist):** `vercel crons ls` must NOT print `(disabled)`. Also: any manual/ad-hoc bulk job must trigger its downstream compute chain by hand — scheduled crons only cover the schedule, not out-of-band bursts.

## 7 · Function duration is capped

Serverless functions die at `maxDuration` (300s max on Pro) and are billed wall-clock while held open. Don't build long-lived connections (SSE watch sessions, socket subscriptions) on Vercel functions — see `data-fetching.md` Pattern 5 for the poll+Redis alternative.

## Anti-patterns (block at review)

- ❌ Bot identity as commit author on a Vercel-connected repo (INC-10)
- ❌ Secret-bearing client at module scope (INC-07)
- ❌ Build script missing `prisma generate` (INC-06)
- ❌ `vercel env` / `vercel deploy` from an unlinked checkout (INC-12)
- ❌ `'use cache'` Prisma query without the build-phase guard (INC-27)
- ❌ Shipping a launch without checking `vercel crons ls` for `(disabled)` (INC-45)
- ❌ Long-lived SSE/socket held open on a serverless function

## See also

- `prisma.md` — Prisma 7 specifics, lazy-Proxy pattern
- `cache-components.md` Pattern 1 — build-phase guard shape
- The product repo's git-discipline rule — commit identity beyond Vercel
