# Git discipline · branches, commits, tags, force-push policy

> **OVERRIDE · 2026-07-02.** The auto-merge workflow described below applies only to a re-enabled loop with `pushPolicy: auto`.
> Current standing rule: **no commit/push without Viktor's approval** — push to gitlab `main` = production deploy.
> GitLab is the primary remote (Vercel deploys from it); GitHub is a mirror; the GitHub-targeted loop is PAUSED.

Single source of truth: `main`. Everything ships through PRs (even autonomous ones). Auto-merge label gates production deploy.

## Branch names

| Pattern                          | Owner            | When                    |
| -------------------------------- | ---------------- | ----------------------- |
| `auto/YYYY-MM-DD-{phase-id}-{n}` | Autonomous loop  | Each task it picks up   |
| `enhance/YYYY-MM-DD-{topic}-{n}` | Process-enhancer | Self-improvement PRs    |
| `fix/{slug}`                     | Human (Viktor)   | Hotfix not via loop     |
| `feat/{slug}`                    | Human            | Significant manual work |
| `chore/{slug}`                   | Either           | Tooling, docs, deps     |

Auto-merge workflow (`.github/workflows/auto-merge.yml`) only fires on branches starting with `auto/` or `enhance/`. Other branches require manual merge.

## Commit messages · Conventional Commits

```
type(scope): one-line summary

Optional body explaining WHY (not what — diff shows what).

Footer with task ID, INC-IDs cited, etc.
```

Types: `feat` · `fix` · `refactor` · `perf` · `docs` · `style` · `test` · `chore` · `build` · `ci`.

Scope = module or surface (`smb-reviews`, `hunter`, `cron-weekly`, `dev-dashboard`, `loop`).

### Loop commits

The autonomous loop always writes the task ID and incident citations:

```
feat(hunter): F.2 · filter row editing + comparator picker

Implements F.2 from the agency portal group. Reuses signal registry
from D.1. Adds <ComparatorPicker> client component with debounced
live-count fetch.

Task: F.2
Cites incidents: INC-09 (no new Date() in server component)
```

## Force-push policy

- **`main` is never force-pushed.** No exceptions. (Branch protection enforces once enabled.)
- **`auto/*` branches**: force-push allowed only by the session that owns it (matches `Task.lastSessionId`)
- **`enhance/*` branches**: force-push allowed by process-enhancer only
- **Local working trees**: use `--force-with-lease`, never `--force`

If main is somehow polluted (rare): the recovery is to revert, not force-push.

## Tags

- Every successful merge that bumps `MINOR` or `MAJOR` gets a git tag: `v0.3.0`
- Patch-level merges do not tag (too noisy)
- Tags push to origin via `git push origin v0.3.0`
- GitHub auto-generates release notes from tag-to-tag commits

## Pull request hygiene

| Field     | Required?                                                                               |
| --------- | --------------------------------------------------------------------------------------- |
| Title     | `type(scope): one-line` — same as the merge commit                                      |
| Body      | Linked Task ID, what changed, validation outcomes (from TaskRun), screenshots if UI     |
| Labels    | `autonomous` always; `autonomous-ready` if gates passed; `needs-review` if scorer < 9.0 |
| Reviewers | None for `auto/*`; Viktor optional for `enhance/*`                                      |

## Commit author identity

Per INC-2026-05-19-10: every commit pushed via `git push origin main` MUST be authored by an email registered to a GitHub account that has write access to the repo. Vercel rejects unverified emails.

Standard identity used by sandbox + native loop:

```
Author: Viktor <sarminvictor@gmail.com>
Committer: Viktor <sarminvictor@gmail.com>
```

Never commit as `claude@mapsly.ai` or any bot identity to a Vercel-connected repo.

## .gitignore essentials

```
.env*.local
.env.development.local
.env.test.local
.env.production.local
node_modules/
.next/
.vercel/
lib/generated/
tsconfig.tsbuildinfo
_tmp_*
.git-rewrite/
.claude/memory/_test-*
.claude/memory/_probe.*
test-outside-git
test-write-via-tool.txt
```

## Pre-push checks (CI runs these)

1. `pnpm prettier --check .`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm db:generate`
5. `pnpm build` (with stub env vars)
6. `pnpm test:run`
7. `ci-passed` aggregator passes

All seven required. Branch protection (when enabled) makes #7 required for merge.

## Anti-patterns

- ❌ Force-push to `main`
- ❌ Bot identity as committer on a Vercel-connected repo
- ❌ Generic commit messages ("update", "fix stuff")
- ❌ Tagging every patch
- ❌ Missing task ID in autonomous loop commits
- ❌ Skipping `pnpm deploy-check` before push (CI will catch it but wastes a CI run)
