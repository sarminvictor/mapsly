# cacheComponents (PPR) · the patterns that get every dynamic route through the build

`next.config.ts` has `cacheComponents: true` (Partial Pre-Rendering). Powerful but unforgiving: the Vercel build worker can't open DB sockets, React's prerender serialization rejects function values, and cache scopes police their own time/entropy access. **PPR errors are RUNTIME bailouts — `tsc --noEmit` and unit tests cannot catch them. The only check is a real `next build`. Run it locally (or in a pre-push hook) before pushing.**

## Pattern 1 · `'use cache'` Prisma queries MUST short-circuit at build time (INC-25, INC-27)

This file owns the NEXT_PHASE guard. The build worker cannot reach the DB (`vercel.md` §5), so cacheComponents' build-time cache population fails with opaque errors that surface as "Uncached data was accessed outside of `<Suspense>`".

```ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";
import prisma, { serialize } from "@/lib/prisma";

export const EMPTY_THING: Thing = {
  // EVERY field of the interface, even optional ones — partial shapes fail
  // TypeScript's literal-shape check one missing field at a time (INC-25).
  field1: 0,
  field2: null,
  list: [],
  nested: { a: 0, b: 0 },
};

export async function getThing(): Promise<Thing> {
  "use cache";
  cacheLife("seconds");
  cacheTag("thing");
  if (process.env.NEXT_PHASE === "phase-production-build") return EMPTY_THING;
  try {
    return serialize(shape(await prisma.thing.findMany({ /* ... */ })));
  } catch {
    return EMPTY_THING;
  }
}
```

**Hard rules:**

- `EMPTY_X` is an exported `const` typed against the interface — guard, catch, and tests share one source of truth.
- Never return `null` from a guard when the declared type isn't nullable.
- Wrap Prisma results in `serialize()` — `prisma.md` §7 owns that pattern.

## Pattern 2 · Pages doing auth/cookies/DB wrap the async body in `<Suspense>`

Async page bodies that read cookies, auth, or DB cannot be the default export directly.

```tsx
// Outer is SYNC — shell + Suspense only.
export default function ProtectedPage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <ProtectedBody params={params} />
    </Suspense>
  );
}

// Inner is ASYNC — uncached work, renders or redirects.
async function ProtectedBody({ params }: Props) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) unauthorized();
  // ... DB queries, redirects
  return null; // unreachable after redirect(), but TS needs it
}
```

If a route truly must be dynamic without Suspense, use `await connection()` from `next/server` inside the inner component — never `export const dynamic` (Pattern 5).

## Pattern 3 · `searchParams` and request-time data — the Resolver pattern

`searchParams` is always dynamic. Awaiting it at the outer page level fails the build ("Uncached data was accessed outside of `<Suspense>`"); passing the Promise as a prop across a Suspense boundary fails serialization (Promises carry function refs → Pattern 4c). Canonical shape:

```tsx
export default function Page({ params, searchParams }: PageProps) {
  return (
    <Suspense>
      <PageResolver params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PageResolver({ params, searchParams }: PageProps) {
  const { slug } = await params;         // await INSIDE the boundary
  if (!isValidSlug(slug)) notFound();
  const { filter } = await searchParams;
  return <PageContent slug={slug} filter={filter} />;
}

async function PageContent({ slug, filter }: { slug: string; filter?: string }) {
  "use cache";
  cacheLife("weeks");
  cacheTag(`item-${slug}`);
  // ...
}
```

When `params` are static via `generateStaticParams`, the outer page may await them; only the truly-dynamic data needs the Suspense barrier.

## Pattern 4 · No function props across the server→client boundary

The `'use client'` boundary serializes props; functions can't serialize:

```
Error: Functions cannot be passed directly to Client Components
```

Three expressions of the same defect:

**4a · `t.rich()` render props** (INC-26). `t.rich(key, { link: chunks => <Link>{chunks}</Link> })` passes a function through the tree. Fix: convert the file to `"use client"`, OR use plain `t(key)` and render the link manually.

**4b · Function-typed label/formatter props** (INC-40). `labels: { openAria: (name: string) => string }` passed to a client component trips the same error. Two canonical fixes:

- **Per-row functions** → pre-resolve into a plain `string` field on each row object server-side (run the function once per row in the `.map()`).
- **Variable-arg functions (count-based plurals)** → resolve in the client via `useTranslations(namespace)`; pass the namespace as a plain string prop.

**4c · Promises on Suspense boundaries** — a Promise has `.then` (a function). Await inside the boundary (Pattern 3), never pass the Promise across it.

**Hard rule:** before crossing any `'use client'` boundary, audit every prop. Any field typed `(...args) => ...` WILL fail at runtime — TypeScript allows it because the check lives in React, not the type system.

## Pattern 5 · No route-segment config exports

All of these are incompatible with cacheComponents and/or the modern cache model — delete them:

- `export const dynamic = 'force-dynamic'` → build error; use `await connection()` or Pattern 2's Suspense wrap
- `export const revalidate` / `export const dynamicParams` → use `'use cache'` + `cacheLife()` + `cacheTag()`
- `export const runtime = 'nodejs'` → Node is already the default

