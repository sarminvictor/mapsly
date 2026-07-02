# Loop discipline · canonical rule for the 11 loop-tagged INCs

The autonomous build loop is the highest-leverage system in the codebase: every other rule is enforced once per PR, but the loop's STEP 0 runs every 5 minutes. The 11 incidents tagged `loop` (and the closely-related `cowork`/`/tmp`/`sandbox`/`capability-routing` clusters that all SUPERSEDE older arch) cluster into 6 mechanical disciplines.

This rule covers WHAT the loop must always honor; the actual loop body lives in `.claude/loop.md` (the per-iteration prompt) and `.claude/skills/autonomous-build-loop/SKILL.md` (the agent-facing implementation guide).

## 1 · Run from a FUSE-free working directory (INC-29, INC-31, INC-33, INC-34)

The Cowork sandbox mounts the user's project via a FUSE layer that blocks `unlink()`. This breaks `git fetch` ref promotion, `pnpm install` atomic rename, and `next build` cleanup. The loop NEVER runs from the FUSE mount when `IS_SANDBOX=1`.

```bash
case "$PWD" in
  */sessions/*|*/mnt/*) IS_SANDBOX=1 ;;
  *) IS_SANDBOX=0 ;;
esac

if [ "$IS_SANDBOX" = "1" ]; then
  WORK_DIR=/tmp/mapsly-work     # sandbox-writable, no FUSE wall
else
  WORK_DIR="$PWD"               # real macOS, mount IS writable
fi
```

Encoded in `.claude/loop.md` STEP 0a/0b. **Mechanical check (per tick):** `[step-0]` log line emits `WORK_DIR=$WORK_DIR · HEAD=$(git rev-parse --short HEAD)`. Dashboard auto-enhance signal fires if WORK_DIR is missing or HEAD doesn't match origin/main.

## 2 · /tmp GC before bootstrap (INC-33)

`/tmp` in the sandbox is shared across ticks (NOT per-tick ephemeral). Every tick leaves ~50–500 MB behind. ~30 ticks → 100% disk → `useradd` fails → loop dies. STEP 0a.1 GCs orphans before any new work.

- Standard: `find /tmp/mapsly-* -mmin +30 -exec rm -rf {} +` plus targeted `rm -rf` of known one-off tool dirs.
- Disk-pressure (free < 1 GB): also nuke `/tmp/.pnpm-store`, `/tmp/.npm`, every `/tmp/mapsly-*` except canonical work-dir, prior `node_modules` trees older than 5 min.

Encoded in `.claude/loop.md` STEP 0a.1. **Mechanical check:** every tick logs `[step-0] /tmp GC freed N MB · /tmp now M MB free`. Process-enhancer flags `M < 500` as warning, `M < 100` as critical.

## 3 · Sticky toolchain at canonical paths (INC-33)

`pnpm`, `gh`, `node24` install ONCE per sandbox lifetime to `/tmp/node24` and `/tmp/npm-global`. PATH-extending shell exports make them visible to all subsequent bash calls. Persistent toolchain installs go to canonical paths; ephemeral per-tick artifacts go to `/tmp/mapsly-work` (refreshed via `git reset --hard`, not re-cloned).

**Anti-pattern (INC-33 root cause):** a tick installs prettier/pnpm/gh into a unique-named dir (`/tmp/prettier-check`, `/tmp/lock-gen`, etc.). NEW unique-named install dirs in subsequent INCs = the STEP 0a.1 GC list MUST extend to cover them.

## 4 · Capability gaps narrow eligibility, never halt the loop (INC-30)

Removed in v0.6.5+: the v0.6.4 binary "halt the whole queue for 4h" pattern. Replaced with a capability-aware filter (`.claude/skills/autonomous-build-loop/rules/capability-routing.md`).

Cooldown is reserved for CATASTROPHIC failures, never for capability gaps:

| Trigger                                        | Cooldown                                        |
| ---------------------------------------------- | ----------------------------------------------- |
| ≥3 consecutive failures of the SAME task       | 1h + INC- entry                                 |
| ≥5 consecutive failures across DIFFERENT tasks | 24h + "loop unhealthy" INC-                     |
| Quota / rate-limit approaching                 | 4h                                              |
| Anthropic 429                                  | 4h                                              |
| Capability gap (e.g. `CAN_UNLINK=0`)           | **NEVER** — exit normally, no cooldown          |
| Eligible queue empty (deps or capability)      | **NEVER** — exit normally, no cooldown          |
| Sandbox host disk exhausted (`useradd` fails)  | **NEVER** — graceful skip, NO cooldown (INC-34) |

