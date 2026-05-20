# Incidents · the institutional memory

Append-only log of failures + their preventions. Read first on every session.

See `.claude/rules/incident-prevention.md` for the rules.

---

### INC-2026-05-19-01 · sandbox cannot unlock stale .git/index.lock

**Status:** ♻️ SUPERSEDED BY INC-31 — Loop runs from /tmp clone; the FUSE-mounted .git is no longer touched.

**Symptom:** `rm: cannot remove '.git/index.lock': Operation not permitted`, even though the file is owned by the current user. Cascades into "fatal: Unable to create '.git/index.lock'" on every git operation.

**Root cause:** The sandbox's bind mount of the user's working directory has file-level write restrictions for files created by a different sandbox session. Lockfiles created by one sandbox can outlive that sandbox but cannot be removed by a new one.

**Fix applied:** Use `GIT_DIR=/tmp/<scratch>` and `GIT_WORK_TREE=/sessions/.../mnt/mapsly` to point git at a fresh, sandbox-writable git directory. The working tree stays in the mount, but all `.git` operations write to `/tmp`.

```bash
mkdir -p /tmp/mapsly-git
export GIT_DIR=/tmp/mapsly-git GIT_WORK_TREE=/sessions/happy-intelligent-dirac/mnt/mapsly
git init --initial-branch=main
git config user.email "sarminvictor@gmail.com"
git config user.name "Viktor"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/sarminvictor/mapsly.git"
```

**Prevention:** Never `git init` directly inside the mounted working tree from the sandbox. Always create the git dir in `/tmp` and bind it via env. If the user later does `git status` from their own terminal and sees no commits, they should `rm -rf .git && git init -b main && git remote add origin ... && git fetch && git reset --hard origin/main` to sync.

**Where encoded:** This file. `.claude/rules/incident-prevention.md` mentions sandbox workflow friction.
**Confidence:** high
**Tags:** sandbox, git, filesystem-permissions

---

### INC-2026-05-19-02 · Prisma 7 forbids `url` and `directUrl` in datasource block

**Status:** ✅ FIXED + ENCODED — Encoded in `prisma/schema.prisma` + `prisma.config.ts`.

**Symptom:** `prisma generate` fails with `Error code: P1012 · error: The datasource property 'url' is no longer supported in schema files. Move connection URLs for Migrate to prisma.config.ts`.

**Root cause:** Prisma 7 (released late 2025) split datasource configuration: schema.prisma keeps only `{ provider }`, and the URL lives in `prisma.config.ts`.

**Fix applied:** In `prisma/schema.prisma`:

```prisma
datasource db { provider = "postgresql" }
```

In `prisma.config.ts`:

```ts
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
});
```

Note: the `Datasource` type only allows `{ url, shadowDatabaseUrl }` — no `directUrl` field. Pass the direct URL through `DIRECT_URL` env var.

**Prevention:** Any PR that touches `prisma/schema.prisma` must keep the `datasource` block to just `{ provider }`. Any URL goes in `prisma.config.ts`. Add a `pnpm deploy-check` step that fails if `url =` appears inside the datasource block.

**Where encoded:** `prisma/schema.prisma`, `prisma.config.ts`, this file.
**Confidence:** high
**Tags:** prisma, prisma-7, breaking-change

---

### INC-2026-05-19-03 · PrismaNeon adapter takes PoolConfig directly, not new Pool()

**Status:** ✅ FIXED + ENCODED — Encoded in `lib/prisma.ts` lazy proxy.

**Symptom:** `TypeScript error TS2559: Type 'Pool' has no properties in common with type 'PoolConfig'`

**Root cause:** The `@prisma/adapter-neon@7.x` constructor signature changed from `new PrismaNeon(pool)` to `new PrismaNeon(poolConfig)`. Old pattern `new Pool({ connectionString })` is no longer needed — the adapter creates its own pool internally.

**Fix applied:** In `lib/prisma.ts`:

```ts
// ❌ old: const pool = new Pool({ connectionString }); const adapter = new PrismaNeon(pool);
// ✅ new:
const adapter = new PrismaNeon({ connectionString });
```

Also drop `import { Pool } from "@neondatabase/serverless"` — no longer needed.

**Prevention:** When upgrading any `@prisma/adapter-*` major version, grep for `new Pool(` near `new Prisma{Adapter}(` and review the constructor signature.

**Where encoded:** `lib/prisma.ts`, this file.
**Confidence:** high
**Tags:** prisma, adapter-neon, breaking-change

---

### INC-2026-05-19-04 · vitest fails CI when no test files exist yet

**Status:** ✅ FIXED + ENCODED — `--passWithNoTests` in `package.json` scripts.

**Symptom:** `vitest run` exits with code 1 on an empty test suite ("No test files found, exiting with code 1"). CI `test` job fails on scaffold.

**Root cause:** Vitest's default behavior is to treat zero matched files as an error. Reasonable in mature repos, harmful during scaffolding.

**Fix applied:** Add `--passWithNoTests` to test scripts:

```json
"test:run": "vitest run --passWithNoTests",
"test:coverage": "vitest run --coverage --passWithNoTests"
```

**Prevention:** Any new repo starts with `--passWithNoTests` on the CI script. Remove it once test count > 0 (or leave it — once tests exist, the flag is a no-op).

**Where encoded:** `package.json` scripts, this file.
**Confidence:** high
**Tags:** vitest, ci, scaffolding

---

### INC-2026-05-19-05 · ESLint 9 + FlatCompat + next/typescript hits circular JSON

**Status:** ✅ FIXED + ENCODED — Encoded in `eslint.config.mjs`.

**Symptom:** `eslint` invocation fails with `TypeError: Converting circular structure to JSON ... property 'react' closes the circle` deep inside `@eslint/eslintrc` config-validator.

**Root cause:** `eslint-config-next` v16 ships native flat-config arrays. Wrapping them through `FlatCompat.extends()` re-flattens the configs, and Next's React plugin ends up cross-referencing itself.

**Fix applied:** In `eslint.config.mjs`, import the flat-config arrays directly — no FlatCompat:

```js
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default [...nextCoreWebVitals, ...nextTypescript /* overrides */];
```

**Prevention:** When the config library already exports a flat config (check `Array.isArray(import('lib').default)`), do not wrap in FlatCompat. Reach for FlatCompat only for legacy `.eslintrc.*` shapes.

**Where encoded:** `eslint.config.mjs`, this file.
**Confidence:** high
**Tags:** eslint, next, flat-config

---

### INC-2026-05-19-06 · Vercel build skips `prisma generate` → missing generated client

**Status:** ✅ FIXED + ENCODED — `postinstall: prisma generate` in `package.json`.

**Symptom:** Vercel deploy errors immediately after `pnpm install`. Error happens during `next build` because `import { PrismaClient } from "@/lib/generated/prisma/client"` resolves to a non-existent path.

**Root cause:** Vercel runs `pnpm install && pnpm build`. Our CI also runs `pnpm db:generate` as a separate step; Vercel doesn't. Without `prisma generate`, `lib/generated/prisma/` is empty.

**Fix applied:** Add `postinstall: prisma generate` to `package.json`. Belt-and-suspenders also prefix the build script:

```json
"scripts": {
  "build": "prisma generate && next build",
  "postinstall": "prisma generate"
}
```

**Prevention:** Every Prisma-using project must have `postinstall: prisma generate`. Add to project bootstrap checklist.

**Where encoded:** `package.json`, this file.
**Confidence:** high
**Tags:** prisma, vercel, build

---

### INC-2026-05-19-07 · Module-load env access crashes Vercel build

**Status:** ✅ FIXED + ENCODED — Encoded in `.claude/rules/security.md` § Module-load + lazy-proxy pattern in `lib/prisma.ts`, Stripe/Resend/Anthropic clients.

**Symptom:** Vercel build fails after `prisma generate` runs cleanly. Stack trace shows `Error: DATABASE_URL not set` at module-top-level in `lib/prisma.ts`.

**Root cause:** Vercel's build phase doesn't have runtime env vars (until you explicitly mark them as Build-time). When Next imports `lib/prisma.ts`, the top-level `const prisma = makeClient()` runs and throws because `process.env.DATABASE_URL` is undefined.

**Fix applied:** Lazy-instantiate via Proxy so the client is constructed on first property access, not at import time:

```ts
function getClient(): PrismaClient {
  if (!globalThis.__prisma) globalThis.__prisma = makeClient();
  return globalThis.__prisma;
}
const prisma = new Proxy({} as PrismaClient, {
  get(_t, prop, recv) {
    return Reflect.get(getClient(), prop, recv);
  },
});
export default prisma;
```

**Prevention:** Never read env vars at module-top-level for things instantiated at import. Always defer to first use. Same pattern for Stripe, Resend, Anthropic clients.

**Where encoded:** `lib/prisma.ts`, `.claude/rules/security.md` (env handling section to be added in next pass), this file.
**Confidence:** high
**Tags:** vercel, env-vars, module-load, prisma

---

### INC-2026-05-19-08 · Neon adapter cannot deserialize PostgreSQL `name` columns

**Status:** ✅ FIXED + ENCODED — All `mcp__postgres__query` calls cast `name` columns to text per `.claude/rules/mcp-postgres.md`.

**Symptom:** `$queryRaw` against `pg_indexes` fails with `DriverAdapterError: UnsupportedNativeDataType ... Failed to deserialize column of type 'name'`.

