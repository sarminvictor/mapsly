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
