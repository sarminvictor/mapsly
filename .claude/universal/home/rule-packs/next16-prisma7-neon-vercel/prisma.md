# Prisma 7 · Neon serverless adapter

Stack rules for Prisma 7 + `@prisma/adapter-neon` on Vercel. Every section is a mechanical check — enforceable via the repo's deploy-check or a pre-commit grep; "be careful" is not enough. Examples use `DATABASE_URL`/`DIRECT_URL`; the actual env var name is product-defined (`.claude/product-spec.json` → `db.envVar`).

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
  schema: { path: "prisma/schema.prisma" },
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
```

**Mechanical check:** `grep -E 'url\s*=\s*env' prisma/schema.prisma` returns nothing on a clean tree.

## 2 · Neon adapter constructor (INC-03)

`PrismaNeon` takes a `PoolConfig` directly, NOT a `new Pool()`. Wrapping in `new Pool()` is a runtime `TypeError`.

```ts
// ❌ Wrong
const adapter = new PrismaNeon(new Pool({ connectionString }));

// ✅ Correct
const adapter = new PrismaNeon({ connectionString });
```

## 3 · Lazy-Proxy every module-scope client (INC-07) · canonical pattern

`new PrismaClient()`, `new Stripe()`, `new Resend()`, or any client that takes a secret in its constructor, called at module top-level, reads `process.env` AT BUILD TIME on Vercel. Build-time envs are NOT runtime envs → constructor throws → opaque build failure. This file owns the pattern; `vercel.md` §3 explains the two-phase env model.

```ts
// ✅ lib/prisma.ts (canonical, replicate per vendor)
function makeClient(): PrismaClient {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!,
  });
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

**Mechanical check:** `grep -nE '^const (prisma|stripe|resend|anthropic) = new ' lib services` returns nothing. Any match is a future build failure.

## 4 · `prisma generate` at install + build time (INC-06)

Vercel's build runner skips `prisma generate` unless package.json asks explicitly. Without it, the generated client is missing and TypeScript is red.

```json
"scripts": {
  "postinstall": "prisma generate",
  "build": "prisma generate && next build"
}
```

Both lines: `postinstall` covers dependency install; `build` covers the explicit build step.

## 5 · Import-path discipline

One generated client, three entry points — never import the generated output path directly:

| Context                         | Import from           |
| ------------------------------- | --------------------- |
| Server code (client + types)    | `@/lib/prisma`        |
| Client components (types/enums) | `@/lib/prisma-types`  |
| Scripts / seeds                 | `@/lib/prisma-script` |

The Prisma 7 generator (`prisma-client`, not `prisma-client-js`) outputs `client.ts` (server) and `browser.ts` (types). Importing the server client into a `'use client'` file pulls the driver adapter into the browser bundle.

## 6 · Neon deserialization + NULL arithmetic (INC-08, INC-32)

**6a · `name` columns.** PG's `name` type (typoid 19 — system catalogs, `information_schema`) is not deserialized by the Neon adapter. Cast in every raw query:

```ts
await prisma.$queryRaw`SELECT column_name::text FROM information_schema.columns`;
```

**6b · `{ increment }` over NULL is a silent no-op.** PG evaluates `NULL + N = NULL`. Any column written via `{ increment }`/`{ decrement }` MUST be non-null with `@default(0)` — or explicitly initialized to `0` at `create()`. Test mocks must mimic NULL semantics, or they hide the bug (INC-32).

## 7 · `serialize()` Prisma results inside `'use cache'`

Prisma client extensions attach Symbol properties, and Decimal columns return Decimal objects — the cache serializer rejects both. Wrap EVERY Prisma result inside a `'use cache'` function:

```ts
const data = serialize(await prisma.model.findFirst({ ... }));
```

The `serialize()` helper (strip Symbols, Decimal→Number) lives next to the client singleton. NOT needed in API routes or server actions — only where results cross a cache or server→client boundary.

## 8 · Raw SQL — verify before writing

Before writing ANY `$queryRaw`/`$executeRaw`:

1. Query `information_schema.columns` for the actual column names + types — never assume from Prisma model names.
2. Quote camelCase columns: `"reviewText"`, `"ownerId"`. Lowercase columns need no quotes.
3. Wrap DateTime fields in `new Date()` before `.toISOString()` — extensions may strip the Date type.
4. Never `$queryRawUnsafe` with user input.

## 9 · Migrations + schema drift (INC-23, INC-37, INC-42)

**9a · Prisma and the remote DB drift silently.** `prisma db push` updates the DB without a migration file; `migrate dev` writes a file without touching remote. Mismatch → deployed client SELECTs columns the DB lacks → queries throw → swallow-catches turn it into invisible 404s/empty states. Pair every schema change with the remote apply in the same commit, and add `prisma migrate status` to deploy-check.

**9b · `migrate dev` can RESET a drifted production DB** (INC-42 · near data-loss). On a DB with db-push history, `migrate dev` detects drift and offers to drop the schema. NEVER run it against production. Additive-change recipe instead:

```bash
# 1. edit schema.prisma   2. hand-write prisma/migrations/<ts>_<slug>/migration.sql (forward-only)
prisma db execute --file prisma/migrations/<ts>_<slug>/migration.sql   # run ALONE, check exit code
prisma migrate resolve --applied <ts>_<slug>
prisma generate
```

Never chain the execute step with `&&` into the resolve step — a failed execute must not let resolve mark un-run DDL as applied.

**9c · `select` over `include` in long-lived queries** (INC-37). Broad `include` fetches EVERY column, including ones added to the schema after the deployed `prisma generate` ran — additive drift then breaks the query. Explicit `select` lists only rendered fields. Companion rule: never swallow Prisma errors into `catch { return empty }` — log and surface, or drift becomes invisible.

## 10 · `'use cache'` + Prisma at build phase

Every `'use cache'` Prisma query needs a build-phase guard — see `cache-components.md` Pattern 1 (that file owns the NEXT*PHASE + `EMPTY*\*` pattern).

## Anti-patterns (block at review)

- ❌ `url = env(...)` inside the datasource block (INC-02)
- ❌ `new PrismaNeon(new Pool(...))` (INC-03)
- ❌ Any secret-bearing client constructed at module scope (INC-07)
- ❌ `SELECT name FROM ...` without `::text` in `$queryRaw` (INC-08)
- ❌ Nullable numeric column + `{ increment }` (INC-32)
- ❌ Unserialized Prisma result inside `'use cache'`
- ❌ Build script missing `prisma generate` (INC-06)
- ❌ `migrate dev` against a production/drifted DB (INC-42)
- ❌ Broad `include` + swallow-catch in a deployed query (INC-37)
- ❌ One-arg `revalidateTag(tag)` — see `caching.md` § Revalidation (INC-13)
