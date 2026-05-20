# Capability routing · capability gaps narrow eligibility, never halt the loop

The autonomous loop runs in multiple environments (real macOS via `/loop`, Cowork sandbox via Desktop Scheduled Task, possibly future cloud runners). Each environment has DIFFERENT capabilities. A capability gap in one environment must NEVER block tasks the loop could ship in a different environment — and crucially, must NEVER block tasks the CURRENT environment CAN ship.

This rule was added in v0.6.5 (INC-30) after v0.6.4 shipped a binary "halt the whole loop for 4h" pattern that froze the queue on a single missing capability.

## The principle

> **A capability gap is a routing constraint, not a halt signal.** It narrows which tasks are eligible — it does not stop the loop.

If the Cowork sandbox can't `unlink()`, that means code-ship tasks (which need `pnpm install`) wait for a `/loop` tick on the Mac. But the sandbox CAN still ship:
- docs / memory / incident-log updates (pure Write via O_TRUNC)
- DB writes via Postgres MCP
- Research tasks (agents that read files + spawn analysis)
- Dashboard data / query tweaks that don't change deps
- `.claude/rules/*` doc additions
- task-tracker work that doesn't recompile the app

That's a meaningful fraction of the queue. Halting all of it because pnpm can't run is a defect.

## Capability vocabulary

The loop probes its env in STEP 0 and sets these flags:

| Flag | Probe | Required by |
|---|---|---|
| `CAN_UNLINK` | `touch + rm` of a probe file in PWD | pnpm install · next build (`.next/` cleanup) · git operations on locked refs |
| `CAN_PNPM_INSTALL` | Derived: CAN_UNLINK + ≥600 MB free disk | tasks tagged `requires:pnpm-install` |
| `CAN_DEPLOY_CHECK` | Derived: CAN_UNLINK (next build cleans `.next/` via unlink) | tasks tagged `requires:deploy-check` |
| `CAN_GIT_PUSH` | Always 1 (via /tmp escape hatch per INC-01) | every task that ships code |

Future capabilities (not yet probed but reserved for the convention):
- `CAN_BROWSER` — Claude in Chrome MCP available and Chrome reachable
- `CAN_EMAIL_TAB` — Gmail tab accessible for magic-link validation
- `CAN_LIGHTHOUSE` — Lighthouse CLI available
- `CAN_VERCEL_DEPLOY` — Vercel CLI authenticated

## Task tagging convention

Tasks declare what they need via `Task.tags` (comma-separated, free-form per existing schema):

| Tag | Meaning |
|---|---|
| `requires:pnpm-install` | Task changes `package.json` / `pnpm-lock.yaml` — must install before validating |
| `requires:deploy-check` | Task changes code that must compile/lint/build (most code-ship tasks) |
| `requires:browser` | Task ships UI that needs preview-URL browser validation |
| `requires:email-tab` | Task touches magic-link / cohort / billing emails (needs Gmail check) |
| `requires:lighthouse` | Task ships a new route or layout (needs Lighthouse mobile pass) |
| `human-required` | (pre-existing) Task can only be merged with human sign-off (e.g. payments cutover) |

Tasks with NO `requires:*` tag are **env-agnostic** — Read/Write/Edit/Bash/Postgres/Agent only. They always run.

## STEP 3 filter logic

```ts
const eligible = candidates.filter((t) => {
  const tags = (t.tags ?? '').split(',').map(s => s.trim());
  const requires = tags.filter(s => s.startsWith('requires:')).map(s => s.slice('requires:'.length));
  
  for (const need of requires) {
    if (need === 'pnpm-install' && !CAN_PNPM_INSTALL) return false;
    if (need === 'deploy-check' && !CAN_DEPLOY_CHECK) return false;
    if (need === 'browser' && !CAN_BROWSER) return false;
    if (need === 'email-tab' && !CAN_EMAIL_TAB) return false;
    if (need === 'lighthouse' && !CAN_LIGHTHOUSE) return false;
  }
  return true;
});

if (eligible.length === 0) {
  // No 4h cooldown! Next tick re-probes — Mac /loop will see CAN_UNLINK=1.
  exit(`no eligible tasks for current capabilities (CAN_UNLINK=${CAN_UNLINK}), idle`);
}
```

## Auto-tagging from failures

If STEP 6 deploy-check fails with EPERM/unlink errors despite `CAN_DEPLOY_CHECK=1` (STEP 0 false-positive), the loop SELF-LEARNS:

1. Mark TaskRun INCOMPLETE with `branchName` + reason `env-incompatible-detected`
2. UPDATE the Task to add `requires:deploy-check` to tags (idempotent — skip if already present)
3. Release Task back to PENDING
4. STEP 3 filter on next iteration will skip it in the same env

The probe and the tags become more accurate over time — failures teach the loop.

## Cooldown discipline

Cooldown is ONLY for these conditions (never for capability gaps):

| Trigger | Cooldown |
|---|---|
| ≥3 consecutive failures of the SAME task | 1h + INC- entry |
| ≥5 consecutive failures across DIFFERENT tasks | 24h + "loop unhealthy" INC- |
| Quota / rate-limit approaching | 4h |
| Anthropic 429 | 4h |
| Capability gap (e.g. CAN_UNLINK=0) | **NEVER** — exit normally, no cooldown |
| Eligible queue empty (deps) | **NEVER** — exit normally, no cooldown |
| Eligible queue empty (capability filter) | **NEVER** — exit normally, no cooldown |

## Dashboard surface

The dashboard's LoopControls card shows the current capability set, so Viktor knows what's eligible from which env. When `CAN_UNLINK=0`, the Notifications card shows an INFO (not WARN) row:
> "Sandbox in degraded mode — code tasks waiting for /loop on Mac. Env-agnostic tasks still shipping."

This is informational, not blocking. The dashboard's "Loop status" tile shows two pills:
- `Cowork: idle · 7 eligible / 24 queued` (degraded)
- `Mac /loop: idle · 24 eligible / 24 queued` (full capabilities)

## Anti-patterns

- ❌ Setting a 4h cooldown because pnpm install can't run in the current env
- ❌ Exiting the iteration without trying the next eligible task after a capability mismatch
- ❌ Treating Cowork sandbox like a broken environment instead of a narrower one
- ❌ Tagging ALL tasks `requires:deploy-check` "just in case" — be specific; docs/memory tasks are env-agnostic
- ❌ Surfacing a capability gap as WARN/CRITICAL — it's INFO

## Cites

- INC-29 (Cowork FUSE unlink wall)
- INC-30 (capability halts must be scoped, never loop-wide)
- `.claude/loop.md` STEP 0 (probe), STEP 1 (advisory flags), STEP 3 (filter), STEP 6 (auto-learn), STEP 10 (cooldown discipline)
