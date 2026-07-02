# Churn, dunning & the permanence promise (WP7-12)

> **Decision doc.** "Paid results are permanent · re-open any for $0" (the research directory's promise) collides with cancellation unless the semantics are defined. This resolves them so the first churned customer doesn't discover the answer in production. **Viktor: confirm the read-only-forever stance + the dunning grace window.**

## The permanence promise survives cancellation

**A canceled/downgraded agency keeps READ-ONLY access to its purchased researches forever.**

- Rationale: the researches are data the agency _already paid credits for_; re-opening them costs Mapsly ~$0 in COGS (they're served from the DB, no external calls). Honoring the promise past cancellation is what makes _future_ credit purchases feel safe — it's a conversion asset, not a cost.
- Read-only = can view/export existing enriched leads, evidence, and drafts; **cannot** spend credits (enrich more, generate touches, run discovery — all already gated to spend-members + a positive balance).

## Dunning (failed payment)

Stripe subscription lifecycle → app behavior (never deletion):

1. **`past_due`** (first failed charge): full access continues through Stripe's retry window (grace). A soft in-app banner: "Payment failed — update your card to keep enriching."
2. **`unpaid` / `canceled`**: drop to **read-only** (same as voluntary cancellation). Plan credits stop granting at the next cycle; purchased/rollover credits remain spendable until used (they were paid for).
3. **Never delete** an agency's researches or contacts on non-payment. Suppression/retention is the WP9-1 sweep's job (age-based, tenant-agnostic), not a churn lever.

## In-flight state at cancellation

- **Held credits** on an open enrichment run: `reconcileRunCredits` refunds the unused hold (existing WP1-3 settle path). Do not strand held credits.
- **Running jobs**: let the current tick's batch complete (they're cheap and already paid via the hold); do not enqueue _new_ work for a canceled agency. The dispatch rail's per-agency gating (WP3-10) + the spend-member gate naturally stop new runs.
- **Scheduled monitors** (WP6-12 timing triggers, WP6-2 digest): stop for read-only agencies (no new spend, and the digest's re-enrich nudge is moot).

## Full-fidelity export (always available)

- At **any** time — active, past-due, or canceled — the agency can export a **full-fidelity JSON** of its researches: businesses + signals + evidence + `whyJson` + contacts (not just the 13-column CSV). Reuse the WP2-4 rich-CSV row model + the WP4-4 server export route; add a JSON variant.
- Why: (a) it's the single best answer to enterprise-ish procurement lock-in objections ("you can leave with everything you paid for"), and (b) it's CCPA-adjacent data-portability hygiene (pairs with WP7-2 opt-out).

## Implementation notes (mostly already-present rails)

- Read-only enforcement = the existing spend-member + balance gates already block all credit-spending actions; add a plan/status check so a `canceled`-status agency's UI hides spend CTAs and shows the read-only banner. (Stripe status already stored on `Agency.stripeStatus`.)
- No new schema. The JSON export is a new route variant of the WP4-4 export.
- The grace/read-only transitions are driven off the existing Stripe webhook (`Agency.stripeStatus` writes) — no new billing infra.

## Anti-patterns

- ❌ Deleting researches on cancellation (breaks the permanence promise → tweet-worthy betrayal).
- ❌ Stranding held credits at cancel (refund them).
- ❌ CSV-only export at offboarding (must be full-fidelity JSON — the lock-in answer).
- ❌ Letting a past-due agency spend plan credits it hasn't paid for this cycle (purchased/rollover credits are fine — those were paid).
