# Pro Max usage tracking · source of truth + approximations

## The reality

**Anthropic does not expose Pro Max plan usage via API.** There is no way to programmatically query "what % of my current session am I at" or "when does my session reset". The canonical source is the Claude.ai web settings page:

→ https://claude.ai/settings/usage

That page shows:

- Current session % used + reset countdown
- Weekly limits (all models, Sonnet-only, Design)
- Daily routine runs (0/15)
- Usage credits CA$ balance

## What our dashboard tracks

The Pro Max usage card on dev.mapsly.ai shows **only what the autonomous loop has consumed via launchd workers**, not your interactive Claude.ai usage:

| Source                                                |          Counted in our card?          |
| ----------------------------------------------------- | :------------------------------------: |
| Autonomous loop sessions (launchd → `claude --print`) | ✓ when the loop writes TokenUsage rows |
| Your interactive chat sessions on claude.ai           |            ✗ never counted             |
| Claude Code CLI sessions you run manually             |            ✗ never counted             |
| Sub-agents the loop spawns                            |       ✓ inherited (same session)       |

The local approximation is useful for **monitoring the autonomous loop's own appetite** but is NOT the real cap. If the loop is consuming 30% of session and your chat usage is 60%, you're actually at 90% real usage — the card will only show the loop's 30%.

## Why no scrape

Scraping claude.ai/settings/usage would require:

- Storing your Anthropic credentials/cookies somewhere
- Maintaining a headless browser session
- Re-authenticating periodically
- Risk of TOS violation

Not worth the complexity. The loop just needs to NOT push too hard, and you keep an eye on claude.ai/settings/usage when you're doing heavy interactive work.

## What the loop does when quota fills

Per `.claude/rules/agent-orchestration.md` § Quota exhaustion recovery and loop-prompt § 9.5:

1. **Inside-session detection**: orchestrator catches approaching-limit warning from Claude itself · marks TaskRun outcome=INCOMPLETE
2. **Wrapper-level detection**: launchd wrapper greps worker output for `rate.?limit|usage.?limit|quota.?exceeded|429` patterns · logs to supervisor log
3. **State preservation**: branch name saved to TaskRun.branchName · Task stays at IN_PROGRESS
4. **Cooldown**: sets cooldownUntil to oldest local TokenUsage + 5h (conservative)
5. **Resume**: next launchd tick after cooldown clears → checks INCOMPLETE TaskRuns → git checkout branch → continues

**The dashboard's local approximation drives the cooldown logic**, but real Anthropic limits trump it. If you exhaust quota interactively, the loop's local count won't know — but next launchd worker will hit the 429 and gracefully INCOMPLETE itself.

## How to keep both worlds aligned

Two strategies, depending on how aggressive you want the loop to be:

### Conservative (recommended)

Edit `.env.local`:

```bash
MAX_PARALLEL_SESSIONS=1
CLAUDE_MODEL=claude-opus-4-7
```

Single worker per tick, no risk of stacking. Check claude.ai/settings/usage daily.

### Aggressive (after first 10 tasks ship cleanly)

```bash
MAX_PARALLEL_SESSIONS=3
```

Three lanes can run concurrently. Loop will INCOMPLETE-recover gracefully when one of them hits the real cap.

## Future · poll-based ground truth

If Anthropic adds a `/v1/usage` endpoint to the API for Pro/Max accounts, we'll wire it into a `mcp__anthropic__get_usage` MCP tool and the card becomes real. Until then: local approximation + claude.ai/settings/usage as truth.
