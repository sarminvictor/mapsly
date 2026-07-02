---
name: ship
description: The ONLY sanctioned push path. Use when the owner says "ship it", "push", "deploy", or approves changes for production. Shows the diff, runs the deploy gate, asks explicit confirmation, then commits + pushes to the primary remote.
---

# Ship

Pushing to the deploy branch = production deploy. Nothing reaches the remote except through this flow. Standing rule: no push without explicit approval.

## Steps

1. **Read config.** `.claude/product-spec.json` → `repo.primaryRemote`, `repo.deployBranch`, `repo.pushPolicy`, `deployGate`. Missing file → stop and say so. `pushPolicy: "propose-and-wait"` (the default) makes step 4 a hard requirement; `"auto"` is reserved for autonomous-loop contexts and never applies to an interactive session.
2. **Show what would ship.** `git status --short` + `git diff --stat` (staged and unstaged) + one plain-English line per changed file. Include untracked files.
3. **Run the deploy gate.** Invoke /deploy-gate (runs the `deployGate` command). Show the result. On fail: STOP — report the failing step, leave everything uncommitted.
4. **Ask for explicit confirmation** via AskUserQuestion. State exactly: which files/commits, which remote + branch, and that this deploys to production. Options: "Ship it" / "Not yet".
5. **On yes:**
   - `touch /tmp/claude-ship-approved` — the sentinel the git-gate hook checks (see below)
   - Commit with a conventional message (`feat:`/`fix:`/`chore:` + scope, one concern)
   - If the project bumps versions per-merge (a versioning rule exists), bump `package.json` patch in the same commit
   - `git push <primaryRemote> <deployBranch>` — the mirror propagates automatically via dual push-URLs; never push to the mirror directly
6. **Report.** Deploy status/URL (Vercel MCP or CLI if available; otherwise say where to watch) + the new version number.

## On "Not yet"

Stop immediately. Leave the working tree exactly as it is — uncommitted. Don't stash, don't commit "for later", don't re-ask.

## Git-gate hook relationship

A PreToolUse hook blocks `git commit` / `git push` unless `/tmp/claude-ship-approved` exists — created only in step 5, only after explicit approval, and consumed/removed by the hook or on session end. The sentinel is the mechanical enforcement of "no push without approval". If a push is blocked and the sentinel is missing, that is the system working — never touch the sentinel outside this skill and never route around the hook.

## Anti-patterns

- ❌ `git push` from anywhere except this skill
- ❌ Committing before the gate passes
- ❌ Asking for approval without showing the diffstat first
- ❌ Force-push, ever
- ❌ Touching `/tmp/claude-ship-approved` preemptively "to save a step"
- ❌ Pushing to the mirror remote directly
