---
name: rollback
description: Emergency production revert. Use when the owner says "roll back", "revert prod", or a bad deploy is live. Identifies the culprit commit on the deploy branch, shows what a revert undoes, then ships the revert through /ship's approval flow.
---

# Rollback

Production deploys from the deploy branch of the primary remote. A rollback is a **new revert commit** shipped through the normal approval flow — never a force-push, never history rewriting.

## Steps

1. **Read config.** `.claude/product-spec.json` → `repo.primaryRemote`, `repo.deployBranch`.
2. **Fetch + identify the culprit.** `git fetch <primaryRemote>`, then `git log <primaryRemote>/<deployBranch> --oneline -10`. Default candidate = the most recent commit (or merge). If the owner named a specific change, find that commit instead and confirm the SHA with them.
3. **Show what the revert undoes.** `git show --stat <sha>` + plain-English summary: which features/fixes disappear from production, which files change back. If the commit touches DB migrations, STOP and flag it — reverting code does not un-migrate a database; that needs a manual plan first.
4. **Prepare the revert locally.** On the deploy branch: `git revert --no-commit <sha>` (`-m 1` for merge commits). Show the resulting diffstat. If the revert conflicts, show the conflicts and ask before resolving anything.
5. **Ship via /ship.** The revert goes through the exact same gate: deploy-gate run, explicit AskUserQuestion confirmation, approval sentinel, conventional commit (`revert: <original subject>`), push to the primary remote. No shortcut for emergencies — the gate takes a minute; a wrong revert costs an hour.
6. **Verify.** Report deploy status. Tell the owner exactly what to check in the browser to confirm the bad behavior is gone (the owner tests UI manually).
7. **Log it.** Run /incident for whatever made the rollback necessary.

## Anti-patterns

- ❌ `git push --force` or `git reset --hard` on the deploy branch — revert commits only
- ❌ Skipping the approval flow because "it's an emergency"
- ❌ Reverting a commit that includes a migration without a DB plan
- ❌ Operating on the mirror remote — the primary is the source of truth
- ❌ Reverting more than asked ("while I'm here…")
- ❌ Forgetting the /incident entry afterwards
