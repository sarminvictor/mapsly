# Versioning · every merge bumps the patch

> **OVERRIDE · 2026-07-02.** Version bumps happen inside approved `/ship` pushes — never as standalone autonomous commits.
> The auto-merge bump discipline below applies only to a re-enabled loop with `pushPolicy: auto`.
> Standing rule: no commit/push without Viktor's approval.

Every successful auto-merge to main bumps `package.json` version. This is how Viktor sees what's live without checking commit SHAs.

## Schema

`MAJOR.MINOR.PATCH` (semver-ish):

- **MAJOR** — bumped only at user-visible launches (1.0 = product launch, 2.0 = redesign). Manual.
- **MINOR** — bumped at the end of each PLAN.md Phase (1.x → 2.0 when Phase 1 closes; 2.x → 3.0 when Phase 2 closes). The loop bumps this when it ships the last task in a phase.
- **PATCH** — bumped on every successful auto-merge. The loop handles this in the merge commit.

## Where it shows up

- `dev.mapsly.ai` header pill — `v0.2.7`
- `mapsly.ai` footer (anonymous + signed-in) — quietly, small text
- GitHub release notes — auto-generated from commits between version tags
- Sentry release identifier — for error grouping by version

## Loop discipline

On every successful auto-merge:

1. Read current `package.json` version
2. Increment patch: `0.2.0` → `0.2.1`
3. If this PR closes the last task in a PLAN.md phase, increment MINOR instead and reset PATCH: `0.2.7` → `0.3.0`
4. Write the new version into the merge commit OR push as a follow-up commit `chore(version): bump to vX.Y.Z`
5. Tag the commit: `git tag vX.Y.Z && git push origin vX.Y.Z`

## Vercel propagation

Vercel sets `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF` as env vars. The dashboard reads `package.json#version` (via JSON import) so it always reflects the source-of-truth version in the deployed bundle — no env var sync needed.

## Anti-patterns

- ❌ Manually editing `version` and forgetting to push (out of sync with main)
- ❌ Bumping MINOR on a tiny commit (reserve for phase boundaries)
- ❌ Skipping the bump because "it's just a doc change" — bump anyway, makes the dashboard's "what's live" honest
