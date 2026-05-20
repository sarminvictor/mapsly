# Build log · append-only

Every autonomous session writes one entry at close-time. Most recent at top.

Schema per entry:

```
## SES-YYYY-MM-DD-N

- Started: ISO
- Ended: ISO
- Exit: token-budget | timeout | hard-halt | clean
- Tasks completed: list of phase IDs
- PRs opened: numbers + status
- PRs auto-merged: numbers
- PRs needs-review: numbers
- Incidents new: list of INC- IDs
- Incidents recurring: list of INC- IDs cited
- Score average: X.X
- Cost USD: X.XX
- Tokens used: input / output / total
```

---

(no sessions yet — first scheduled run will create the first entry)

---

## SES-2026-05-19-supervisor-blocked · 2026-05-19 23:45 UTC

**Type:** supervisor tick (scheduled · 5-min fire)
**Outcome:** aborted — host-side recovery required
**Cooldown set:** 24h (until 2026-05-20 23:45 UTC)

**What happened:**

- Tick opened the working tree at `/sessions/busy-peaceful-dirac/mnt/mapsly` and found `git status` reporting "No commits yet" on local main, plus leftover `.git-rewrite/`, `.git/index.lock`, and `_tmp_3_*` from a prior crashed session.
- Confirmed `origin/main` is healthy (HEAD = `37fef34 feat: v0.2.0 · version bumping · cron aggregate · enhance-signals · browser-testing rule`) — local working tree files match it.
- Switched the remote from SSH to HTTPS+token (the sandbox has no SSH known_hosts entry for github.com).
- Attempted INC-01's `GIT_DIR=/tmp/<scratch>` workaround. `git fetch origin main` succeeded; `git reset --hard origin/main` aborted with `error: unable to unlink old 'tsconfig.json': Operation not permitted`.
- Verified via `python3 os.unlink()` that the FUSE mount blocks `unlink()` syscall universally — even on a 0-byte file the sandbox itself just created. `mount` confirms `fuse (rw,nosuid,nodev,default_permissions,allow_other)` with `user_id=0,group_id=0` — the policy is FUSE-layer, not POSIX.
- New incident logged: **INC-2026-05-19-14** with full diagnosis and host-side recovery recipe.

**Blocker for Viktor (host-side macOS Terminal):**

```bash
cd ~/Documents/Claude/Projects/mapsly
rm -rf .git-rewrite/ _tmp_3_* .claude/memory/_test-tick.txt
rm -f .git/index.lock
git fetch origin main
git reset --hard origin/main
```

**Leftover garbage this tick created (can only be removed by Viktor):**

- `.claude/memory/_test-tick.txt` — 15 bytes, created while probing the unlink restriction.

**Prevention shipped:**

- INC-2026-05-19-14 records the FUSE-blocks-unlink mechanism and prescribes a supervisor pre-flight check that hard-halts on `git status`-reports-unborn-HEAD or `.git-rewrite/` presence — so future ticks won't burn cycles or leave more garbage. The pre-flight check itself still needs to be encoded into `.claude/skills/autonomous-build-loop/SKILL.md`; that edit is part of the host-side recovery work (it requires unlink-or-overwrite of the SKILL file, which a future post-recovery session can do cleanly).

**Cooldown rationale:** 24h matches INC-prevention's "loop unhealthy" threshold (`consecutiveFailures ≥ 5` would normally trigger this, but a single tick burning effort on a host-only blocker counts as the same class of unhealthy — no point retrying every 5 min when only host-side action unblocks).

---

## SES-2026-05-20-supervisor-standdown · 2026-05-20 00:04 UTC

**Type:** supervisor tick (Cowork scheduled · 5-min fire)
**Outcome:** stood down silently — native launchd loop now primary

**Pre-flight findings:**

- `loop-lock.json` state = `idle` (Viktor manually reset after host-side recovery + v0.2.2 push).
- HEAD = `9fb42c4` (`chore(version): bump to 0.2.3`), pushed by Viktor at 23:55:30 UTC.
- The commit two before HEAD — `40c54df feat(loop): native macOS install via launchd · escapes Cowork FUSE limits` — ships `scripts/launchd/{install.sh, ai.mapsly.loop.plist, loop-tick.sh, loop-prompt.md}`. The native loop reads the same `.claude/memory/loop-lock.json` from the host filesystem and has full unlink access. It supersedes this Cowork supervisor.
- FUSE-blocks-unlink (INC-2026-05-19-14) is STILL active in this sandbox. Verified two ways:
  1. Create+write a probe file under `.claude/memory/_probe.txt`, then `rm` → `Operation not permitted`.
  2. `git pull --ff-only` succeeded ("Already up to date") but emitted `warning: unable to unlink '.git/ORIG_HEAD.lock': Operation not permitted` — git itself leaks `.lock` files on every operation that touches HEAD.
- `.git/index.lock` (0 bytes, leaked from a prior tick) and `.git/ORIG_HEAD.lock` (0 bytes, just leaked) are present. INC-14's prevention rule says: in this state, the supervisor must NOT attempt any working-tree-mutating git command — they burn ticks and leave garbage.

**Decision tree applied:**

1. The traditional 24h-cooldown response (per INC-14) would write `loop-lock.json` with `cooldownUntil = now + 24h`. **Rejected** — both loops share that lock file. A 24h cooldown set by this defunct tick would silence the new native loop too, which is precisely the opposite of what Viktor just shipped v0.2.3 to enable.
2. Best-effort `git commit + push` of any change would leak more `.lock` files.
3. **Chosen path:** leave `loop-lock.json` alone (preserves `idle` so the next native launchd tick proceeds), append this build-log note in-place via bash `>>` (no unlink, no git commit), exit silently.

**Net effect:** every Cowork supervisor tick will spend ~30s reading state, confirm FUSE-blocked, and exit silently with this same standdown reasoning until Viktor disables the Cowork scheduled task. The native macOS launchd loop is unimpeded.

**Action items for Viktor (host-side, non-urgent):**

1. If not yet installed: `bash ~/Documents/Claude/Projects/mapsly/scripts/launchd/install.sh` to enable the native launchd loop.
2. Disable this Cowork scheduled task from the Cowork app so it stops firing every 5 min. Each Cowork tick leaves 1–2 zero-byte `.git/*.lock` files behind that only host-side cleanup can remove.
3. Optional cleanup of accumulated sandbox litter:
   ```bash
   cd ~/Documents/Claude/Projects/mapsly
   rm -f .claude/memory/_probe.txt .git/index.lock .git/ORIG_HEAD.lock
   rm -f test-outside-git test-write-via-tool.txt
   ```

**Litter created this tick (cannot self-clean):**

- `.claude/memory/_probe.txt` (6 bytes)
- `.git/ORIG_HEAD.lock` (0 bytes)

**Prevention shipped:** none new — the native launchd loop IS the prevention, and it's already on main as of commit `40c54df`.