Encoded in `.claude/loop.md` STEP 1 + STEP 10. **Mechanical check:** any `loop-lock.cooldownUntil` set in response to a capability gap = defect against this rule + INC-30 / INC-34.

## 5 · Auto-merge is the DEFAULT, not the exception (INC-22-era pivot)

When CI green AND deploy-check pass AND no critical reviewer veto AND no new Sentry errors AND Task NOT tagged `human-required` → **auto-merge to main**. The scorer's aggregate is informational (logged for DORA trends), NOT a merge gate.

PRs only stay at `needs-review` for:

- Explicit `human-required` tag (payments cutover, major schema migration)
- Hard reviewer vetos (security-auditor REJECT, payments-auditor REJECT)

Viktor reviews already-shipped code via `dev.mapsly.ai` + daily GitHub digest, NOT per-PR diff. Encoded in `.claude/loop.md` STEP 7.

## 6 · Only SUCCESS or INCOMPLETE outcomes (INC-22-era pivot)

PARTIAL is banned. Every TaskRun closes with exactly one of:

- `SUCCESS` — merged to main (the default desired outcome)
- `INCOMPLETE` — ran out of work/time/quota; next iteration resumes via STEP 3 INCOMPLETE-resume path with the branch preserved
- `FAILED` (rare) — catastrophic error that prevents retry

If you find yourself wanting PARTIAL, you actually want INCOMPLETE — the iteration didn't finish, fix in the next tick. Encoded in `.claude/loop.md` STEP 8.

## 7 · Resume INCOMPLETE work, never restart (INC-19/20 supersession + INC-31)

Before claiming a new task, STEP 3 checks for a prior INCOMPLETE TaskRun on the candidate task with a `branchName`. If found, the iteration RESUMES that branch (`git checkout branchName`) — does NOT start from scratch.

This pattern survives quota exhaustion, CI flakes, sandbox crashes — every interruption picks up where the prior session stopped. Encoded in `.claude/loop.md` STEP 3.

## 8 · Resolve stale dashboard Notifications on SUCCESS (v0.6.26)

STEP 8 close-out marks any unresolved WARN-level Notification matching `'%loop stalled%'` / `'%switch to /loop%'` / `'%cowork sandbox cannot install%'` / `'%fuse wall%'` / `'%loop in degraded mode%'` as RESOLVED on every SUCCESS. Prevents the dashboard's Blockers card from showing v0.6.4-era misleading entries.

```sql
UPDATE "Notification"
SET "resolvedAt" = now()
WHERE "resolvedAt" IS NULL
  AND level = 'WARN'
  AND (title ILIKE '%loop stalled%' OR title ILIKE '%switch to /loop%' OR ...);
```

Encoded in `.claude/loop.md` STEP 8.

## Anti-patterns (block at review)

- ❌ Loop running from `/sessions/*/mnt/*` working directory (INC-29, INC-31)
- ❌ STEP 0 missing `[step-0] /tmp now M MB free` telemetry (INC-33)
- ❌ Unique-named install dirs in `/tmp/<tool>-<random>/` (INC-33)
- ❌ Setting `cooldownUntil` for a capability gap (INC-30, INC-34)
- ❌ Closing a TaskRun as PARTIAL (banned by INC-22-era pivot)
- ❌ Restarting an INCOMPLETE task instead of resuming its branch
- ❌ `needs-review` label set on a non-`human-required` PR with green CI (auto-merge missed)
- ❌ Stale WARN Notification surviving a successful tick (INC-26 prevention regressed)

## Cites

INC-16 (model pin), 18 (honest quota), 19/20 (claim discipline · SUPERSEDED by INC-31), 22 (scheduler pivot · SUPERSEDED by INC-31), 28 (sandbox false-positive · SUPERSEDED by INC-31), 29 (FUSE wall · SUPERSEDED by INC-31), 30 (capability routing), 31 (Cowork-canonical /tmp), 33 (/tmp orphans), 34 (host disk exhaustion).

## See also

- `.claude/loop.md` — the per-iteration prompt (the loop body)
- `.claude/skills/autonomous-build-loop/SKILL.md` — agent-facing implementation guide
- `.claude/skills/autonomous-build-loop/rules/capability-routing.md` — capability vocabulary + task-tag convention
- `.claude/skills/autonomous-build-loop/rules/agent-orchestration.md` — concurrency budget + sequencing
- `.claude/rules/incident-prevention.md` — how lessons get written down