**Root cause:** PostgreSQL has a `name` system type (used in catalog tables like pg_indexes, pg_class, pg_namespace). The Neon serverless driver doesn't have a default mapping for it.

**Fix applied:** Cast `name` columns to `text` in raw queries:

```ts
prisma.$queryRaw`SELECT indexname::text AS idx FROM pg_indexes ...`;
```

**Prevention:** Any `$queryRaw` reading from pg_catalog or information_schema must `::text` cast columns of type `name`. Bake this into the `mcp-postgres.md` rule and any DB-analyst agent prompts.

**Where encoded:** `.claude/rules/mcp-postgres.md` (to be updated), this file.
**Confidence:** high
**Tags:** prisma, neon-adapter, postgres-types, raw-sql

---

### INC-2026-05-19-09 · Next 16 cacheComponents forbids `new Date()` in server components

**Status:** ✅ FIXED + ENCODED — `.claude/rules/cache-components.md` Pattern 1 + NEXT_PHASE guards in `app/(dev)/dev/queries/*`.

**Symptom:** `next build` fails with: `Route "/dev" used 'new Date()' before accessing either uncached data ... or Request data ... Accessing the current time in a Server Component requires reading one of these data sources first.`

**Root cause:** Next 16's `experimental.cacheComponents: true` (Partial Pre-rendering / PPR) treats `new Date()` as dynamic and refuses to prerender pages that read it without a dynamic source.

**Fix applied:** Use a static build-time identifier instead:

```tsx
const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
```

Or, if the timestamp must be live, move the read into a Client Component (`"use client"`).

**Prevention:** In any server component under a route with `'use cache'` or PPR enabled, do not call `new Date()`, `Date.now()`, `Math.random()`, or anything otherwise nondeterministic. Use Vercel git env vars for build identity; client components for live time.

**Where encoded:** `.claude/rules/performance.md` (to be augmented), this file.
**Confidence:** high
**Tags:** next-16, cache-components, ppr, server-components

---

### INC-2026-05-19-10 · Vercel rejected deploy because commit email didn't match GitHub account

**Status:** ✅ FIXED + ENCODED — `.claude/rules/git-discipline.md` § commit author identity.

**Symptom:** Vercel deployment blocked with: "Deployment was blocked because the commit email `claude@mapsly.ai` could not be matched to a GitHub account."

**Root cause:** Vercel verifies that every commit on a production-deploy branch is authored by a GitHub account belonging to the team's seat owners. Our git author was `claude@mapsly.ai`, which isn't on any GitHub account.

**Fix applied:** `git filter-branch` to rewrite history with the user's real GitHub email, then force-push:

```bash
git filter-branch -f --env-filter '
  export GIT_AUTHOR_EMAIL="sarminvictor@gmail.com"
  export GIT_COMMITTER_EMAIL="sarminvictor@gmail.com"
' HEAD
git push --force-with-lease origin main
```

**Prevention:** First action in any sandbox git session: `git config user.email "$(grep VERCEL_OWNER_EMAIL .env.local | cut -d= -f2)"` or hardcode to the user's known GitHub email. **Never** commit as a bot identity to a Vercel-connected repo unless a deploy hook is configured to accept bot commits.

**Where encoded:** This file. Bootstrap script for autonomous sessions sets user.email before any commit.
**Confidence:** high
**Tags:** git, vercel, github, commit-author

---

### INC-2026-05-19-11 · `app/page.tsx` 404s because next-intl middleware rewrites `/` to a missing locale path

**Status:** ✅ FIXED + ENCODED — `app/[locale]/` restructure shipped; root `/` redirects via next-intl middleware.

**Symptom:** `https://www.mapsly.ai/` returns HTTP 404 despite `app/page.tsx` existing. `dev.mapsly.ai/` returns 200 (because middleware bypasses next-intl for that host).

**Root cause:** `createMiddleware(routing)` from next-intl with `localePrefix: "as-needed"` rewrites `/` → an internal `/{detected-locale}` path. Without `app/[locale]/page.tsx`, that path 404s. The top-level `app/page.tsx` is unreachable.

**Fix applied:** Move `app/page.tsx` → `app/[locale]/page.tsx` and add `app/[locale]/layout.tsx` that calls `setRequestLocale(locale)`. Keep `app/layout.tsx` as the root `<html>`-bearing layout. Route groups like `app/(dev)/` remain outside the locale tree (correct — they're served by middleware host rewrites).

**Prevention:** Any new Next + next-intl scaffold creates `app/[locale]/page.tsx` from day one. Add a CI grep that fails if `app/page.tsx` exists alongside any `app/[locale]/` directory (one or the other, never both).

**Where encoded:** `.claude/rules/i18n.md` (to be augmented with structure rule), this file.
**Confidence:** high
**Tags:** next-intl, app-router, routing

---

### INC-2026-05-19-12 · Vercel CLI requires `vercel link` before env/deploy commands

**Status:** ✅ FIXED + ENCODED — `docs/handoff.md` § Vercel bootstrap.

**Symptom:** `npx vercel env pull` (or any project-scoped command) fails with: `Error: Your codebase isn't linked to a project on Vercel. Run vercel link to begin.`

**Root cause:** Vercel CLI looks for `.vercel/project.json` in the current directory. Without it, even a fully-authenticated CLI doesn't know which project to operate on.

**Fix applied:** Run `npx vercel link --scope boxlyteam` once, answer "link to existing project: mapsly", then env commands work.

**Prevention:** Bootstrap checklist for any Vercel-connected repo: after `git clone`, run `vercel link` once. Note in `docs/handoff.md` so this is the very first step when working from a fresh checkout.

**Where encoded:** `docs/handoff.md` (to be updated), this file.
**Confidence:** high
**Tags:** vercel, cli, bootstrap

---

### INC-2026-05-19-13 · Next 16 revalidateTag requires cacheLife profile arg

**Status:** ✅ FIXED + ENCODED — `.claude/rules/caching.md` § revalidation profile arg.

**Symptom:** `Type error: Expected 2 arguments, but got 1.` on every `revalidateTag("...")` call. Build fails.

**Root cause:** Next 16 with `experimental.cacheComponents: true` (PPR) changed the `revalidateTag` signature: it now requires a `cacheLife` profile name as the second argument (e.g., `"seconds"`, `"minutes"`, `"days"`). The single-argument form is no longer accepted.

**Fix applied:** Pass the profile explicitly:

```ts
revalidateTag("dev-dashboard-github", "seconds");
```

**Prevention:** Any new `revalidateTag` call needs both args. Loop in `.claude/rules/caching.md` already documented this pattern — the lesson is to enforce via lint or grep before merge.

**Where encoded:** `app/(dev)/dev/actions.ts`, `.claude/rules/caching.md`, this file.
**Confidence:** high
**Tags:** next-16, cache-components, revalidate-tag

---

### INC-2026-05-19-14 · Cowork sandbox FUSE mount blocks `unlink()` — git working-tree updates impossible

**Status:** ♻️ SUPERSEDED BY INC-31 — Loop runs from /tmp; FUSE mount never holds the active working tree anymore.

**Symptom:** Supervisor tick opens, sees the working tree in an unborn-HEAD state (`fatal: your current branch 'main' does not have any commits yet`) with `.git-rewrite/`, `.git/index.lock`, and `_tmp_3_*` leftovers from a prior crashed session. INC-01's `GIT_DIR=/tmp/<scratch>` workaround initializes a fresh git dir and `git fetch origin main` succeeds, but `git reset --hard origin/main` aborts with:

```
error: unable to unlink old 'tsconfig.json': Operation not permitted
error: unable to unlink old 'vercel.json': Operation not permitted
fatal: Could not reset index file to revision 'origin/main'.
```

`python3 os.unlink('.../file')` returns `PermissionError [Errno 1]` on a file the sandbox itself just created (uid matches sandbox user, mode 0600). `chmod` succeeds, write/truncate succeed; only `unlink()` is denied.

**Root cause:** Cowork mounts the workspace via FUSE/virtiofs with policy `rw,nosuid,nodev,default_permissions,allow_other` and `user_id=0,group_id=0`. The FUSE layer permits create / write / truncate / chmod but **blocks the `unlink()` syscall categorically**, regardless of POSIX permissions or file ownership. INC-01's GIT_DIR-in-/tmp trick relocates `.git` but does nothing for the working tree — every `git checkout`, `git reset --hard`, `git merge`, `git rebase` must unlink the old version of any file it's replacing, and they all hit the FUSE wall. Write/Edit tools work because they overwrite in place; raw git cannot.

**Fix applied (this tick):** None — recovery is impossible from inside the bash sandbox. Tick aborted, cooldown set to 24h, blocker surfaced for host-side intervention.

**Recovery recipe (Viktor, from macOS Terminal — sandbox cannot do this):**

```bash
cd ~/Documents/Claude/Projects/mapsly
rm -rf .git-rewrite/ _tmp_3_* .claude/memory/_test-tick.txt
rm -f .git/index.lock
git fetch origin main
git reset --hard origin/main
```

After that, local main has commits, working tree is clean, and the next supervisor tick proceeds normally.

**Prevention:**

1. **Supervisor pre-flight, hard halt path:** every tick must run `git status` first. If it reports "No commits yet" OR `.git-rewrite/` exists OR `.git/index.lock` exists, the supervisor MUST set a 24h cooldown and exit. Do not attempt `git reset`, `git pull`, or any working-tree-mutating git command — they burn a tick, leave more garbage, and do not recover.
2. **No scratch files in the working tree:** never `touch`, `>`, or `cat >` test files under `/sessions/<sandbox>/mnt/mapsly` — once created they are unkillable from the sandbox and Viktor has to clean them up by hand. Scratch belongs in `/tmp/<unique>/`.
3. **Encode in SKILL:** `.claude/skills/autonomous-build-loop/SKILL.md` should add a Step 2.5 "Working-tree health check — abort with 24h cooldown if unhealthy" before the boot reads.
4. **Block-list on dashboard:** add a `blockers/sandbox-unlink-blocked` signal so `dev.mapsly.ai` surfaces the recovery recipe when this incident triggers.
5. **Long-term escalation:** raise with Cowork — either grant the sandbox unlink permission on the mounted folder, or run the autonomous loop as a macOS-host process rather than inside the Linux sandbox.

**Where encoded:** this file. Propagate to `.claude/skills/autonomous-build-loop/SKILL.md` (pre-flight check) and `.claude/rules/incident-prevention.md` (hard-halt trigger list) by the next host-side session.
**Confidence:** high
**Tags:** sandbox, fuse, virtiofs, git, unlink, supervisor, host-only-fix, blocker

**Amendment 2026-05-20 (SES-2026-05-20-cowork-01):** The wall can trigger AFTER pre-flight passes. This iteration's pre-flight check found no `.git/index.lock` and no `.git-rewrite/`, but discovered two stale `_tmp_14_*` orphans in the working tree from a prior session. The orphans alone were not in the pre-flight halt-trigger list, so the iteration proceeded — and then `pnpm install` tripped the wall (couldn't unlink the orphans to take the store lock), AND the failed install left a fresh `.git/index.lock` that subsequent git commands couldn't clear. Recovery: applied INC-01 pattern (relocated `GIT_DIR=/tmp/mapsly-git-<ts>/` with `.git` copied + index.lock removed from the copy) which let git add/commit/push work normally. **Prevention update:** add `_tmp_*` glob to the pre-flight halt-trigger list. Specifically: if `ls /sessions/.../mnt/mapsly/_tmp_* 2>/dev/null | head -1` returns a path, the supervisor MUST set 24h cooldown and exit — those files come from prior pnpm crashes and cannot be cleaned from the sandbox. Until Viktor runs the recovery recipe, no iteration can run `pnpm install`. The relocated-GIT_DIR escape hatch still lets iterations commit/push code-only changes (no install needed), but any task requiring typecheck/lint/build/test must abort.

