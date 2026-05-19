# Mapsly

Signal-driven local-business intelligence. Two portals, one platform:

- **SMB** — Maria's daily diagnostic for her own business
- **Agency** — Tom's prospecting engine across 2.1M businesses

## Quick start

```bash
pnpm install
cp .env.example .env.local   # then fill in secrets — see docs/handoff.md
pnpm db:push                 # creates schema in Neon
pnpm dev                     # http://localhost:3000
```

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — orchestrator + conventions
- [`PLAN.md`](./PLAN.md) — build roadmap (autonomous loop reads this)
- [`docs/data-cadence.md`](./docs/data-cadence.md) — what runs daily/weekly/monthly + cost ceiling
- [`docs/handoff.md`](./docs/handoff.md) — manual setup checklist
- [`docs/autonomous-build-setup.md`](./docs/autonomous-build-setup.md) — Claude Code cloud config
- [`_design/`](./_design/) — original HTML mockups (reference only)

## Stack

Next.js 16 · React 19 · Prisma 7 (Neon) · Tailwind 4 · NextAuth v5 · Vercel · Sentry · Stripe · DataForSEO · Meta Ad Library · Anthropic Claude.

## License

Proprietary · Viktor Sarmin.
