# Install · Boxly manifest

1. Copy `product.md` and `product-spec.json` from this folder into `/Users/Viktor/Documents/Boxly_development/boxly_app/.claude/`.
2. Add one line near the top of Boxly's `CLAUDE.md`: `> Stack rules come from the shared pack \`next16-prisma7-neon-vercel\` (see \`.claude/product-spec.json\` + \`.claude/product.md\`); product values live in those two files.`
3. Delete rules now fully covered by the shared pack: `.claude/rules/ppr-caching.md`, `.claude/rules/database.md` — the Boxly-specific bits (active-movers filter, `serialize()`, validate-before-cache slugs, dynamic-hook + layout Suspense criticals, per-city cache tags) already live in `product.md` § Domain invariants as of this bundle.
4. Trim `.claude/rules/nextjs-react.md`: the generic Next 16 / React 19 sections (runtime export, Promise params, `after()`, auth interrupts, server-vs-client defaults) duplicate the pack — keep only Boxly-specific import paths + `serialize()` notes, or delete the file since CLAUDE.md already carries the import table.
5. Keep everything else as-is (`conventions.md`, `ui-components.md`, `api-patterns.md`, `api-hooks.md`, `auth.md`, `modules-pattern.md`, `testing.md`, `quality-checklist.md`, `mcp-*.md`) — product-specific, no overlap. Resolve the TODO-Viktor markers in both manifest files when convenient.
