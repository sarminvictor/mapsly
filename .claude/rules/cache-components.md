# cacheComponents · the 5 patterns that get every dynamic route through Vercel build

`next.config.ts` has `cacheComponents: true` (Partial Pre-Rendering). It's powerful but unforgiving: Vercel's build container can't open Neon WebSockets, and React's prerender serialization rejects function values in the page tree. **Every page that touches DB, auth, cookies, or searchParams hits at least one of these patterns.** Encode them up-front; do not discover them via failing CI.

## Pattern 1 · `'use cache'` Prisma queries MUST short-circuit at build time

```ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export const EMPTY_THING: Thing = {
  // EVERY field of the interface, even the optional ones — TypeScript will
  // surface a missing field on Vercel build at literal-shape comparison time.
  field1: 0,
  field2: null,
  list: [],
  nested: { a: 0, b: 0 },
};

export async function getThing(): Promise<Thing> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-thing");

  // Short-circuit at build: Neon WebSocket cannot open from Vercel's build
  // worker, so Prisma rejects with opaque ErrorEvent. Return EMPTY so the
  // shell prerenders cleanly; runtime first-request re-runs the function.
  if (process.env.NEXT_PHASE === "phase-production-build") return EMPTY_THING;

  try {
    const rows = await prisma.thing.findMany({
      /* ... */
    });
    return shape(rows);
  } catch {
    return EMPTY_THING;
  }
}
```

**Hard rules:**

- The guard return must be the **exact shape** of the declared return type — TypeScript catches partial shapes at literal-comparison time (this is what failed B.6 four commits in a row).
- Export EMPTY_X as a `const` typed against the interface so the guard, the catch, and unit tests all share one source of truth.
- Never return `null` from a guard if the declared type isn't nullable — Vercel will type-error.

## Pattern 2 · Pages doing auth/cookies/DB MUST wrap async body in `<Suspense>`

```tsx
// app/[locale]/some-protected-route/page.tsx
import { Suspense } from "react";
import { auth } from "@/lib/auth";

// Outer is SYNC — it just returns the shell + Suspense.
export default function ProtectedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ProtectedBody params={params} />
    </Suspense>
  );
}

// Inner is ASYNC — it does the uncached work and either renders or redirects.
async function ProtectedBody({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) unauthorized();
  // ... DB queries, redirects, etc.
  return null; // Unreachable if redirect() throws — but TS needs it.
}
```

**Hard rules:**

- Async page bodies that read cookies, auth, or DB **cannot be the default export directly.** They must live inside a Suspense-wrapped inner component.
- The inner component's return type must be `ReactNode | Promise<ReactNode>` — add `return null;` after any unreachable `redirect()` / `unauthorized()` call so TS infers correctly.

## Pattern 3 · `searchParams` and other request-time params are uncached — wrap them too

```tsx
// app/[locale]/some-form/page.tsx — uses ?prefill=foo
export default async function SomeFormPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("some.form");

  return (
    <main>
      <h1>{t("title")}</h1>
      <Suspense fallback={<DefaultPrefill />}>
        <PrefillFromSearchParams searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
```

If your `searchParams` value enters the React tree as a **prop on a Suspense boundary**, you'll get `Functions cannot be passed directly to Client Components` because Promises contain function references. **Solution:** await searchParams INSIDE the inner component, not on the boundary.

## Pattern 4 · No `t.rich()` render props in server components

`next-intl`'s `t.rich(key, { renderProp: chunks => <Link>{chunks}</Link> })` passes a **function** through the React tree. Under cacheComponents prerender that function gets serialized → `Functions cannot be passed directly to Client Components`.

**Pick one:**

- **Convert the file to `"use client"`** — works everywhere, page renders client-side
- **Use plain `t(key)` returning a string** + render the link manually next to it

Hard rule: if your component imports `Link` from `@/i18n/navigation` AND uses `t.rich()` AND has `cacheComponents` on, mark it `"use client"`.

## Pattern 5 · Don't mix `force-dynamic` with cacheComponents

```ts
// app/(dev)/dev/layout.tsx
// ❌ BROKEN under cacheComponents:
export const dynamic = "force-dynamic";

// ❌ ALSO BROKEN — Vercel applies modifyConfig, still rejects this:
export const revalidate = 0;
```

The error is unambiguous:

```
Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`.
```

**Canonical fix:** mark the route dynamic via `await connection()` from `next/server` at the top of the (sync-wrapped, Suspense-bounded) inner component, OR rely on Pattern 2's Suspense wrap which already opts out of prerender.

## Checklist for every new page

Before opening a PR with a new route:

- [ ] Does it `await` anything uncached (auth, cookies, searchParams, DB)? → Pattern 2: Suspense wrap.
- [ ] Does it use `t.rich()`? → Pattern 4: `"use client"`.
- [ ] Does any helper use `'use cache'` + Prisma? → Pattern 1: `EMPTY_X` constant + NEXT_PHASE guard.
- [ ] Does it use `export const dynamic`? → Pattern 5: delete it; use `connection()` or Suspense.
- [ ] Does it pass `Promise<...>` as a prop crossing Suspense? → Pattern 3: await inside the boundary, not outside.

## Anti-patterns

- ❌ Passing a `Promise` prop to a Suspense'd child component (Promise has `.then`, that's a function)
- ❌ NEXT_PHASE guard returning a partial object (`{status: "ok"}` instead of `{status, haltPct, dailyUsd}`)
- ❌ `try { ... } catch {}` that swallows the failure and returns a different shape than the success path
- ❌ Async default export reading `cookies()` / `auth()` without a Suspense wrap
- ❌ `t.rich()` in a server component file (must be `"use client"`)
- ❌ Adding `force-dynamic` to a route segment instead of using `connection()`

## Cites

- INC-09 (cacheComponents PPR forbidden APIs)
- INC-25 (NEXT_PHASE guard return shape parity)
- INC-26 (next-intl t.rich render props don't serialize)
- INC-27 (Vercel build cannot open Neon WebSocket — every Prisma `'use cache'` needs the guard)
