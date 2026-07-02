# next16-prisma7-neon-vercel · shared stack rule pack

Battle-tested rules for the Next.js 16 (cacheComponents/PPR) + React 19 + Prisma 7 + Neon + Vercel stack, distilled from 40+ production incidents across products running it. Product-agnostic: personas, voice, cache-tag lists, and budget values live in each repo's `.claude/product.md` + `.claude/product-spec.json` — this pack carries only the stack mechanics.

Import from a project's CLAUDE.md with one line:

> Stack rules: see `~/.claude/rule-packs/next16-prisma7-neon-vercel/` — read the relevant file before touching Prisma/cache/Vercel config.

Files: `prisma.md` (client + schema + migrations), `vercel.md` (build/deploy semantics), `cache-components.md` (PPR patterns), `caching.md` (three layers + tag convention), `data-fetching.md` (pattern decision tree), `agent-lessons.md` (agent-harness principles).

Contract: when a stack-level incident is fixed in any product, the prevention lands HERE (with its INC id cited) so every product inherits it. Product-specific incidents stay in that repo's own rules.
