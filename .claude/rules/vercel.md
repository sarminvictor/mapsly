# Vercel · canonical rule for the 5 vercel-tagged INCs

Vercel's build container has narrower runtime semantics than local `pnpm dev`: no Neon WebSocket, no `process.env` at module-load time, no `prisma generate` unless asked, no commit author trust without verified email. The 5 incidents tagged `vercel` cluster into 4 mechanical checks. **All four are enforceable via `pnpm deploy-check` or a pre-push grep.**

## 1 · Commit author identity matches a GitHub user with repo write access (INC-10)

Vercel rejects deploys when the latest commit's author email isn't registered to a GitHub account with write access on the repo. Symptom: PR opens, CI green, Vercel comment never appears, `gh pr view` shows "deploy=blocked".

```bash
# ✅ Required for every commit pushed via the loop or by Viktor
git config user.email "sarminvictor@gmail.com"
git config user.name  "Viktor"
```

The loop's STEP 0 sets this explicitly per `.claude/loop.md`. Manual commits from Viktor's Mac inherit it from `~/.gitconfig`.

**Mechanical check (pre-push hook):**

```bash
expected="sarminvictor@gmail.com"
got="$(git log -1 --format='%ae')"
if [ "$got" != "$expected" ]; then
  echo "ABORT: commit author $got, expected $expected (INC-10 — Vercel won't deploy)"
  exit 1
fi
```

NEVER use a bot identity (`claude@mapsly.ai`, `actions@github.com`, etc.) as committer on a Vercel-connected repo.

## 2 · `prisma generate` is required at install + build time (INC-06)

Vercel's build runner doesn't run `prisma generate` automatically. `lib/generated/prisma/` will be missing, TS will fail to compile.

```json
// ✅ package.json
"scripts": {
  "postinstall": "prisma generate",
  "build":       "prisma generate && next build"
}
```

Cross-reference: `.claude/rules/prisma.md` § 4.

## 3 · No `process.env` reads at module load time (INC-07)

Vercel's build container runs in TWO phases:

1. **Build phase** — sets only `VERCEL_*` envs. User-defined envs are NOT injected.
2. **Runtime phase** (after deploy) — all envs available.

`new PrismaClient()`, `new Stripe(SK)`, `new Anthropic(API_KEY)` at module scope all read envs during build → constructor throws → opaque build failure.

```ts
// ❌ MODULE-SCOPE EVAL: build fails because process.env.STRIPE_SECRET_KEY is undefined
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ✅ LAZY PROXY: instantiated on first runtime call
function getStripe(): Stripe {
  if (!globalThis.__stripe) {
    globalThis.__stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return globalThis.__stripe;
}
export default new Proxy({} as Stripe, {
  get(_t, prop, recv) {
    return Reflect.get(getStripe(), prop, recv);
  },
}) satisfies Stripe;
```

This pattern applies to: Prisma, Stripe, Resend, Anthropic, DataForSEO, Sentry, KV — anything that takes a secret in its constructor.

**Mechanical check:** `pnpm build` locally (with `.env.local` populated) is necessary but not sufficient. The detection that matters is `pnpm deploy-check` (alias for the Vercel build pipeline) running in CI with EMPTY envs:

```bash
# Reproduce Vercel's build phase locally
env -i PATH=/usr/local/bin:/usr/bin pnpm build
# If this fails with "undefined is not a function" on a client constructor, you have INC-07.
```

## 4 · `vercel link` is a one-time bootstrap, not a noop (INC-12)

`vercel env`, `vercel deploy`, `vercel logs` require the project to be `linked` to a directory. First-time setup OR a fresh clone (e.g., a Cowork sandbox tick) MUST run `vercel link --yes` before any other `vercel` command.

```bash
# ✅ One-time on fresh clone
vercel link --yes --project mapsly --org viktor

# Then any vercel command works:
vercel env pull .env.production.local
vercel deploy --prebuilt
```

Add to `docs/handoff.md` § Vercel bootstrap. NOT something the loop does per-tick — it's only relevant when the dev/scripts machine is new.

## 5 · Vercel build cannot open Neon WebSockets (INC-27)

The Vercel build worker is locked-down: it can call HTTP outward, but the WebSocket upgrade to Neon's serverless endpoint fails (firewalled / DNS-blocked).

Every `'use cache'` Prisma query that touches the DB must short-circuit at build time using a `NEXT_PHASE === "phase-production-build"` guard and return an `EMPTY_*` typed constant. Cross-reference: `.claude/rules/prisma.md` § 7 and `.claude/rules/cache-components.md` Pattern 1.

```ts
"use cache";
export async function getDashboardData(): Promise<DashboardData> {
  if (process.env.NEXT_PHASE === "phase-production-build")
    return EMPTY_DASHBOARD_DATA;
  try {
    return await prisma.dashboardData.findFirstOrThrow({
      /* ... */
    });
  } catch {
    return EMPTY_DASHBOARD_DATA;
  }
}
```

## Anti-patterns (block at review)

- ❌ Commit by `claude@anthropic.com` / `bot@github.com` on a Vercel repo (INC-10)
- ❌ `new PrismaClient()` / `new Stripe(...)` / any client at module scope (INC-07)
- ❌ Build script missing `prisma generate` (INC-06)
- ❌ Scripts that call `vercel env` / `vercel deploy` from an unlinked project (INC-12)
- ❌ `'use cache'` Prisma query lacking the NEXT_PHASE guard (INC-27)

## Cites

INC-06, 07, 10, 12, 27 — see `.claude/memory/incidents.md`.

## See also

- `.claude/rules/prisma.md` for the Prisma 7 specifics
- `.claude/rules/cache-components.md` Pattern 1 for the EMPTY\_\* shape rules
- `.claude/rules/git-discipline.md` for commit identity beyond just Vercel
