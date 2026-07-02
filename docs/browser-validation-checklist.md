# Browser-validation checklist (pre-merge, manual)

> The autonomous loop verifies at the code level (typecheck / build / tests /
> diff-vs-prototype). This is the **manual browser pass** Viktor runs before the
> `feat/mvp-10of10` merge — the "would a real user's first impression work?"
> check the code gates can't cover. Per `.claude/rules/browser-testing.md`.

## How to run

`pnpm dev`, then walk each surface below as the listed user type. Watch the
console for JS errors and the network tab for 4xx/5xx on every screen.

## Desktop pass (1280×800)

- [ ] **Get-leads flow** (Goal → Market → Preview → Enriching) runs end-to-end
      as a signed-in agency owner; no console errors; costbar swaps
      "Mapping…" → "Enrich →" when the market maps.
- [ ] **Workbench** — table sorts by clicking a header, bulk-select + set status
      is optimistic, ⌘K opens and jumps to a lead, the drawer opens/closes
      (Escape), prev/next walk works.
- [ ] **Proof Pack** (`/discover/…/business/…/report`) — provenance footer
      present, "Download PDF" prints, no raw review text anywhere.
- [ ] **Share page** (`/s/[token]`) — renders "Prepared by {Agency} · powered by
      Mapsly", no-indexed, provenance footer present.

## Mobile / 380px pass (WP7-11 · the two on-phone moments)

Resize the viewport to **380px** (or Chrome device toolbar → 375px) and confirm
**no horizontal scroll** on:

- [ ] **Enriching step** — hero count, progress card (bar + N-of-M + ETA + the
      "what's running" checklist), and the **"continue on desktop" handoff note**
      (visible only ≤640px) all fit; the editorial card doesn't overflow.
- [ ] **Run-finished email landing** — the workbench deep-link the run-finished
      email (WP6-3) opens renders without h-scroll; the desktop-handoff note
      appears; the page is usable as a glance.
- [ ] **Weekly-digest email landing** — the "My research" deep-link the digest
      (WP6-2) opens renders without h-scroll.
- [ ] The **run-finished + digest emails themselves** render single-column at
      560px max in an email client (Gmail mobile) — no fixed-width h-scroll.

Note: the dense workbench is desktop-first by design (`ui-ux-agency.md`) — it is
NOT expected to be a full mobile workflow. The mobile pass only covers the two
glance moments above; the handoff note routes phone users to a computer.

## Accessibility pass

- [ ] The **hermetic axe test** is green in CI
      (`modules/agency-portal/discover/__tests__/a11y-workbench.test.tsx`).
- [ ] Manual: Tab through the workbench — every sort header is a focusable
      button with a visible focus ring; the drawer traps focus and returns it on
      close; the ⌘K palette is keyboard-driven.
- [ ] **Lighthouse mobile** on the workbench + a marketing page: Performance ≥ 90,
      Accessibility ≥ 95 (contrast + focus-order can't be checked headless — this
      pass is where they're verified).
- [ ] Status pills read their status text (not colour alone); confidence pills
      carry a text confidence level; the reachable cell shows "Yes"/"No".

## Security pass (WP8-4 · flip CSP to enforce)

- [ ] Load every surface with devtools open; confirm **no CSP violations** are
      reported (the header ships **Report-Only** today).
- [ ] Once a clean pass: flip `CSP_HEADER_NAME` in `middleware.ts` from
      `Content-Security-Policy-Report-Only` to `Content-Security-Policy` to
      **enforce** it, then re-run this pass to confirm nothing breaks.

## Compliance / evidence pass

- [ ] A shared **Proof Pack** and **/s/[token]** page carry the provenance line +
      retrieved-date (WP7-1) and the exposure-framed findings (WP7-3 — never
      "violates").
- [ ] **Dispute a finding** in the drawer ("dispute this finding") → it
      disappears from the drawer and no longer appears in the CSV export (WP7-3).
- [ ] **Report wrong contact** → the contact is hidden and a refund toast shows
      (WP6-13).
