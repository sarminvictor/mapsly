# Prisma · canonical rule for the 9 prisma-tagged INCs

Mapsly runs Prisma 7 on the Neon serverless adapter. The 9 incidents tagged `prisma` over Phase 0–1 cluster into 5 mechanical checks. **Every one of them is enforceable via `pnpm deploy-check` or a pre-commit grep; "be careful" is not enough.**

## 1 · Schema datasource shape (INC-02)

The Prisma 7 `datasource` block accepts ONLY `provider`. `url` and `directUrl` moved to `prisma.config.ts`.

```prisma
// ✅ schema.prisma
datasource db { provider = "postgresql" }
```

```ts
// ✅ prisma.config.ts
import { defineConfig } from "prisma/config";
export default defineConfig({
  earlyAccess: true,
  schema: { path: "prisma/schema.prisma" },
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
```

**Mechanical check:** `grep -E 'url\s*=\s*env' prisma/schema.prisma` returns nothing on a clean tree. CI fails if it returns a hit.

## 2 · Neon adapter constructor (INC-03)

`PrismaNeon` takes a `PoolConfig` directly, NOT a `new Pool()`. Wrapping in `new Pool()` causes a runtime `TypeError: Cannot read properties of undefined`.

```ts
// ❌ Wrong
const adapter = new PrismaNeon(new Pool({ connectionString }));

// ✅ Correct
const adapter = new PrismaNeon({ connectionString });
```

## 3 · Lazy-instantiate every client at module scope (INC-07, supports INC-06)

`new PrismaClient()`, `new Stripe()`, `new Resend()`, `new Anthropic()`, `new DataForSEOClient()` called at module top-level will read `process.env` AT BUILD TIME on Vercel. Build-time envs are NOT runtime envs → secrets are undefined → constructor throws → Vercel build fails opaquely.

Wrap each module-scope client behind a Proxy that defers instantiation to first call:

```ts
// ✅ lib/prisma.ts (canonical pattern, replicate per vendor)
function makeClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function getClient(): PrismaClient {
  if (!globalThis.__prisma) globalThis.__prisma = makeClient();
  return globalThis.__prisma;
}

export default new Proxy({} as PrismaClient, {
  get(_t, prop, recv) {
    return Reflect.get(getClient(), prop, recv);
  },
}) satisfies PrismaClient;
```

**Mechanical check:** `grep -nE '^const (prisma|stripe|resend|anthropic|dfs) = new ' lib services` returns nothing. Anything matching is a future build failure.

## 4 · Vercel build needs `prisma generate` (INC-06)

Vercel's build runner skips `prisma generate` unless package.json calls it explicitly. Without it, `lib/generated/prisma/` is missing and TypeScript types are red.

```json
// ✅ package.json
"scripts": {
  "postinstall": "prisma generate",
  "build": "prisma generate && next build"
}
```

Both lines are required: `postinstall` runs during dependency install on Vercel; `build` covers the explicit build step.

## 5 · Neon adapter + Postgres `name` type (INC-08, INC-32)

Two failure modes on the same underlying issue (Postgres returning data the Neon adapter can't deserialize):

**5a. `name` columns.** PG's `name` type (typoid 19, used by system catalogs and `information_schema`) is not deserialized by Neon's serverless adapter. `$queryRaw` returns malformed JS objects.

```ts
// ❌ Cannot deserialize:
await prisma.$queryRaw`SELECT column_name FROM information_schema.columns`;

// ✅ Cast to text:
await prisma.$queryRaw`SELECT column_name::text FROM information_schema.columns`;
```

**5b. NULL arithmetic with `{ increment }`** (INC-32). PG returns `NULL + N = NULL` (standard SQL semantics). If a nullable column starts NULL, `prisma.update({ data: { costUsd: { increment: 0.01 } } })` leaves it NULL forever — no error, just silent dropped tracking.

```ts
// ❌ Initial state NULL → increment is a no-op
await prisma.cronRun.update({
  where: { id },
  data: { costUsd: { increment: 0.01 } },
});

// ✅ Initialize at row creation
await prisma.cronRun.create({
  data: { job: "weekly-snapshot", costUsd: 0 /* explicit zero */ },
});
```

**Schema rule:** any column whose downstream consumer uses `{ increment }` MUST be non-null with an explicit `@default(0)` (numeric) or `@default(0.0)` (decimal). Add to PR checklist: "Did I add a new `Float?`/`Int?` column? Does anything `{ increment }` it? If yes, drop the `?` + add `@default`."

## 6 · Schema drift between Prisma + Neon (INC-23)

`prisma db push` updates Neon; `prisma migrate dev` writes a migration file but doesn't push to remote unless followed by `prisma migrate deploy`. Mismatch → app references columns the DB doesn't have → silent `findUnique` returns null → 404s.

**Workflow rule:**

```bash
# Local schema change
pnpm prisma migrate dev --name <slug>      # writes migration + applies to local
git add prisma/migrations/                 # commit the migration file

# Push to Neon (production or test branch)
pnpm prisma migrate deploy                 # applies pending migrations to remote
# OR for prototyping (skip migration file):
pnpm prisma db push                        # applies live without migration history
```

**Mechanical check:** `pnpm prisma migrate status` (no diff = green). Add to `deploy-check`:

```json
"scripts": {
  "deploy-check": "pnpm format && pnpm typecheck && pnpm lint && pnpm prisma migrate status && pnpm build"
}
```

## 7 · `cacheComponents` + Prisma at build phase (INC-25, INC-27)

Cross-referenced with `.claude/rules/cache-components.md` Pattern 1. Every `'use cache'` Prisma query MUST short-circuit during the Vercel build (Neon WebSocket can't open from the build worker) AND return an `EMPTY_*` typed constant that is THE EXACT SHAPE of the declared interface (NEXT_PHASE guard return shapes must be 100% complete — TS errors cascade otherwise).

```ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export const EMPTY_X: X = {
  field1: 0, field2: null, list: [], nested: { a: 0, b: 0 },
  // ^ EVERY field of the X interface, even the optional ones
};

export async function getX(): Promise<X> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dashboard-x");
  if (process.env.NEXT_PHASE === "phase-production-build") return EMPTY_X;
  try {
    return shape(await prisma.x.findMany({ /* ... */ }));
  } catch {
    return EMPTY_X;
  }
}
```

## 8 · `revalidateTag` requires cacheLife profile (INC-13)

Next 16's `revalidateTag(tag)` (one arg) is a runtime error. Always two args:

```ts
revalidateTag(`business-${slug}`, "days");
revalidateTag(`list-${id}`, "minutes");
```

The second arg is the `cacheLife` profile the tag's downstream caches should adopt going forward.

## Anti-patterns (any one of these in a PR diff = block at review)

- ❌ `datasource db { provider = "postgresql" url = env("DATABASE_URL") }` (INC-02)
- ❌ `new PrismaNeon(new Pool(...))` (INC-03)
- ❌ `const prisma = new PrismaClient()` at module scope (INC-07)
- ❌ `SELECT name FROM ...` without `::text` cast in `$queryRaw` (INC-08)
- ❌ Nullable numeric column + `{ increment }` (INC-32)
- ❌ `'use cache'` Prisma query without NEXT_PHASE guard (INC-27)
- ❌ Build script missing `prisma generate` (INC-06)
- ❌ `revalidateTag(tag)` one-arg (INC-13)
- ❌ Local migration not pushed to Neon before release (INC-23)

## Cites

INC-02, 03, 06, 07, 08, 13, 23, 25, 27, 32 — see `.claude/memory/incidents.md`.