### INC-2026-05-19-15 · next-intl middleware matcher excludes paths with dots

**Status:** ✅ FIXED + ENCODED — `middleware.ts` matcher updated; `.claude/rules/i18n.md` matcher pattern documented.

**Symptom:** Routes containing a dot in the URL (like `/tasks/A.1`, `/tasks/1.10.4`) return 404 on `dev.mapsly.ai`. The same paths work locally (`pnpm dev`) but 404 in production.

**Root cause:** The middleware config matcher pattern `/((?!api|_next|_vercel|.*\..*).*)` excludes any URL containing a dot — designed to skip static assets (`.css`, `.png`, etc.) but too greedy: `A.1` matches the same regex. With matcher skipped, the host-based rewrite in `middleware.ts` doesn't fire, so `dev.mapsly.ai/tasks/A.1` is served as-is — but only `/dev/tasks/[id]` exists, not `/tasks/[id]`.

**Fix applied:** Tightened the matcher exclusion to a specific extension list:

```ts
matcher: [
  "/((?!api|_next|_vercel|.*\\.(?:css|js|mjs|json|webmanifest|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav|pdf|txt|xml|zip)).*)",
],
```

Now only real static-asset extensions are excluded; arbitrary dotted paths flow through middleware as expected.

**Prevention:** Any time a route uses task IDs / SKUs / version strings with dots, the matcher must allow them. The "exclude any dot" pattern is a Next.js docs default but unsafe for dynamic-segment IDs. Pin matchers to known extensions only.

**Where encoded:** `middleware.ts`, this file.
**Confidence:** high
**Tags:** next-intl, middleware, routing, dynamic-segments

### INC-2026-05-19-16 · Loop was running on default model (Sonnet) not Opus

**Status:** ✅ FIXED + ENCODED — `scripts/launchd/loop-tick.sh` passes `--model "$CLAUDE_MODEL"`; default opus-4-7. (Launchd wrapper retained as fallback per CLAUDE.md.)

**Symptom:** Loop quality scores plausibly lower than expected. Viktor flagged the loop wasn't on the strongest available model.

**Root cause:** The launchd wrapper `scripts/launchd/loop-tick.sh` invoked `claude --print "$PROMPT"` without a `--model` flag. The Claude CLI falls back to whatever the user's CLI config defaults to — for most Pro Max users that's Sonnet, not Opus.

**Fix applied:**

- Added `--model "$MODEL"` to the claude invocation
- New env var `CLAUDE_MODEL` (default `claude-opus-4-6`, overridable in `.env.local`)
- Documented in CLAUDE.md as a "Model pin" hard rule

**Prevention:** Any wrapper that invokes `claude` in headless mode for autonomous work MUST set `--model` explicitly. Inheriting the user's CLI default is fragile — it could be a different model on each machine.

**Where encoded:** `scripts/launchd/loop-tick.sh`, `.env.example`, `CLAUDE.md`, this file.
**Confidence:** high
**Tags:** loop, claude-cli, model-selection

### INC-2026-05-19-17 · Sandbox rsync clobbered dashboard-set loop-lock state

**Status:** ♻️ SUPERSEDED BY INC-31 — No rsync from FUSE mount in current architecture. Loop never reads or writes the mounted `.claude/memory/loop-lock.json` directly.

**Symptom:** User resumed loop via dashboard (`Mapsly Dashboard · chore(loop): idle via dashboard`). Subsequent commits from sandbox-Claude work showed loop-lock.json reverted to "paused" — user's resume action lost. After 10 min, no launchd ticks acquired the lock.

**Root cause:** When sandbox-Claude commits batched work, it `rsync`s the entire working tree from `/tmp/lock-gen/` back to `/sessions/.../mapsly/`. The sandbox-Claude's working copy had a STALE `.claude/memory/loop-lock.json` (last seen as "paused"). The rsync overwrote the dashboard's "idle" state on disk. Next commit included that stale lock-lock as a regression.

**Fix applied:** Manually restored `loop-lock.json` to `state: idle` and committed.

**Prevention:**

1. **NEVER rsync `loop-lock.json` from sandbox** · the dashboard's `pauseLoop`/`resumeLoop` server actions are the canonical writer
2. Add `.claude/memory/loop-lock.json` to the rsync exclude list when syncing back from `/tmp` to mount
3. Document in `.claude/rules/incident-prevention.md` and `agent-orchestration.md`

**Where encoded:** `loop-lock.json`, this file. Future sandbox sessions exclude loop-lock from rsync.
**Confidence:** high
**Tags:** sandbox, rsync, dashboard, lock-state

### INC-2026-05-19-18 · Pro Max usage card showed fabricated numbers — Anthropic has no usage API

**Status:** ✅ FIXED + ENCODED — Pro Max usage card deleted from `app/(dev)/dev/page.tsx`; honest quota link via `app/(dev)/dev/QuotaCard.tsx`.

**Symptom:** Dashboard "Pro Max usage · 5h rolling window" card showed `0% session used` and `0 routine runs` while claude.ai/settings/usage showed the real numbers (e.g. 64% session, 5 routines run). Users were misled into thinking the loop had budget when it was actually constrained.

**Root cause:** No public Anthropic API exposes Pro Max plan usage (session %, weekly limits, routine count, credits remaining). The card was approximating from internal `TokenUsage` records the loop wrote itself — but those rows are sparse (one per worker invocation that bothered to log) and don't reflect what claude.ai counts.

**Fix applied:** Deleted the QuotaCard entirely from `app/(dev)/dev/page.tsx`. No card replacement — the dashboard has no usage tile at all. Real numbers live at `claude.ai/settings/usage`.

**Prevention:**

