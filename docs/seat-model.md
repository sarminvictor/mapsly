# Seat model & multiplayer pricing (WP7-7)

> **Decision doc** for the 4-seat agency persona. Schema support landed in WP0-6 (`Agency.maxSeats`); enforcement + the invite flow ship in **WP5-8**. This doc is the packaging decision those items implement. **Viktor: confirm the seat caps + the flat-not-per-seat stance.**

## Decision: flat plans with seat caps + a pooled wallet (NOT per-seat pricing)

| Plan    | Price   | Seat cap (`maxSeats`) | Wallet                |
| ------- | ------- | --------------------- | --------------------- |
| Free    | $0      | 1                     | pooled (agency-level) |
| Starter | $19/mo  | 2                     | pooled                |
| Growth  | $99/mo  | 5                     | pooled                |
| Scale   | $299/mo | 15                    | pooled                |

**Rationale:**

- **Against per-seat:** per-seat pricing re-creates Apollo's single most-resented dynamic and taxes exactly the collaboration that makes Mapsly sticky (a VA triaging leads, an owner pitching). "Bring your whole team, one price" is a marketable difference.
- **Pooled wallet, always agency-level.** `AgencyWallet` is already keyed `agencyId @unique` (confirmed WP0-6) — there is no per-user wallet and there must never be one. Credits are the agency's, not a seat's.
- **Caps, not metering.** A seat cap is a simple gate at invite time (`AgencyMember` count < `maxSeats ?? planDefault`); no per-seat billing math.

## What a non-owner seat can SEE and DO

- **See:** all of the agency's researches (team-scoped, NOT creator-scoped). A 4-person team works one book of prospects.
- **Do (STAFF):** open/triage leads, change lead status (attributed — see below), generate/edit touchpoints, export.
- **Restricted to OWNER/ADMIN:** billing, plan changes, and **any credit-spending action** (enqueue enrichment, top-up). This protects the shared wallet — WP5-8 gates `runEnrichAction`/checkout on role.

## Per-member attribution

Lead status changes record `changedByUserId` so the pill history shows "Contacted by Sam" — the first collaboration pain in a 4-person team is stepping on each other's outreach. (WP5-8 adds the column read; the status action already runs authenticated.)

## Invite flow (WP5-8)

Email invite → magic-link → on accept, create `AgencyMember(role)` if `count < maxSeats`, else "seat limit reached — upgrade". Reuses the existing magic-link auth (`lib/auth`) and the `?audience=agency` provisioning path (WP2-1) — an invited user joins the _inviting_ agency instead of provisioning a new one.

## Ship order (WP5-8)

1. Seat-cap enforcement at invite + the invite/accept flow.
2. Role gate on spend actions (OWNER/ADMIN only).
3. `changedByUserId` attribution on status changes.
4. Defer: granular per-permission roles, seat add-ons, SSO — post-MVP.

## Anti-patterns

- ❌ Per-user credit wallets (breaks the pooled model, un-migratable later).
- ❌ Per-seat pricing (Apollo's mistake).
- ❌ Creator-scoped research visibility (a team can't collaborate).
- ❌ Letting STAFF spend agency credits without an OWNER/ADMIN gate.
