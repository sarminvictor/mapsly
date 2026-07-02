# Universal Claude Code layer · install bundle

Plain English, for Viktor. This folder is a **reviewable bundle** — nothing in it
does anything until you run the installer. Read it, then install when you're happy.

## What this is

One shared "how I work" layer for ALL your products (Mapsly, Boxly, and whatever
comes next), instead of re-teaching each repo separately:

- **`home/CLAUDE.md`** → becomes `~/.claude/CLAUDE.md`. The universal rules every
  session loads: engineering baseline, orchestrator protocol, the no-push-without-
  approval policy, the incident contract, and the product-manifest convention.
- **`home/hooks/git-gate.sh`** → a hard gate that BLOCKS `git push` at the tool
  level unless you approved it via `/ship` in the last 30 minutes. This turns your
  "no commit without approval" preference from a promise into a mechanism.
- **`home/settings-merge.py`** → adds three things to `~/.claude/settings.json`:
  ask-before-`git push`, deny edits to `.env*` files, and the git-gate hook. It
  backs the file up first and never duplicates entries on re-run.
- **`templates/`** → blank `product.md` / `product-spec.json` / `guardrails.json`
  you copy into each product repo's `.claude/` so universal agents know that
  product's voice, budgets, and remotes without hardcoding anything.
- **`home/agents|skills|rule-packs/`** (if present) → shared agents, the `/ship`
  skill, and stack-level rule packs installed for every project.

## Install — one command

```bash
bash /Users/Viktor/Documents/Claude/Projects/mapsly/.claude/universal/install.sh
```

Safe to re-run any time (updates in place, backs up before overwriting).

## What changes after install

1. `~/.claude/CLAUDE.md` exists (your old one, if any, is backed up as
   `CLAUDE.md.bak-<timestamp>`).
2. `git push` from any Claude session is blocked unless you say yes — the sanctioned
   path is `/ship`, which asks, marks approval, and pushes. Pushing to GitLab `main`
   is a production deploy, so this gate is the whole point.
3. Claude can no longer edit `.env*` files directly (deny rule) — it will ask you
   to make those changes yourself.
4. `~/.claude/settings.json` gains those entries; a backup copy
   `settings.json.bak-<pid>` sits next to it.
5. Then restart Claude Code so everything loads.

## Uninstall

1. Restore `~/.claude/CLAUDE.md` from the newest `CLAUDE.md.bak-*` (or delete it).
2. Restore `~/.claude/settings.json` from `settings.json.bak-<pid>` (or hand-remove
   the `Bash(git push:*)` ask entry, the four `.env*` deny entries, and the
   PreToolUse hook pointing at `git-gate.sh`).
3. Delete `~/.claude/hooks/git-gate.sh` and any agents/skills/rule-packs/templates
   you don't want.
4. Restart Claude Code.

## Security note · DataForSEO credentials

Your plaintext `DATAFORSEO_*` username/password currently live in `~/.zshrc`, which
means every shell (and every tool that reads your environment) sees them. Move them
into each project's `.env.local` (gitignored) instead, and remove the export lines
from `~/.zshrc`. Same rule for any other API secret that's sitting in shell config:
project `.env.local` files, not global shell environment.