1. **Never display fabricated/approximated data as if it were real.** If the source of truth is upstream and inaccessible, don't show a number — show nothing or a clear "see upstream" pointer.
2. Recovery from quota exhaustion now has THREE layers (so the loop doesn't need a working usage probe to be safe):
   - **Layer 1 · Agent self-cleanup (best case):** loop-prompt.md §9.5 instructs the agent to detect approaching limit → mark TaskRun=INCOMPLETE, reset Task to PENDING, write cooldown to loop-lock.
   - **Layer 2 · Worker fallback (mid-run kill):** loop-tick.sh greps worker output for `rate.?limit|usage.?limit|quota.?exceeded|429`. On match: marks this session's open TaskRuns INCOMPLETE, resets owned Tasks to PENDING, writes 4h cooldown to loop-lock.
   - **Layer 3 · Supervisor orphan sweep (worker crashed):** loop-tick.sh runs an orphan sweep BEFORE spawning workers — any Task IN_PROGRESS with `startedAt > 30 min` ago gets its TaskRun marked INCOMPLETE and Task reset to PENDING.
3. Supervisor now honors `state: cooldown` + future `cooldownUntil` in loop-lock — exits silently instead of spawning workers.

**Where encoded:**

- `app/(dev)/dev/page.tsx` (card deleted)
- `scripts/launchd/loop-tick.sh` (cooldown gate + orphan sweep + worker fallback)
- `scripts/launchd/loop-prompt.md` §9.5 (agent self-cleanup), §4 (resume from INCOMPLETE)
- `prisma/schema.prisma` TaskRun (added `resumedFromRunId` + `@@index([outcome])`)

**Confidence:** high
**Tags:** quota, recovery, anthropic-api, dashboard-honesty, three-layer-safety

### INC-2026-05-20-19 · Loop never claimed a task · `claude --print` blocks on permission prompts

**Status:** ♻️ SUPERSEDED BY INC-31 — Launchd wrapper no longer the canonical scheduler. Cowork scheduled task spawns its own shell with permissions pre-granted at sandbox-config level.

**Symptom:** Loop-lock has been `idle` for hours/days. Dashboard shows 0 TaskRuns ever written. Postgres confirms: 60 PENDING tasks, 19 DONE, 0 IN_PROGRESS, 0 CronRun rows, 0 Notification rows. The autonomous loop has NEVER successfully claimed and shipped a task despite the wrapper being installed.

**Root cause:** `scripts/launchd/loop-tick.sh` invoked `claude --print --model "$MODEL" "$(cat prompt.md)"` without `--dangerously-skip-permissions`. In headless mode (no TTY), every tool-use approval (Edit/Write/Bash/Task/git) prompts for explicit user permission. With no terminal to respond, the CLI either hangs (forever) or silently auto-denies — Claude answers the prompt as text and exits without doing any actual file/db/git work. Result: launchd fires every 5 min, the wrapper spawns the CLI, the CLI reads the prompt and responds with planning text, but no tools execute. Zero side-effects.

**Fix applied:**

- Added `--dangerously-skip-permissions` to the claude invocation in `loop-tick.sh`.
- Added unconditional `lastTickAt` write at the top of each tick so we can tell from the dashboard whether launchd is firing at all (vs the previous symptom: lastTickAt only updated when someone manually wrote it).
- Created `scripts/launchd/diagnose.sh` so future "is the loop alive?" investigations take one round-trip instead of N.

**Prevention:**

1. **Headless `claude --print` invocations MUST include `--dangerously-skip-permissions`.** Any wrapper that runs Claude unattended needs the flag, full stop. Document this in the wrapper comments + the install README + here.
2. The loop-lock's `lastTickAt` field is now the canonical "is launchd firing?" signal. If it's > 10 minutes stale, that's a problem worth chasing.
3. After updating `scripts/launchd/loop-tick.sh`, the installed copy at `~/.mapsly/loop-tick.sh` is stale — `bash scripts/launchd/install.sh` must be re-run. Add this to git-discipline.md and to the dashboard's "Loop control" card as a one-time reminder when wrapper-related files change.

**Where encoded:**

- `scripts/launchd/loop-tick.sh` (the `--dangerously-skip-permissions` flag, the lastTickAt stamp)
- `scripts/launchd/diagnose.sh` (new diagnostic script)
- this file

**Confidence:** high (verified by Postgres SELECT showing 0 TaskRuns ever)
**Tags:** loop, claude-cli, headless, permissions, root-cause

### INC-2026-05-20-20 · Loop still 0 TaskRuns after v0.4.5 ship · installed wrapper was stale

**Status:** ♻️ SUPERSEDED BY INC-31 — Launchd wrapper is fallback; Cowork-canonical scheduler runs from origin/main clone every tick, so stale-wrapper class of bugs cannot apply.

**Symptom:** v0.4.5 added `--dangerously-skip-permissions` and v0.4.6 added `--effort max` to `scripts/launchd/loop-tick.sh`, but Postgres still showed 0 TaskRuns ever and `loop-lock.lastTickAt` was frozen at the manual-restore timestamp from 44 min ago. The fix was in main but had no effect on the running loop.

**Root cause:** The launchd plist installed by `scripts/launchd/install.sh` pointed to `~/.mapsly/loop-tick.sh` — a _copy_ the installer made when first run. Updates to `scripts/launchd/loop-tick.sh` in the repo didn't propagate to the running wrapper until Viktor re-ran `install.sh`. The instruction "re-run install.sh after pulling" was buried in the v0.4.5 commit message and easy to miss.

**Fix applied:**

1. **plist now points to the repo path directly:** `HOME/Documents/Claude/Projects/mapsly/scripts/launchd/loop-tick.sh`. No more copy.
2. `install.sh` removes the legacy `~/.mapsly/loop-tick.sh` copy on next run so future Claude can `grep` for it and see the migration happened.
3. `install.sh` `chmod +x` the repo wrapper (in case the git permission bit drifted).
4. After this one final `install.sh` run, `git pull` alone is enough for all future wrapper changes.

**Prevention:**

1. **Never make launchd point to a copy of a file that lives in version control.** Always point launchd at the canonical source. If you need to mutate the file at install time (substitute $HOME), do it on the plist, not the script.
2. Whenever a wrapper change requires a re-install step, surface that to the user on the dashboard — not just in a commit message.
3. The unconditional `lastTickAt` stamp at the top of `loop-tick.sh` (added in v0.4.5) is the canonical "is launchd firing?" signal. If it's not updating, the wrapper isn't being invoked at all.

**Where encoded:**

- `scripts/launchd/ai.mapsly.loop.plist` (points to repo path)
- `scripts/launchd/install.sh` (no longer copies, removes legacy copy)
- this file

**Confidence:** high
**Tags:** loop, launchd, install, stale-copy, self-update

### INC-2026-05-20-22 · Pivot scheduler · launchd → /loop in open CC session

**Status:** ♻️ SUPERSEDED BY INC-31 — /loop in open CC session was the v0.5 pivot. v0.6.6 (INC-31) pivoted further to Cowork-canonical with /tmp work-dir. The /loop path remains supported as a Mac fallback only.

**Symptom:** After 7 failed attempts (INC-15, 17, 19, 20, 21) to make launchd-based scheduling work for the autonomous build loop, the loop has shipped zero TaskRuns. Each fix exposed a new layer of macOS sandbox/TCC complexity (Cowork sandbox blocked file unlinks, then `~/Documents/` TCC blocked launchd-spawned bash, then `/bin/bash` couldn't be granted FDA via GUI, etc).

**Root cause:** macOS Sequoia treats launchd-spawned background processes as having minimal TCC privileges. Granting Full Disk Access to the process tree requires either a custom code-signed binary OR moving the project out of `~/Documents/` — both invasive. The fight is structural, not a code bug.

**Fix applied:** Pivot to Claude Code's `/loop` slash command as the canonical scheduler. `/loop` runs inside an interactive Claude Code session (which has all permissions inherited from Terminal). The session draws from the main Pro Max quota — NOT the new headless credit pool that activates June 15, 2026, so it's the only **truly-free** sustained option.

- Created `.claude/loop.md` — per-iteration prompt that `/loop` reads when invoked bare or with just an interval
- Renamed CLAUDE.md "Model pin" section to reflect `/loop` as canonical
- Updated dashboard's LoopControls force-run hint from `launchctl kickstart` to `/loop 5m`
- Added `scripts/launchd/uninstall.sh` to cleanly disable the legacy agent

**Trade-offs accepted:**

1. Mac must stay on (Viktor confirmed: "I will not shut down Mac")
2. `/loop` recurring tasks expire after 7 days — must re-run `/loop 5m` weekly. The loop.md's §9 detects approaching expiry and writes a Notification row.
3. Terminal window must stay open. Viktor's responsibility.
4. Min interval is 1 minute (we pick 5 min). Acceptable.

**Prevention:**

1. **Default to in-session scheduling for autonomous AI workflows on macOS.** Background launchd/cron is the wrong architecture when the work needs sandboxed file access and the platform is macOS — TCC will eat any approach that runs outside an interactive session.
2. The launchd setup is kept in the repo as fallback (in case `/loop` expiry or Mac restart becomes too painful and we move to a Linux VPS later) but is NOT the canonical scheduler.

**Where encoded:**

- `.claude/loop.md` (new)
- `CLAUDE.md` (model-pin paragraph updated)
- `app/(dev)/dev/LoopControls.tsx` (force-run hint)
- `scripts/launchd/uninstall.sh` (new cleanup script)
- this file

**Confidence:** high
**Tags:** loop, scheduler-pivot, macos-tcc, in-session, structural

### INC-2026-05-20-23 · TaskRun.resumedFromRunId added to schema but never pushed to Neon · /tasks/[id] 404s

**Status:** ✅ FIXED + ENCODED — Column live in Neon; `.claude/rules/conventions.md` § schema-drift prevention.

**Symptom:** After v0.4.3 added `resumedFromRunId` to the `TaskRun` Prisma model, `https://dev.mapsly.ai/tasks/B.6` started returning 404 (via Next.js `notFound()`). The page LOOKED reachable (HTTP 200, Suspense fallback rendered) but the data fetch silently failed.

**Root cause:** `prisma generate` runs during Vercel build so the client knows about the new field, but `prisma db push` was never executed against the Neon production DB. `Task.findUnique` with `include: { runs: ... }` Prisma generates a SELECT that includes `resumedFromRunId`. Postgres errors: `column "resumedFromRunId" does not exist`. The `try { ... } catch { return null }` in `getTaskDetail` swallowed the error → page got `null` → called `notFound()`.

**Fix applied:** Direct SQL migration on Neon:

```sql
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "resumedFromRunId" text;
CREATE INDEX IF NOT EXISTS "TaskRun_outcome_idx" ON "TaskRun"(outcome);
CREATE INDEX IF NOT EXISTS "TaskRun_resumedFromRunId_idx" ON "TaskRun"("resumedFromRunId");
```

**Prevention:**

1. **Every schema change MUST be paired with a Neon `db push` in the same commit.** Add to `.claude/rules/database.md` (or create one): "Before merging any change to `prisma/schema.prisma`, run `pnpm prisma db push` against the Neon dev branch and verify the columns match."
2. The `try { return null } catch` pattern in queries silently masks DB schema errors. Replace with: log the error to console.error (Vercel captures + Sentry catches) before returning null — so 404s surface as Sentry issues instead of invisible.
3. Add a CI job that runs `pnpm prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url $DATABASE_URL` and fails if there's drift between schema and DB.
4. The `getTaskDetail` query and similar should NOT have empty catch blocks. Either let errors propagate (caller handles) or log them.

**Where encoded:**

- `prisma/schema.prisma` (already had the field)
- Neon DB (now has the column)
- this file
- TODO: add CI job + replace silent catches

**Confidence:** high (verified by direct ALTER TABLE → page now resolves)
**Tags:** prisma, neon, schema-drift, silent-catch, notFound

### INC-2026-05-20-24 · In-flight card lies "live · in progress" when TaskRun is PARTIAL/FAILED

**Status:** ✅ FIXED + ENCODED — `app/(dev)/dev/queries/in-flight.ts` reads TaskRun.outcome strictly.

**Symptom:** After B.6 shipped as PARTIAL (PR opened, awaiting review), the dashboard's In-flight card kept showing "live · in progress" with a pulsing green dot for B.6 — even though no agent was actively running.

**Root cause:** `queries/in-flight.ts` selected any `Task.status='IN_PROGRESS'` and treated it as "live." But Task.status stays IN_PROGRESS while a PR awaits human review (correct convention — work isn't fully done until merged). The "live" indicator was conflating "Task in flight" with "agent actively running."

**Fix applied:** `getInFlight` now requires BOTH `Task.status='IN_PROGRESS'` AND at least one `TaskRun.outcome='IN_PROGRESS'`. Without both, falls through to the "most recent finished run" display.

**Prevention:**

1. UI indicators for "live" / "active" / "running" must check the lowest-level signal (TaskRun.outcome=IN_PROGRESS), not aggregate states.
2. Document Task.status semantics in `prisma/schema.prisma` comments: `IN_PROGRESS` covers "claimed and either actively running OR awaiting PR review." Use TaskRun.outcome to distinguish.

**Where encoded:**

- `app/(dev)/dev/queries/in-flight.ts`
- this file

**Confidence:** high
**Tags:** dashboard, in-flight, status-conflation, ux-honesty

### INC-2026-05-20-25 · NEXT_PHASE guard return shapes must be 100% complete · TS errors cascade

**Status:** ✅ FIXED + ENCODED — `.claude/rules/cache-components.md` Pattern 1 + `EMPTY_*` typed constants in `app/(dev)/dev/queries/{cost,cron,dora}.ts`.

**Symptom:** B.6 iteration pushed `NEXT_PHASE === "phase-production-build"` guards in 7 `'use cache'` queries. Vercel build failed 3 commits in a row, each on a different missing field in the empty return shape (`cost.ts` missing `haltPct`, then missing `byJob`+`dailyTrend`, then `cron.ts` missing `failures24h`+`successful24h`+`totalRuns24h`, then `dora.ts` missing `last30d`). Each fix surfaced the next layer.

**Root cause:** The NEXT_PHASE guard was written inline as an object literal — TypeScript checks literal-by-literal against the interface, so a partial shape fails immediately. We had no single source of truth for the "empty state" of each interface, so each query's guard + each query's catch wrote their own partial shape.

**Fix applied:** Refactored to `EMPTY_*` typed constants per interface (e.g. `export const EMPTY_COST_BREAKDOWN: CostBreakdown = {...}`). NEXT_PHASE guard returns the constant. Catch block returns the constant. One source of truth, TypeScript catches partial shapes once.

**Prevention:** Codified in `.claude/rules/cache-components.md` Pattern 1. Every NEW `'use cache'` Prisma query must define `EMPTY_X: Type` next to the interface and reference it in both the guard and the catch.

**Where encoded:**

- `.claude/rules/cache-components.md` Pattern 1
- `app/(dev)/dev/queries/cost.ts`, `cron.ts`, `dora.ts` (now using EMPTY\_\* constants)

**Confidence:** high
**Tags:** cacheComponents, prisma, typescript, build-phase, empty-state

### INC-2026-05-20-26 · next-intl t.rich() render-prop callbacks don't survive cacheComponents prerender

**Status:** ✅ FIXED + ENCODED — `.claude/rules/cache-components.md` Pattern 4 + `app/[locale]/signin/check-email/page.tsx` → `"use client"`.

**Symptom:** B.6's `/signin/check-email` page used `t.rich("no_email_received", { tryAgain: chunks => <Link>{chunks}</Link> })` (next-intl rich-text pattern). Vercel prerender failed with `Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".` The function being serialized was the `tryAgain` render-prop callback inside the React tree.

**Root cause:** Under `cacheComponents: true`, React serializes the prerendered tree for the static shell. Render-prop callbacks are JavaScript functions — they can't be serialized.

**Fix applied:** Converted `/signin/check-email` to a `"use client"` component. `useTranslations()` from `next-intl` works fine in client components; the render-prop callback is just JSX rendered on the client, no serialization needed.

**Prevention:** Codified in `.claude/rules/cache-components.md` Pattern 4. Any page using `t.rich()` with a render-prop must be a client component when `cacheComponents` is enabled.

**Where encoded:**

- `.claude/rules/cache-components.md` Pattern 4
- `app/[locale]/signin/check-email/page.tsx`

**Confidence:** high
**Tags:** next-intl, cacheComponents, render-prop, serialization

### INC-2026-05-20-27 · Vercel build container cannot open Neon WebSockets · every `'use cache'` Prisma query needs a build-phase guard

**Status:** ✅ FIXED + ENCODED — `.claude/rules/cache-components.md` Pattern 1; all `'use cache'` Prisma queries have NEXT*PHASE guard + EMPTY*\* fallback.

**Symptom:** Every `'use cache'` query in the `/dev` tree that called `prisma.foo.findMany()` crashed during Vercel's `next build` step. The error surfaced as "Uncached data was accessed outside of <Suspense>" — but the underlying cause was a Neon WebSocket connection failure (Vercel's build worker has no Neon connectivity). cacheComponents tries to populate `'use cache'` blocks at build time and the Prisma call rejects with an opaque ErrorEvent.

**Root cause:** With `cacheComponents: true`, `'use cache'` blocks are populated DURING the build (so the prerendered shell has cache-warmed values). Vercel's build container is sandboxed away from Neon's WebSocket-only protocol → every Prisma call from a build-phase `'use cache'` block fails. The failures cascade into "Uncached data outside Suspense" because the build worker can't determine the cache shape.

**Fix applied:** Added `if (process.env.NEXT_PHASE === "phase-production-build") return EMPTY_X` guards to all DB-hitting `'use cache'` queries. At build time, the cache populates with the empty shape; at runtime, the cache expires immediately and the next request fetches real data.

**Prevention:** Codified in `.claude/rules/cache-components.md` Pattern 1. Every `'use cache'` Prisma query that runs at build time must have a NEXT_PHASE guard + matching EMPTY_X constant.

**Where encoded:**

- `.claude/rules/cache-components.md` Pattern 1
- All DB-hitting `app/(dev)/dev/queries/*.ts` files

**Confidence:** high
**Tags:** vercel-build, neon, prisma, cacheComponents, websocket

### INC-2026-05-20-28 · INC-14 falsely invoked on real macOS · loop iteration false-aborted

**Status:** ♻️ SUPERSEDED BY INC-31 — Loop no longer probes the FUSE mount in STEP 0 — runs in /tmp from a fresh clone, so the false-positive class of bugs cannot apply.

**Symptom:** v0.6.2 Desktop Scheduled Task iteration on Viktor's Mac diagnosed "FUSE unlink wall (INC-14)" and exited with 4h cooldown — but the iteration runs on the actual macOS filesystem (no FUSE). The real issue: local working tree had stale uncommitted changes from earlier sandbox commits + local main was 2 commits behind origin/main after v0.6.2 push.

**Root cause:** INC-14 documents a FUSE-mount limitation that ONLY applies inside the Cowork sandbox (paths under `/sessions/.../mnt/`). The iteration agent matched the surface symptom ("can't unlink files cleanly") to INC-14 without checking whether the working path was actually FUSE-mounted, and invoked the 24h-cooldown escape hatch instead of doing the obvious `git stash + git pull + git stash drop` recovery that works fine on a real filesystem.

**Fix applied:**

1. Manual: `rm -f .git/index.lock && git reset --hard origin/main && git clean -fd` on Viktor's Mac to restore clean state.
2. v0.6.3 loop.md STEP 0 now auto-syncs to origin/main when on `main` branch with no active IN_PROGRESS Task — eliminates the "stale-tree-after-merge" precondition entirely.
3. v0.6.3 loop.md STEP 0 also adds an `IS_SANDBOX` detection (`case $PWD in */sessions/*|*/mnt/*) IS_SANDBOX=1`) — INC-14 patterns may only be invoked when `IS_SANDBOX=1`.

**Prevention:**

1. **INC-14 scope is now explicit:** only applies when the working directory path includes `/sessions/` or `/mnt/`. On real macOS, regular git operations always work.
2. Every iteration starting on `main` auto-syncs to `origin/main` before claiming a task — no more stale-tree confusion possible.
3. When the agent considers invoking INC-14's 24h cooldown, it must verify `IS_SANDBOX=1` first. Otherwise, attempt normal git recovery (stash → reset → clean) before any escape hatch.

**Where encoded:**

- `.claude/loop.md` STEP 0 (auto-sync + IS_SANDBOX detection)
- This entry

**Confidence:** high
**Tags:** loop, INC-14-scope, false-positive, auto-sync, working-tree

### INC-2026-05-20-29 · Cowork scheduled-task iteration cannot run pnpm install · structural FUSE wall

**Status:** ♻️ SUPERSEDED BY INC-31 — v0.6.6 architectural pivot — loop bootstraps in /tmp/mapsly-work, which is sandbox-writable. The FUSE wall still exists but the loop sidesteps it.

**Symptom:** SES-2026-05-20-cowork-02 (this iteration) was triggered by the Cowork desktop app's Scheduled Task feature. STEP 0 detected `IS_SANDBOX=1` (PWD under `/sessions/.../mnt/mapsly`). Trying to install dependencies for STEP 6 validation (`pnpm install --ignore-scripts --frozen-lockfile`) crashed immediately with:

```
[ERROR] EPERM: operation not permitted, unlink '/sessions/.../mnt/mapsly/_tmp_5_df0de19325d1d579781e6932c90f2dc7'
```

Probe confirmed the FUSE wall is total: `touch _probe_test; rm -f _probe_test` returns `Operation not permitted` on a file the sandbox just created. `mv` fails identically (source unlink). Only Write/Edit (overwrite via O_TRUNC) work. This means `pnpm install` cannot ever complete in the Cowork mount, and therefore `pnpm deploy-check` (typecheck/lint/build/test) cannot run from this iteration's environment.

**Root cause:** Cowork's mount of `~/Documents/Claude/Projects/mapsly` into `/sessions/.../mnt/mapsly` is a FUSE layer that categorically blocks the `unlink()` syscall. INC-14 documented this in passing for git operations; the new finding is that this also blocks pnpm's atomic-rename install pattern, and the loop's v0.6.3 STEP 0 self-heal (`rm -f _tmp_*`) cannot remove these orphans either — they are placed by pnpm itself during the install attempt and survive the attempt.

This is structural: there is no escape hatch from inside the sandbox. INC-01's `GIT_DIR=/tmp/...` trick works for git because the .git dir can live outside the mount. node_modules cannot — Node's module resolution requires it next to package.json. We'd need to:

- Symlink node_modules into the mount (FUSE may reject), OR
- Copy the entire project to /tmp, install + validate there, and propagate diffs back (1GB disk pressure on a workspace with only ~1GB free in /tmp).

**Fix applied (this iteration):** Did not attempt heroic workarounds. Skipped task claim. Set 4h cooldown on loop-lock. Surfaced a Notification row for Viktor so the dashboard's Blockers card shows the issue. Amended loop.md STEP 0 with explicit Cowork-mode guidance: if `IS_SANDBOX=1` AND `pnpm install` would be required, skip task claim and request the user run the iteration via Claude Code's `/loop` slash command on the real Mac filesystem instead.

**Prevention:**

1. **`.claude/loop.md` STEP 0 amendment (v0.6.4):** when `IS_SANDBOX=1`, probe-test `touch _probe_$$; rm -f _probe_$$` immediately after the existing self-heal. If the rm fails (`Operation not permitted`), set 4h cooldown, write Notification (`level=WARN`, `title="Cowork sandbox FUSE wall — switch to /loop"`, body cites this INC), exit ≤1 line. Do not attempt to claim a task; nothing useful can be done from this environment.
2. **Documentation pivot (CLAUDE.md "Model pin" section):** Cowork desktop Scheduled Task is officially NOT a supported scheduler for the autonomous build loop — only `/loop` from an interactive Claude Code session on the Mac (which has direct macOS filesystem access) qualifies. Cowork's scheduled task can run discovery/reporting tasks that need only Read+Bash, but not implementation tasks that need `pnpm install`.
3. **Dashboard surfaces the constraint:** the LoopControls card on `dev.mapsly.ai` should show which scheduler is currently driving ticks (read from loop-lock.note or a new field). If `lastTickAt` is being stamped by a Cowork session but no TaskRuns are shipping, the dashboard surfaces "Loop is running but cannot install deps — switch to /loop". Track as a follow-up task.

**Where encoded:**

- `.claude/loop.md` STEP 0 (Cowork probe added in this commit)
- This entry
- (followup) `CLAUDE.md` Model pin paragraph
- (followup) `app/(dev)/dev/LoopControls.tsx`

**Confidence:** high (probe-tested in this iteration: unlink, mv, rm all denied; truncate-write works)
**Tags:** loop, cowork, fuse, pnpm-install, structural, scheduler-mode

### INC-2026-05-20-30 · v0.6.4 halted the entire loop on a single capability gap · capability halts must be scoped

**Status:** ✅ ACTIVE DESIGN PRINCIPLE — Capability-routing rule remains canonical in `.claude/rules/capability-routing.md`. In Cowork-only mode it's largely inert (all tasks treated env-agnostic), but the principle covers any future env with reduced capabilities.

**Symptom:** v0.6.4 shipped a "Cowork FUSE wall halt path" in `.claude/loop.md` STEP 0/STEP 1. When STEP 0 probed `touch + rm _probe_$$` and `rm` returned `Operation not permitted`, the iteration set `LOOP_HALT_REASON=cowork-fuse-wall` and STEP 1 unconditionally exited with a 4-hour cooldown on `loop-lock`. This blocked the ENTIRE queue from running for 4 hours, even though most tasks in the queue (docs, memory, research, DB writes, dashboard tweaks) don't need `pnpm install` and would have shipped fine from the sandbox via Write/Edit/Postgres MCP.

Viktor's reaction was the correct design check: _"Any incident should not block ALL tasks."_

**Root cause:** v0.6.4 conflated two different concepts:

1. _Environment capability_ — what THIS env can physically do (run `unlink()`, install deps, open Chrome, reach Gmail tab, etc.)
2. _Loop liveness_ — whether the loop should be running at all

A FUSE unlink wall is a capability gap, not a liveness failure. The loop is healthy; the queue has work; the env just can't ship a SUBSET of tasks. Treating it as a liveness failure (4h global cooldown) wastes the rest of the queue for no reason.

The deeper design flaw: tasks had no way to declare what capabilities they need, and the loop had no way to filter the queue by what the env can offer. Without that vocabulary, every capability gap looked like a hard wall.

**Fix applied (v0.6.5):**

1. **STEP 0** now sets advisory capability flags (`CAN_UNLINK`, `CAN_PNPM_INSTALL`, `CAN_DEPLOY_CHECK`, `CAN_GIT_PUSH`) instead of `LOOP_HALT_REASON`.
2. **STEP 1** no longer has a capability-halt exit. Cooldown is reserved for catastrophic / repeated failures, never for capability gaps.
3. **STEP 3** filters the eligible queue by `Task.tags requires:*` against current capabilities. Tasks with no `requires:*` tag are env-agnostic (run anywhere). Tasks tagged `requires:deploy-check` skip in Cowork; tasks tagged `requires:pnpm-install` skip there too.
4. **STEP 6** soft-handles EPERM/unlink errors from deploy-check: auto-tag the Task `requires:deploy-check`, mark TaskRun INCOMPLETE, release back to PENDING, continue to next eligible task in the SAME iteration. The loop SELF-LEARNS which tasks need which capabilities.
5. **STEP 10** explicit cooldown discipline: never set cooldown for a capability gap or an empty-eligible-queue exit — let the next tick re-probe.
6. **New rule:** `.claude/rules/capability-routing.md` documents the capability vocabulary, task tagging convention, STEP 3 filter logic, and anti-patterns. Future capabilities (browser, email-tab, lighthouse, vercel-deploy) follow the same pattern.

**Prevention:**

1. **Design principle (now in capability-routing.md):** A capability gap is a routing constraint, not a halt signal. It narrows which tasks are eligible — it does not stop the loop.
2. **Task taxonomy:** every task that requires a specific env capability declares it via `tags: requires:<cap>`. Default is env-agnostic. Failures auto-tag (STEP 6 soft-handler).
3. **Cooldown discipline:** the cooldown trigger table in capability-routing.md is the single source of truth. Only catastrophic / repeated-failure / rate-limit conditions trigger cooldown.
4. **Dashboard surface:** capability-degraded mode is INFO, not WARN. The user-facing copy is _"Sandbox in degraded mode — code tasks waiting for /loop on Mac. Env-agnostic tasks still shipping."_ (not the v0.6.4 "Loop stalled — switch to /loop" alarmist phrasing).
5. **The probe in STEP 0 is non-destructive** — it sets flags, it doesn't halt. Halting decisions live in STEP 1 (loop-lock) and STEP 3 (capability filter), never in STEP 0.

**Where encoded:**

- `.claude/loop.md` (STEP 0 probe, STEP 1 no-halt, STEP 3 capability filter, STEP 6 auto-learn, STEP 10 cooldown discipline)
- `.claude/rules/capability-routing.md` (new file · canonical rule)
- `.claude/memory/incidents.md` (this entry)
- INC-29 amendment: the FUSE wall remains a real env constraint, but its impact is now scoped via capability tags, not via a global halt.

**Confidence:** high
**Tags:** loop, design, capability-routing, scoped-halts, queue-discipline, INC-29-amendment

### INC-2026-05-20-31 · Cowork-only scheduler · loop must run in /tmp, not in the FUSE-mounted project dir

**Status:** ✅ ACTIVE DESIGN — This IS the v0.6.6+ scheduler model. Encoded in `.claude/loop.md` STEP 0a/0b.

**Symptom:** v0.6.5 shipped capability-aware routing in `.claude/loop.md`, but the Cowork scheduled task tick STILL couldn't act on it because the tick's `git fetch origin main` in STEP 0 silently failed to update refs. The local `.git/refs/remotes/origin/main` stayed at v0.6.3 (`59e1515`) even though origin had advanced through v0.6.4 (`07fe8f4`), v0.6.4-version-bump (`59b0eca`), and v0.6.5 (`1a7cde6`).

`git fetch` exited 0 but printed 70+ lines of `warning: unable to unlink '.git/objects/XX/tmp_obj_*': Operation not permitted`. Git could download packfiles but couldn't promote temporary objects to their final on-disk locations because the FUSE mount blocks `unlink()`. So every Cowork tick read the OLD v0.6.4 STEP 0/STEP 1 logic from its own working tree, applied the OLD "fuse-wall halt + 4h cooldown" pattern, and exited — no matter how many improvements we shipped to origin/main.

Viktor: _"we do not use loop - we use cowork scheduler."_ (clarifying that the Mac `/loop` alternative is not an option; Cowork must work.)

**Root cause:** Three independent FUSE-wall limitations conspired:

1. `git fetch` can't promote temp objects in `.git/objects/` (unlink-blocked).
2. `git reset --hard origin/main` can't remove tracked files that should be deleted (unlink-blocked).
3. `pnpm install` can't atomic-rename via unlink (INC-29 already covered this).

Combined: a Cowork tick that starts from a stale working tree can never refresh itself, so every code/loop improvement we ship to origin/main is invisible to it. The fundamental design assumption "the loop reads its own latest version from the working tree" is broken on FUSE.

**Fix applied (v0.6.6):** Stop running the loop from the FUSE-mounted project directory entirely. The Cowork tick now:

1. Detects `IS_SANDBOX=1` from `$PWD`.
2. Sources `.env.local` from the mount (read works — only write is blocked).
3. Clones origin to `/tmp/mapsly-work` (or `git fetch + reset --hard` if /tmp already has the clone from a prior session, which it usually doesn't because /tmp is ephemeral). The clone is ~4 MB and takes < 1 second.
4. `cd /tmp/mapsly-work` and runs all subsequent steps from there. `/tmp` is sandbox-writable; unlink works; git refs advance normally.
5. STEP 6 deploy-check is gated on `CAN_DEPLOY_CHECK`. In sandbox mode (`CAN_DEPLOY_CHECK=0`), local deploy-check is skipped and validation defers to Vercel CI on push. This is the canonical Cowork-only pattern.

The FUSE-mounted project directory at `~/Documents/Claude/Projects/mapsly` is now a read-only mirror from the user's perspective. The loop never writes there; the user can pull origin/main into the mount manually when they want to inspect latest code locally.

**Prevention:**

1. **Architectural rule (now in loop.md STEP 0):** when `IS_SANDBOX=1`, the loop NEVER runs from the mount. It clones to `/tmp` and runs from there. The mount is only read for `.env.local`.
2. **Capability flag taxonomy:** `CAN_DEPLOY_CHECK=0` is the canonical signal that "local deploy-check infeasible — push and defer to Vercel CI." This unblocks the "deferred to CI" pattern that v0.6.4 had banned (the ban was wrong; it assumed a real macOS env always exists).
3. **`/tmp` ephemerality acknowledged:** the loop assumes /tmp is cold on every tick. Fresh clone + git fetch is < 1s — cheap enough to do every time. No caching needed.
4. **No more mount-based git operations in sandbox:** any code that does `git fetch / reset / commit / push` in `$IS_SANDBOX=1` mode must check it's in `/tmp/mapsly-work`, not the mount. The /tmp .git is the source of truth for sandbox iterations.

**Where encoded:**

- `.claude/loop.md` STEP 0 (sandbox bootstrap via /tmp clone)
- `.claude/loop.md` STEP 1 (capability flags advisory, no halt path)
- `.claude/loop.md` STEP 6 (deploy-check gated on CAN_DEPLOY_CHECK; "deferred-to-vercel-ci" is canonical for Cowork)
- This entry
- INC-29 amendment: FUSE wall is real, but irrelevant — the loop simply doesn't touch the FUSE dir.
- INC-30 amendment: capability routing still applies, but for Cowork-only mode every tick runs the same code path; the routing is about WHICH validation strategy fires, not whether the tick runs.

**Confidence:** high
**Tags:** loop, sandbox, /tmp, cowork-canonical, design, INC-29-supersede, INC-30-supersede

### INC-2026-05-20-32 · Prisma `{ increment }` over a NULL nullable column stays NULL

**Status:** ✅ FIXED + ENCODED — `lib/cost/cost-counter.ts` `openCronRun` initializes `costUsd: 0`.

**Symptom:** C.1 shipped `lib/cost/cost-counter.ts` with `prisma.cronRun.update({ data: { costUsd: { increment: 0.0006 } } })`. The `CronRun.costUsd` column is `Float?` (nullable, no DB default). After `openCronRun` created the row with no explicit costUsd, every subsequent `{ increment }` was a no-op — Postgres evaluates `NULL + x = NULL`, so costUsd stayed NULL forever. The behaviour was silent: no exception, no log, just zero cost ever recorded. Unit tests passed only because the in-test mock defaulted costUsd to 0, hiding the real DB semantics.

**Root cause:** Prisma's `{ increment: n }` operator translates to SQL `"costUsd" = "costUsd" + $1`, and Postgres's arithmetic over NULL yields NULL. The schema column was Float? without a `@default(0)`, so newly-created rows had costUsd = NULL.

**Fix applied:** `openCronRun` now passes `data: { job, status: "RUNNING", costUsd: 0 }` explicitly at insert time. No schema migration needed (kept the column nullable to allow "never tracked" rows in catalogs / fixtures). Test mock updated to mimic Postgres NULL semantics (`row.costUsd == null ? null : row.costUsd + inc`) so a regression guard test for openCronRun + costUsd === 0 actually fires if the init is removed.

**Prevention:**

1. **Any Prisma column written via `{ increment }`, `{ decrement }`, or other arithmetic operators MUST be initialized at insert time** — either via schema `@default(0)` (preferred long-term) or via an explicit value in the `create({ data })` call. Treat nullable numeric columns as a yellow flag in code review.
2. **Test mocks must mimic real DB semantics for the ops they cover.** A mock that defaults nullable columns to 0 silently hides NULL-arithmetic bugs. Default to `null` in the mock and require the production code to pass the value explicitly.
3. **Prefer integration tests against a real Neon test branch (per `.claude/rules/testing.md` §"No mocking DB") for any code that relies on Prisma update semantics.** Pure-mock unit tests cover algorithm shape; integration tests cover SQL semantics. C.1 should have had at least one round-trip integration test against Neon before merge — added as follow-up.

**Where encoded:**

- `lib/cost/cost-counter.ts` (openCronRun · `costUsd: 0` initializer + comment block)
- `lib/cost/__tests__/cost-counter.test.ts` (mock updated to mimic Postgres NULL + regression test "openCronRun creates a RUNNING row with costUsd initialized to 0")
- `lib/middleware/__tests__/no-live-api.test.ts` (mirror regression test)
- This file
- Followup: PLAN scorer follow-up #4 — Neon integration test against cost-counter

**Confidence:** high (regression test fails without the fix; CI typecheck + test on PR #6 commit 6704fc1 was green with the fix in place)
**Tags:** prisma, postgres-null-arithmetic, increment, cost-counter, mock-fidelity

### INC-2026-05-20-33 · Cowork /tmp accumulates per-tick orphans · loop halts at 100% disk

**Status:** 🟡 FIXED + VERIFICATION-PENDING — v0.6.20 STEP 0a.1 + 0a.2 shipped. First GC tick will validate; if `/tmp` free stays > 1 GB across 24h of ticks, mark FIXED + ENCODED.

**Symptom:** Cowork scheduled-task tick at 2026-05-20T15:15Z couldn't bootstrap. Loop-lock note: _"sandbox bash still unavailable (useradd: No space left on device on /etc/passwd) · cannot bootstrap /tmp clone, cannot query Postgres, cannot push"_. Inspection found `/dev/nvme0n1p1` (the sandbox's writable filesystem holding `/tmp`, `/etc`, and `/`) at 100% / 0 bytes available, with 27 orphan `/tmp/mapsly-*` clone dirs (~67 MB total) plus large one-off tool installs from prior ticks: `/tmp/lock-gen` (1.1 GB), `/tmp/prettier-check` (395 MB), `/tmp/node24` (207 MB), `/tmp/prettier-{cli,tool,bin,mini}` (~40 MB), `/tmp/db-helper` (38 MB), `/tmp/pg-cwk` (24 MB), `/tmp/zen-loop` (19 MB), `/tmp/fmt-pkg` (14 MB). Total accumulated waste ≈ 1.9 GB across ~30 successful ticks (B.0 through D.2 over ~12 hours).

When `/` hits 100%, the sandbox kernel can't even append to `/etc/passwd` to provision the per-tick user, so `useradd` fails before the iteration prompt is ever read. The loop is dead even though origin/main and the git/Vercel pipeline are healthy.

**Root cause:** v0.6.6 STEP 0 introduced the "/tmp clone per tick" pattern (correctly — fixes INC-29 FUSE wall). But no GC was scheduled. Each tick:

- Cloned origin to a unique-named work dir (`/tmp/mapsly-work-funny-sweet-tesla`, `/tmp/mapsly-work-eloquent-bold-clarke`, etc.) — never reused.
- Installed pnpm + Node + sometimes prettier/gh into a unique `/tmp/<tool>-<random>` dir — never reused.
- Wrote git-escape-hatch dirs (`/tmp/mapsly-git-1779258664`, etc.) — never cleaned.
- Left the working tree behind after exit. /tmp persists between sandbox sessions but is finite (~9.6 GB total, ~2 GB headroom after baseline sandbox files).

Each successful tick added 50–500 MB to `/tmp`. Catastrophic accumulation was inevitable.

**Fix applied (v0.6.20):**

1. **STEP 0a.1 — /tmp GC before bootstrap.** Every tick now runs:
   - `find /tmp -maxdepth 1 -name 'mapsly-*' (clone/git/loop/wt/commit/scratch/env/run/session patterns) -mmin +30 -exec rm -rf {} +`
   - `rm -rf` for the known one-off tool dirs (lock-gen, prettier-\*, fmt-pkg, zen-loop, mw, db-helper, pg-cwk)
   - `rm -f /tmp/*.tar.{xz,gz}` (extracted tarballs)
   - Logs `freed N MB · /tmp now M MB free` so the dashboard can track recovery.
2. **STEP 0a.2 — Sticky toolchain at canonical paths.** Node 24, pnpm, and gh now install ONCE to `/tmp/node24` and `/tmp/npm-global` (preserved by the GC). Subsequent ticks add them to PATH and skip install. Saves ~30–60 s per tick AND prevents the "every tick installs to a new unique path" disk waste.
3. **STEP 0b — Canonical work dir `/tmp/mapsly-work`.** Single dir, refreshed via `git fetch + git reset --hard origin/main` on each tick (when /tmp persists). No more uniquely-named clone dirs.

**Prevention:**

1. **Architectural rule:** `/tmp` in the Cowork sandbox is shared across ticks and finite. Every tick MUST GC its own orphans before consuming new space. Persistent toolchain installs go to canonical paths (`/tmp/node24`, `/tmp/npm-global`); ephemeral per-tick artifacts go to the canonical work dir (`/tmp/mapsly-work`) and get refreshed via `git reset --hard`, not re-cloned.
2. **STEP 0 telemetry:** `[step-0] /tmp GC freed N MB · /tmp now M MB free` must appear in every tick's output. The dashboard's auto-enhance signals card watches for `M < 500` (warning) and `M < 100` (critical, equivalent to the INC-33 dead state).
3. **No more unique-named clone dirs.** The v0.6.6 design used unique names (e.g. `mapsly-work-funny-sweet-tesla`) under the assumption that /tmp is ephemeral per session; it's actually shared. v0.6.20 fixes this by reusing `/tmp/mapsly-work` and refreshing in place.
4. **One-off tool installs are forbidden going forward.** If a tick needs prettier, pnpm, gh, etc., it MUST install via `/tmp/npm-global` (the sticky pnpm global location). New `/tmp/<unique-tool-name>-<random>` dirs in subsequent INCs = process-enhancer flags + STEP 0a.1 GC list extended.

**Where encoded:**

- `.claude/loop.md` v0.6.20 STEP 0a.1 (GC) + 0a.2 (sticky toolchain) + 0b (canonical work dir)
- This entry
- (followup) Dashboard auto-enhance signal: watch for `/tmp < 500 MB`

**Confidence:** high (probe-tested: deleting orphans from a user that owns them frees space; sandbox `nobody` user can rm its own orphans; sticky-path toolchain reuse pattern is standard)
**Tags:** loop, cowork, /tmp, disk-pressure, GC, sticky-toolchain, v0.6.20

### INC-2026-05-20-34 · Cowork sandbox host disk exhaustion · root FS full, bash can't start (supersedes mount-side draft "INC-32")

**Status:** ✅ FIXED + ENCODED — v0.6.26 STEP 0a.1 extends GC to include `/tmp/.pnpm-store` and prior-tick `node_modules` trees under disk pressure; v0.6.26 also clarifies the loop's graceful-skip semantics for host-infra gaps.

**Symptom:** Cowork scheduled-task ticks at 17:51 / 17:57 / 18:0x UTC on 2026-05-20 could not execute a single bash command. Every shell call (even `echo test`) returned:

```
bash failed on resume, create, and re-resume. resume: RPC error: ensure user:
useradd failed: exit status 1: useradd: /etc/passwd.179057: No space left on device
useradd: cannot lock /etc/passwd; try again later.
```

Progressive escalation across the day:

1. Earlier ticks (per build-log): `/tmp` at 100% used — `git clone /tmp/mapsly-work` per STEP 0 failed mid-clone (INC-33).
2. Later ticks (17:51+): root filesystem also full — Cowork's per-call user provisioner cannot append a row to `/etc/passwd`, so bash itself never starts. Nothing downstream runs: no git, no pnpm, no psql, no curl. The mount-side draft "INC-32" the tick wrote was a numbering collision with origin's existing INC-32; renumbered here to INC-34.

**Root cause:** Cowork sandbox's host writable volume (root FS `/dev/nvme0n1p1`, 9.6 GB) is exhausted. The provisioner appends to `/etc/passwd` per call; when ENOSPC fires there, the user account is never created and the shell exits before `bash -c '…'` runs. `/tmp` (same volume) and `/etc` share the same exhaustion class; either can fill first.

Two distinct accumulators contribute over a 12-hour shipping window:

- **/tmp/mapsly-\* clone orphans** (INC-33): ~50–500 MB per tick, addressed by v0.6.20 GC.
- **/tmp/.pnpm-store/v3 monotonic growth**: pnpm's content-addressable global store grows by ~50–200 MB whenever a tick installs deps with a new lockfile (or even minor version drift). v0.6.20 GC didn't touch it. Observed 1.1 GB grown across ~15 ticks. NEW finding in this entry.

**Fix applied (v0.6.26):**

1. STEP 0a.1 extended GC: when `df --output=avail /` reports < 1 GB free, drop the `mmin +30` filter and additionally nuke `/tmp/.pnpm-store`, `/tmp/pnpm-store`, `/tmp/.npm`, every `/tmp/mapsly-*` (except canonical `/tmp/mapsly-work`), and prior-tick `node_modules` trees older than 5 min. Logged as `[step-0] disk pressure detected — aggressive GC`.
2. STEP 10 cooldown discipline already specified: host-infra gaps (sandbox can't boot) are graceful-skip, NEVER cooldown. The skip tick at 18:02 correctly applied this.
3. Mount-side draft "INC-32" content folded here; the skip tick's loop-lock note + build-log entry stay accurate.

**Prevention:**

1. **Per-tick pnpm-store GC under pressure.** The pnpm-store is safe to wipe because the next install repopulates from network. Only nuke under pressure to avoid penalizing normal ticks.
2. **Detection telemetry.** STEP 0a.1 logs `[step-0] /tmp now M MB free` every tick. Process-enhancer should watch for `M < 500` (warning) or `M < 100` (critical: write an INFO Notification "Sandbox disk low — restart Cowork app to reclaim").
3. **Host-side recovery (not loop-side).** When root FS exhausts, NOTHING inside the sandbox can self-heal. The user must restart the Cowork desktop app, which reprovisions the sandbox volume. Document this in `docs/handoff.md`.
4. **Loop continues on macOS `/loop`.** Even with Cowork sandbox dead, the Mac `/loop` tick (when active) keeps shipping. This is the architectural justification for keeping `/loop` as a supported fallback per CLAUDE.md.

**Where encoded:**

- `.claude/loop.md` v0.6.26 STEP 0a.1 (extended GC, pnpm-store, disk-pressure-aware)
- `.claude/loop.md` STEP 10 (cooldown discipline — graceful-skip for infra gaps)
- `docs/handoff.md` § Cowork sandbox recovery (v0.6.26 addition)
- This entry

**Confidence:** high (probe-confirmed: /tmp/.pnpm-store/v3 was 1.1 GB and I manually freed it from this very interactive session)
**Tags:** sandbox, cowork-host, disk-exhaustion, pnpm-store, infra, graceful-skip, no-cooldown, v0.6.26, supersedes-mount-draft
