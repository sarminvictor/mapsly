### Task G.1 · Stripe checkout · subscription create (PR pending merge · branch auto/2026-05-21-G.1-1)

Date: 2026-05-21 · Scorer: scorer agent · Verdict: **MERGE** (no REJECT verdicts; security HIGH findings mitigated in fix commit)

| Dimension    | Score | Justification                                                                                          |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------ |
| Completion   | 9     | All G.1 deliverables shipped: schema migration (User.stripeCustomerId UNIQUE + stripeSubscriptionId), checkout route handler, lazy Stripe client (INC-07 mirror), Zod-gated body, 26 unit tests, return-URL allow-list, role gate for agency. Missing only Idempotency-Key (acceptable for v1; tracked as follow-up). |
| Quality      | 8     | code-reviewer 9 + payments-auditor 8 + security 8.5 → median 8. Clean module/route boundary, honest INC-37 error logging, lazy-proxy mirrors lib/prisma.ts. Idempotency gap on customer + session create is the dominant quality debt; minor style nits (redundant cast, http: allowed). |
| Audience-fit | 7     | N/A — backend infrastructure · default-credit per scorer convention. No SMB/Agency UX surface in this task. |
| Relevance    | 10    | Unblocks G.2 (webhook), G.3 (customer portal), G.4 (lifecycle). Foundational billing — every paid tier (Solo/Growth/Pro/Boutique + SMB $29) depends on it. Highest possible criticality. |
| Performance  | 9     | Bounded `select`, no N+1, Stripe create OUTSIDE Prisma transaction, lazy Stripe client (zero module-load cost), no PPR conflict (POST mutation), indexes verified. Expected p50 400-800ms is Stripe-bound (acceptable per cost-discipline.md — no live-API-in-user-path concern as this IS the user path for checkout init). |

**Aggregate:** (9 + 8 + 7 + 10 + 9) / 5 = **8.6**

**Recommendation:** MERGE. No critical reviewer veto; all HIGH security findings mitigated in fix commit; payments WARN is operational debt, not a blocker.

**Follow-up tasks** (do NOT block G.1):
  1. Add `Idempotency-Key` header to Stripe customer + session create calls (payments-auditor LOW × 2) — prevents orphan Customer rows + double-session on double-click
  2. Multi-agency `agencyId` param + ownership re-check (security INFO + payments-auditor) — currently assumes 1 agency per user
  3. CSRF Origin header verification (security WARN, v1 follow-up — NextAuth SameSite=lax mitigates short-term)
  4. Stripe webhook handler with metadata-driven idempotency (task G.2)
  5. Replace blanket `*.vercel.app` return-URL allow with specific preview-deploy hostname pattern (payments-auditor LOW)
  6. Execute the 19 security tests in CI (security-auditor WARN — verified by inspection only in sandbox)
  7. Race-condition harden on ensureUserCustomer/ensureAgencyCustomer (payments-auditor LOW)

