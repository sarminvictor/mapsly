---
description: WCAG 2.1 AA baseline. Keyboard nav, focus states, ARIA, contrast.
globs: ["app/**/*.tsx", "modules/**/*.tsx", "components/**/*.tsx"]
---

# Accessibility · WCAG 2.1 AA

Every page passes Lighthouse Accessibility ≥ 95. Real users include keyboard-only users, screen-reader users, and users with color-vision differences. Build accordingly.

## Semantic HTML

Use the right element:

- `<button>` for actions, `<a>` for navigation
- `<nav>` for navigation regions, `<main>` for primary content, `<aside>` for sidebars
- `<h1>` once per page, then `<h2>`/`<h3>` in order — no skips
- `<label>` for every form input, `<fieldset>` + `<legend>` for groups
- `<table>` only for tabular data, with `<thead>` + `<tbody>` + `<th scope="col|row">`

## Keyboard

- Every interactive element reachable by Tab
- Focus order matches visual order
- Visible focus ring on EVERY focusable element — don't disable, customize
- `Escape` closes modals/popovers
- Trap focus inside open modals
- Lists with arrow-key navigation where it helps (Hunter filter chips, lead rows)

```tsx
// Visible focus ring — Tailwind utility
className =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
```

Never `outline: none` without a replacement.

## ARIA — use sparingly

ARIA is the **escape hatch**, not the default. Most accessible patterns need no ARIA.

Use when needed:

- `aria-label` on icon-only buttons (no visible text)
- `aria-expanded` on toggles (dropdowns, accordions)
- `aria-current="page"` on the active nav item
- `aria-live="polite"` on status regions (toast container)
- `role="dialog"` + `aria-modal="true"` on modals (with focus trap)
- `aria-describedby` on form fields with help text

Never use:

- `aria-hidden="true"` on focusable elements
- `role="button"` on a `<div>` — use `<button>`
- `aria-required` on inputs — use `required` attribute

## Color + contrast

- Text contrast ≥ 4.5:1 (normal) or 3:1 (large 18pt+)
- UI element contrast ≥ 3:1 (borders, icons, focus rings)
- Don't rely on color alone — pair with icons or text
  - "Red dot" for status → red dot + "Urgent" text or icon
  - Charts use shape/pattern in addition to color

## Forms

- Every input has a `<label>` (visible or `sr-only`)
- Required fields marked with `*` AND `aria-required="true"` AND HTML `required`
- Errors associated to inputs via `aria-describedby` pointing to the error message id
- Field-level errors near the field, summary errors above the form
- Submit on Enter for single-field forms
- Don't auto-focus on page load unless it's a search-as-you-type pattern

## Screen reader optimization

- Provide skip-to-content link at the top
- Decorative images: `alt=""`, descriptive images: `alt="..."`
- SVG icons: `aria-hidden="true"` if decorative, `role="img"` + `aria-label` if meaningful
- Live regions for toast/notification updates: `<div aria-live="polite" aria-atomic="true">`

## Modals + popovers

- Use `<dialog>` element when possible
- Otherwise:
  - `role="dialog"` + `aria-modal="true"`
  - Focus moves into the modal on open
  - Focus trap while open (focus-trap-react or custom)
  - Escape closes
  - Focus returns to the trigger on close

## Responsive + mobile

- Tap targets ≥ 44×44px
- Zoom up to 200% without breakage
- No horizontal scroll at 320px width
- Touch device hover-only patterns get a tap equivalent

## Motion + animation

- Respect `prefers-reduced-motion: reduce`
- No auto-playing video / audio
- Animations < 5s, no flashing > 3Hz
- Provide pause on essential animations

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Specific to Mapsly

- Status pills (New/Contacted/Replied/Won/Lost) — color + label, never color alone
- Score numbers like "6.2/10" — read aloud properly (use `aria-label="6.2 out of 10"`)
- Sparklines + charts — `<svg role="img" aria-label="Reviews per week, trending up">` + a fallback `<table>` in `sr-only`
- KPI tiles — heading element for the metric name so screen readers can scan
- Filter chips — radiogroup/checkbox group semantics
- Lead table — semantic `<table>` with proper headers + caption

## Testing

- `pnpm lighthouse:a11y` in CI (auto via performance-auditor agent)
- Manual: Tab through every interactive route once per release
- Manual: VoiceOver / NVDA pass on dashboard + reviews + list-detail before launch
- `axe-core` integration for any new component

## Anti-patterns

- ❌ `<div onClick={...}>` — use `<button>`
- ❌ Missing alt text on functional images
- ❌ Color-only state indicators
- ❌ Auto-playing carousels / videos
- ❌ Disabled focus rings without replacement
- ❌ Generic placeholder text as label
- ❌ Modal that doesn't trap focus
- ❌ Toast that doesn't announce to screen readers
