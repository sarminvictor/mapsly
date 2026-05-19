---
description: Project-wide conventions for TS/TSX files. Always loaded.
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

# Conventions

## TypeScript

- **Strict everywhere.** No `any` without an inline `// eslint-disable-next-line` justification.
- **No `as unknown as X` casts.** If you need them, the type model is wrong — fix the source.
- **Discriminated unions** for state shapes. Don't use optional fields where unions would be clearer.
- **Zod** for any external input (API bodies, env vars, webhook payloads). Never trust shape.
- **Branded types** for IDs: `type BusinessId = string & { __brand: 'BusinessId' }`. Prevents mixing IDs.

## Naming

- **camelCase** functions, variables.
- **PascalCase** types, components, classes.
- **SCREAMING_SNAKE** env vars and runtime constants.
- **kebab-case** file names. Exception: React components — `PascalCase.tsx`.

## React / Next.js 16

- **Server components by default.** `'use client'` only when needed.
- **`async` server components.** Fetch data inline. No `useEffect` for data.
- **`use cache` directive** for pure server fns.
- **`after()` API** for post-response work.
- **No `runtime = 'nodejs'` exports** — Turbopack defaults to Node.
- **Auth interrupts:** `forbidden()` and `unauthorized()` from `next/navigation`.

## API routes

- **One file = one route.**
- **Validate body with Zod** — 400 on validation fail.
- **Rate-limit user-facing routes** — `lib/middleware/rate-limit.ts`. Public: 30/min/IP.
- **Cron routes check `CRON_SECRET` header** — 401 if missing.
- **CronRun open at start, close at end** — even on failure.

## Cost discipline

- No DataForSEO / Meta / Lighthouse calls in user request path.
- All external calls through `services/{vendor}` adapters which log to `CronRun.costUsd`.
- Cache aggressively. 24h Lighthouse dedup. 7d SERP dedup.
- Batch where supported.

## Imports

- `@/` path alias. No `../../../`.
- Group: external → `@/lib` → `@/modules` → relative.

## Tests

- Vitest. `__tests__/` next to source.
- Integration tests hit real DB (Neon test branch).
- Mock external APIs at the service-adapter boundary.

## Commits

- Conventional: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
- One concern per commit.
- Run `pnpm deploy-check` before committing.