## Pattern 6 · Validate dynamic params BEFORE entering the cache scope

**Dynamic-param pages (`[slug]`, `[city]`, …) MUST validate slugs before the `'use cache'` directive runs.** Bots crawl literal-bracket URLs (`/%5Bcity%5D` = `/[city]`). If `'use cache'` opens first, cache bookkeeping starts (internal `Date.now()`, remote-store connection), then `notFound()` throws MID-WRITE inside the cache scope. Production surfaces this as **"Connection closed"** (cache write race) or **"Route used `Date.now()` before accessing uncached data" → `NEXT_STATIC_GEN_BAILOUT`** — hundreds of hits/day on crawled sites, invisible on pre-built paths, only on-demand slugs blow up.

```ts
// Outer: uncached, validates, may call notFound()
export default async function CityPage({ params }: Props) {
  const { city } = await params;
  if (!isValidSlug(city)) notFound(); // clean abort, never enters cache scope
  return <CityPageContent citySlug={city} />;
}

// Inner: cached, only runs for validated params — takes PLAIN STRINGS (stable cache key)
async function CityPageContent({ citySlug }: { citySlug: string }) {
  "use cache";
  cacheLife("max");
  cacheTag(`city-${citySlug}`);
  // ...
}
```

Apply the SAME split to `generateMetadata` (invalid slugs return a noindex `Metadata` object; valid ones call a cached inner metadata function). Pair page + metadata with the same `cacheTag` so one `revalidateTag` flushes both.

## Pattern 7 · Dynamic client hooks + Suspense placement

**7a · A cached page rendering a client component that calls a dynamic hook** (`useSearchParams`, `usePathname`, `useParams`) MUST wrap that component in its own tight `<Suspense>` with a REAL fallback (loader/skeleton). A fallback of `<>{children}</>` re-renders the same dynamic subtree and does not count as a boundary.

**7b · NEVER add a shell-spanning `<Suspense>` to a route-group layout** — even `fallback={null}` "as a safety net". Under React 19 streaming, any boundary wrapping the page tree streams children into a hidden placeholder swapped in by an inline script; when that script is delayed (slow network, CSP, extensions), users see the fallback as a literal white screen. `fallback={<>{children}</>}` is worse: children render TWICE in the HTML. Each dynamic-hook component carries its own leaf-level Suspense; layouts carry none.

## Pattern 8 · Static route groups must not read request-scoped APIs

In statically-cached route groups and the root layout: no `headers()`, no `cookies()`, and no request-reading i18n server APIs (`getLocale()`, `getMessages()`) — any of these opts the whole group out of prerendering or breaks the build. Confine them to explicitly-dynamic route groups; keep the root layout minimal. Same family: no `new Date()` / `Date.now()` / `Math.random()` / `crypto.randomUUID()` in prerenderable server components (INC-09) — use build-time identifiers (`VERCEL_GIT_COMMIT_SHA`) or move the read into a client component.

## Reading PPR stack traces (easy to misread)

When `next build` reports "Uncached data was accessed outside of `<Suspense>`", the trace points at the **closest `'use client'` ancestor**, NOT the offender — server components are erased from the trace. Debug order:

1. Ignore the deepest client component in the trace; open the **page file for the failing route** in the error message.
2. Check it for top-level `await params` / `await searchParams` / `await headers()` / `await cookies()` before the page returns its `<Suspense>`.
3. If clean, recurse into nested layouts in the same route group.
4. Only then suspect the traced component itself.

## Checklist for every new page

- [ ] Awaits anything uncached (auth, cookies, searchParams, DB)? → Pattern 2/3: Suspense wrap / Resolver.
- [ ] Dynamic params? → Pattern 6: validate before the cache scope, in page AND generateMetadata.
- [ ] Uses `t.rich()` or passes any function-typed prop to a client child? → Pattern 4.
- [ ] Any helper uses `'use cache'` + Prisma? → Pattern 1: `EMPTY_X` + NEXT_PHASE guard + `serialize()`.
- [ ] Any route-segment config export? → Pattern 5: delete it.
- [ ] Client child uses a dynamic hook? → Pattern 7a: tight leaf Suspense with a real fallback.
- [ ] Ran `next build` locally? → the only check that catches prerender bailouts.

## Anti-patterns

- ❌ Promise prop crossing a Suspense boundary
- ❌ NEXT_PHASE guard returning a partial object
- ❌ `catch {}` returning a different shape than the success path
- ❌ Async default export reading `cookies()`/`auth()` without a Suspense wrap
- ❌ `'use cache'` opening before slug validation on a dynamic-param page
- ❌ Layout-level shell Suspense (`fallback={null}` or `fallback={children}`)
- ❌ `t.rich()` in a server component file
- ❌ Any function-typed prop into a `'use client'` component
- ❌ `force-dynamic` / `revalidate` / `runtime` segment exports

## Cites

INC-09, 25, 26, 27, 40 (originating product's incident log) + the validate-before-cache, white-screen, and trace-reading lessons from a second product on the same stack.
