# Portal prototype gap — per-area detail

_Generated from the gap-analysis workflow. Per-area buildSpecs that drive the rebuild._

## design-system — DIVERGENT (~22h)

**Prototype:** docs/portal-prototype.html lines 13–6608 define a complete, self-contained agency design system. It MUST be the foundation every agency screen builds on.

TOKENS (:root, lines 14–80):

- Base/atmosphere: --bg #f4f5fb, --surface #fff, --surface-2 #fafbff, --ink #0f172a, --ink-2 #3a4660, --muted #64708c, --faint #97a1bb, --line #e6e9f3, --line-2 #eef1f8.
- Primary indigo: --indigo #5b3df5, --indigo-50 #eeebff, --indigo-100 #ddd7ff, --indigo-700 #4226c9.
- BRAND PUNCH yellow: --yellow #f2e94e, --yellow-ink #6b6406, --yellow-50 #fdfbd6, --yellow-soft #fbf6a8.
- Brand secondary mint: --mint #caecec, --mint-50 #edf7f7, --mint-ink #1d4d4d.
- Warm secondary coral (loss/risk/chose-competitor): --coral #b96562, --coral-50 #faecec, --coral-100 #f3d3d2.
- Status: --green #0f9d6b/--green-50 #e6f8ef, --amber #b7791f/--amber-50 #fdf4e3, --red #dc2626/--red-50 #fdeaea.
- Geometry: --radius 18px, --radius-sm 12px. Shadows: --shadow (0 1px 2px rgba(15,23,42,.04), 0 12px 34px rgba(40,30,90,.07)), --shadow-sm (0 1px 2px rgba(15,23,42,.05)), --shadow-lg (0 24px 64px rgba(40,30,90,.14)).
- --mesh: 4-stop editorial gradient (indigo top-left, teal top-right, yellow bottom, linear #f7f8ff→#f2f4fc) used on framing surfaces.

FONTS (lines 7–12, 74–79): loaded from Google Fonts — Space Grotesk (400/500/600/700), Inter (400/500/600/700), JetBrains Mono (400/500/600). Token mapping: --font = Inter (body, 14px base, letter-spacing -0.005em); --display = "Space Grotesk" (ALL h1/h2/h3, hero numbers, stat values, gauge value); --mono = "JetBrains Mono" (wallet, match score, meta lines, status pills, tnum figures). h1 = Space Grotesk 32px/1.08 -0.018em 600; h2 = 19px 600; h3 = 600; .sub = 15px muted; .eyebrow = 11.5px 700 uppercase 0.1em indigo.

CORE COMPONENT CLASSES (must exist as reusable styles):

- App shell (126–353): .app grid 66px|1fr expanding to 232px|1fr via .side.expanded; .side = DARK rail #0d1020 with indigo+yellow radial mesh, collapsible icon-rail; .brand = Space Grotesk 20px white with circular logomark; .nav button = 13.5px 600, .active = indigo gradient (135deg #5b3df5→#7a5bff) with inset 3px yellow bar; .railtoggle, .research select.
- Topbar (354–424): 60px, frosted rgba(250,250,255,.72) + backdrop-blur(14px), sticky; .crumbs breadcrumbs; .wallet = white pill 999px with gold radial .coin + mono #walletTxt (tnum), .wallet.low amber; .avatar = 32px indigo gradient circle.
- .view (426–437): max-width 1080px (.wide 1220, .full 1480), padding 30px 34px 80px.
- Cards (514–537): .card = surface, 1px --line, --radius 18px, --shadow, 19px pad. .editorial = --mesh bg, 24px radius, indigo-10% border (framing hero surface).
- Hero (539–672): .hero 2-col grid; .hero-stats (Space Grotesk 30px num); .peek = mini leads-workbench preview card with .peek-item/.peek-match (mono indigo)/.psig signal chips (.psig.pain coral).
- Grid utils (674–697): .grid/.g2/.g3/.g4/.g5, collapse to 1 col <880px.
- Buttons PILL (699–782): .btn = 999px radius, 1px --line, 10px/18px, 13.5px 600, hover translateY(-1px). .btn.primary = indigo gradient + shadow. .btn.punch = YELLOW bg #f2e94e ink-text 700 (brand CTA). .btn.ghost = transparent indigo. Sizes .big/.sm/.xs/.block. Disabled states.
- Chips/pills/badges (784–824): .pill = 999px, variants .green/.amber/.red/.indigo (each bg-50 + colored border), .pill.dot.
- vs-cell signal bar (826–907): .sig + .track (8px rail, .band percentile range, .p90 marker, .mark colored dots green/amber/red/indigo) — the market-relative scoring viz.
- Template cards (909–971): .tpl service-template selector, .tpl.sel indigo ring, .ti icon tile, .sigs pill row, .out green outcome.
- Filter rows (973–1072): .filt with .sw toggle switch (38×22 → indigo when .on), .opn operator select, .vin value input, .tag/.tag.data ($0/data badges).
- Inputs (1074–1167): .field/label, .combo (focus = indigo border + 3px indigo-50 ring), .opts dropdown, .cells/.cellrow selected-cell tokens with .freshdot (fresh green/aging amber/stale red/new faint).
- Tables (1169–1241): th = 11px uppercase 0.05em faint 700; td 12px pad, tr:hover surface-2; .biz/.addr; .statpill (999px, 11.5px 700) with st-NEW #eef1f6/#475569, st-CONTACTED indigo-50, st-REPLIED #e9f0ff/#2563eb, st-WON green-50, st-LOST line-through gray, st-HIDDEN gray.
- Power table workbench (1243–1600+): .wb-toolbar (uniform 34px control height), .wb-search, .fbar/.fchip filter chips bar (indigo, dashed .add), .iconbtn with .cbadge count, .collapse-panel, .chipsbar, .wbpager pagination (.pgnum/.pgnav 30px).
- Stat tiles (2087–2120): .stat = white, --line, 16px radius, .v = Space Grotesk 32px value, .k label, .d delta.
- .callout (2122): indigo-50 bg, indigo-100 border, 14px radius.
- Toast (2312), Modal (2449–2508): .modal 16px radius + .mhead/.mbody/.mfoot, .msearch.
- Segmented controls: .seg (3232, indigo .on), .seg3 (4282), .seg2 (4516), .cmptoggle (5247).
- Drawer/side-panel (5445–5540+): .drawer-scrim + .drawer slide-in with .dhead (prev/next .ab arrows), .dbody, .dfoot, .dsec — the "open lead without losing list context" panel.
- Gauge (3261–3291): conic-gradient score arc, Space Grotesk value.
- Utilities: .hl (yellow-soft highlight behind punch phrases), .mono, .ink-indigo, .cr/.ic-coin (credit mono figures).

30 render\*() JS functions inject content (renderDiscover, renderWB/renderWBHead/renderWBBody, renderFilters, renderTplGrid/renderTplDetail, renderMarketSelector/renderMarketCells, renderTP, renderPreview, renderSigLib, renderCmd, etc.) — they consume the above classes; the component styles are the contract.

**Current:** The shipped agency portal has NO shared design system aligned to the prototype. It reuses the SMB warm palette and hand-rolls inline styles per component.

- app/globals.css (the only token source, @theme block lines 3–38): defines the SMB palette as the GLOBAL default — --color-bg #faf6f1 (cream), --color-coral #b96562, --color-berry #8b3a2c, --color-gold/-2, --color-success/-2, --color-alert, --color-info. Fonts: --font-sans Inter, --font-serif Fraunces, --font-mono JetBrains Mono, plus landing FreightBig/Montserrat. The ONLY agency tokens present are 4 lines (33–38): --color-agency-bg #f6f7fb (WRONG — prototype is #f4f5fb), --color-agency-indigo #5b3df5 (correct hue, but no -50/-100/-700 scale), --color-agency-indigo-2 #4729d8, --color-agency-teal #0891b2 (prototype has NO teal — it uses mint #caecec). NO --yellow, NO --ink/--ink-2/--muted/--faint, NO --line/--line-2, NO --surface/--surface-2, NO --mesh, NO --radius/--shadow scale, NO Space Grotesk.
- app/[locale]/(agency)/layout.tsx: shell uses .agency-shell grid (240px|1fr, NOT the prototype's 66px collapsible dark rail). Sets --color-bg to var(--color-agency-bg). Topbar is a plain 10px-padded header (var(--color-bg-2) white, var(--color-border) cream border) — NOT the frosted backdrop-blur 60px topbar. No breadcrumbs, no wallet-as-prototype, no avatar.
- components/agency/AgencySidebar.tsx + globals.css .agency-nav (lines 412–535): LIGHT sidebar on cream-cool bg with indigo-10% active state — the prototype rail is a DARK #0d1020 mesh rail with indigo-gradient active + yellow inset bar and collapse/expand. No logomark SVG, no Space Grotesk brand, no rail-collapse.
- modules/agency-portal/components/StatusPill.tsx: diverges hard. Uses mono UPPERCASE labels, borderRadius 5–6px (prototype .statpill is 999px pill), tones from rgba(91,61,245,.10)/var(--color-agency-teal)/var(--color-berry)/var(--color-success)/var(--color-alert) — i.e. SMB warm tokens, not the prototype's st-NEW #eef1f6 / st-REPLIED #e9f0ff,#2563eb flat pastels. Adds a ⌄ disclosure glyph the prototype doesn't have.
- modules/agency-portal/components/_ (LeadsTable.tsx, LeadRow.tsx, FilterRow.tsx, BulkActionBar.tsx) and discover/components/_ (DiscoverFlow.tsx + ~18 components): ALL styled via inline style={{}} objects referencing SMB tokens (var(--color-success), var(--color-gold), var(--color-alert), var(--color-agency-teal)) and ad-hoc gradients. grep confirms ZERO usage of the prototype component classes (.card/.btn/.pill/.statpill/.filt/.fchip/.editorial/.tpl) anywhere in modules/agency-portal or components/agency.
- Fonts: grep for next/font across app/components shows it loaded ONLY in app/[locale]/(marketing-v2)/layout.tsx (Space_Grotesk + Bricolage_Grotesque as --font-fb-sg/--font-fb-bric, scoped to .fb-scope via components/marketing/for-businesses/fb.css). Space Grotesk is NOT loaded for the agency portal — the portal renders headings in Inter. The marketing-v2 layout is the proven precedent for the delivery pattern the agency portal lacks.
- lib/ui/cn.ts exists (clsx + tailwind-merge) but there is no agency token file, no agency CSS module, no design-tokens.ts.

**Gaps:**

- [critical] Space Grotesk (--display) not loaded for the agency portal; all headings/stat-values/hero-numbers render in Inter instead of the prototype's display face — Prototype maps --display=Space Grotesk to every h1/h2/h3, .hero-stats .num, .stat .v, .gauge .gv. App only loads it in (marketing-v2). Proven fix pattern already exists there (next/font/google → CSS var → scoped class).
- [critical] Yellow brand-punch accent (--yellow #f2e94e and .btn.punch, .hl) completely absent from the portal token set and components — The yellow is the brand PUNCH per CLAUDE.md agency palette and prototype. No --yellow\*/mint token exists in globals.css; agency components substitute --color-gold/--color-agency-teal. Brand identity is lost.
- [critical] No prototype token scale — missing --ink/--ink-2/--muted/--faint, --line/--line-2, --surface/--surface-2, --indigo-50/-100/-700, --mint*, --coral*, --radius(18px)/--radius-sm, --shadow/--shadow-sm/--shadow-lg, --mesh — globals.css @theme has only 4 agency lines. Every component therefore hardcodes hexes/rgba inline against SMB tokens. Without the scale there is nothing correct to bind to.
- [major] Agency base bg is #f6f7fb not the prototype #f4f5fb; teal #0891b2 used where prototype has mint #caecec — Wrong base atmosphere + wrong secondary brand color cascade through StatusPill, gradients, and every surface.
- [critical] No shared reusable component classes (.card/.btn[.primary/.punch/.ghost]/.pill/.statpill/.seg/.modal/.drawer/.filt/.fchip/.tpl/.stat/.callout/.sig+.track) — Prototype delivers ~40 reusable classes; shipped portal re-implements each via inline styles per component, guaranteeing drift. Foundation must publish these as a CSS layer so every screen consumes them.
- [major] App shell is a flat 240px light sidebar; prototype is a collapsible 66px↔232px DARK #0d1020 mesh rail with indigo-gradient active state + inset yellow bar + logomark — layout.tsx + .agency-nav. Different structure (no collapse), different palette (light vs dark), different active treatment.
- [major] Topbar is a plain bordered header; prototype is a 60px frosted backdrop-blur sticky bar with breadcrumbs + gold-coin wallet + indigo avatar — layout.tsx AgencyHeader. Missing backdrop-filter, breadcrumbs, prototype wallet/avatar treatment.
- [major] StatusPill shape/tone divergent: 5–6px radius mono-uppercase with ⌄ glyph and SMB warm tones vs prototype 999px flat-pastel .statpill (st-NEW/REPLIED/WON etc.) — modules/agency-portal/components/StatusPill.tsx. Cited as the user's 'fully not aligned' symptom — concrete proof of wrong-shape.
- [minor] Focus ring uses --color-coral (SMB) globally; agency focus per prototype combos is indigo (border + 3px indigo-50 ring) — globals.css a:focus-visible outline:2px var(--color-coral). Wrong audience color in agency context.
- [minor] No editorial/--mesh framing surface, no .gauge, no .sig+.track market-relative bar as shared styles — These are reused across discover/preview/analytics screens; without shared styles each screen reinvents them inconsistently.

**Build spec:**

- 1. Create a single agency token source. Add an :root (or @theme + plain :root) block scoped under .agency-scope in a new app/(agency)/agency-portal.css (or extend app/globals.css with an `.agency-scope { ... }` token block). Port EVERY prototype :root token verbatim: --bg #f4f5fb, --surface, --surface-2, --ink, --ink-2, --muted, --faint, --line, --line-2; --indigo #5b3df5 + -50/-100/-700; --yellow #f2e94e + -ink/-50/-soft; --mint + -50/-ink; --coral + -50/-100; --green/--amber/--red + -50; --radius 18px, --radius-sm 12px; --shadow/--shadow-sm/--shadow-lg; --mesh. Keep names identical to the prototype so the prototype CSS can be pasted with zero renaming.
- 2. Load fonts via next/font/google in app/[locale]/(agency)/layout.tsx exactly like (marketing-v2): import { Space_Grotesk } from next/font/google with variable:'--display'; Inter (already a dep) → --font; JetBrains Mono → --mono. Apply the .variable classes + an `agency-scope` class to the shell root div so the tokens + fonts apply to the whole portal subtree. Remove the current `--color-bg = var(--color-agency-bg)` override.
- 3. Port the reusable component classes from docs/portal-prototype.html (lines 514–537 cards/editorial, 699–782 buttons incl .punch/.ghost, 784–824 pills, 1169–1241 tables+.statpill, 909–971 .tpl, 973–1167 .filt+inputs+.cellrow, 1243–1600 workbench .wb-toolbar/.fbar/.fchip/.iconbtn/.collapse-panel/.wbpager, 2087–2126 .stat/.callout, 2312 toast, 2449–2508 modal, 3232/4282/4516/5247 segmented controls, 5445–5540 drawer, 826–907 .sig+.track, 3261–3291 gauge) into agency-portal.css under the same scope. These reference the ported tokens, so they drop in unchanged.
- 4. Rebuild the app shell: convert app/[locale]/(agency)/layout.tsx + .agency-nav to the prototype's collapsible dark rail (.app/.side/.nav/.brand/.railtoggle, lines 126–347) and frosted topbar (.topbar/.crumbs/.wallet/.avatar, lines 354–424). Keep the existing i18n label wiring + CommandK/WalletPill/JobsTray but restyle them onto prototype classes.
- 5. Refactor shared agency components to consume the new classes instead of inline SMB tokens: StatusPill.tsx → emit .statpill + st-_ classes (999px pill, prototype tones, drop ⌄ unless prototype shows it); LeadsTable/LeadRow/FilterRow/BulkActionBar → use table/.filt/.fchip/.btn classes; discover/components/_ (DiscoverFlow, EnrichPanel, CohortCard, SignalsTable, VsCellBar, CostQuoteBar, etc.) → bind to .card/.editorial/.stat/.sig+.track/.tpl/.seg.
- 6. Change the agency focus-ring: scope a `.agency-scope :focus-visible { outline-color: var(--indigo) }` rule (or move the coral default behind an SMB scope) so agency uses indigo per prototype combobox focus.
- 7. Verify in browser at 1280px + 380px: dark rail collapse/expand, Space Grotesk on every heading + stat value, yellow .punch CTA, .statpill pill shape, frosted topbar. Run Lighthouse (perf ≥ 90, a11y ≥ 95). Confirm no token references the SMB warm palette inside .agency-scope.

**Files:**

- `app/[locale]/(agency)/agency-portal.css (NEW — ported prototype tokens + component classes, scoped to .agency-scope; imported by the agency layout)`
- `app/[locale]/(agency)/layout.tsx (load Space Grotesk/Inter/JetBrains Mono via next/font/google, add .agency-scope + font .variable classes, rebuild dark rail + frosted topbar, drop --color-agency-bg override)`
- `app/globals.css (add full agency token scale OR keep tokens in agency-portal.css; fix agency focus-ring to indigo; ensure SMB coral focus is SMB-scoped)`
- `components/agency/AgencySidebar.tsx (restyle to dark collapsible rail: .side/.nav/.brand/.railtoggle with indigo-gradient active + inset yellow)`
- `components/agency/WalletPill.tsx (prototype .wallet gold-coin pill + mono tnum)`
- `components/agency/CommandK.tsx (align to prototype topbar control styling)`
- `components/agency/JobsTray.tsx (align to prototype topbar/iconbtn styling)`
- `modules/agency-portal/components/StatusPill.tsx (emit .statpill + st-* prototype classes, 999px, prototype tones)`
- `modules/agency-portal/components/LeadsTable.tsx`
- `modules/agency-portal/components/LeadRow.tsx`
- `modules/agency-portal/components/FilterRow.tsx`
- `modules/agency-portal/components/BulkActionBar.tsx`
- `modules/agency-portal/discover/components/DiscoverFlow.tsx (and the ~18 sibling discover components — rebind inline styles to shared classes)`

---

## Global chrome (icon rail, topbar, ⌘K, credits pill, jobs tray, breadcrumb) — DIVERGENT (~22h)

**Prototype:** The prototype shell (docs/portal-prototype.html, body markup ~6610-6757, CSS 132-424 + 2330-2416 + 6088-6280, JS 12067-12135 + 18549-18731) is a 3-zone shell: optional top demo banner, a collapsible left ICON RAIL, and a sticky glass TOPBAR over the scrolling main.

1. DEMO BANNER (.banner-demo, CSS 2330): full-width dark strip (#0d1020, #cbd2e6 text, 12px, centered) above everything — "Mapsly portal — UX prototype · fake data...". Prototype-only; not for prod but defines the stacking order.

2. ICON RAIL / SIDEBAR (aside.side, CSS 132-347):
   - DARK navy panel: background = two radial-gradient glows (indigo rgba(91,61,245,.45) top-left, yellow rgba(242,233,78,.1) bottom-right) layered over #0d1020; text #cbd2e6. Sticky, height 100vh, overflow hidden.
   - Two states driven by .expanded: collapsed = ~64px icon-only rail (padding 16px 8px, nav buttons 44px square, labels display:none); expanded = 232px with labels (grid-template-columns 232px 1fr on .app:has(.side.expanded)). A .railtoggle chevron button (28px, #141830) flips 180deg to expand/collapse via toggleRail(). State is NOT persisted (in-memory only).
   - .side-top: brand row = circular black logomark SVG (28px, the 'm' mark) + "Mapsly" wordmark (var(--display) 20px #fff) + the railtoggle.
   - nav buttons (data-go): "Get leads" (target icon → welcome), "My research" (folder → research), a .sep divider, "Billing" (database cylinder), "Settings" (gear → onboarding). Each is <span class=ic><svg/></span><span class=txt>. Hover #191d33; .active = indigo gradient (135deg #5b3df5→#7a5bff) with inset 3px yellow accent bar (collapsed active = yellow ring instead).
   - A collapsed-only .railresearch icon button and an expanded .research <select> for switching research workspaces exist in the rail region.
   - .foot at bottom: "v0.19 prototype" version string.

3. TOPBAR (.topbar, CSS 354-424): height 60px, GLASS — background rgba(250,250,255,.72) + backdrop-filter saturate(160%) blur(14px), 1px bottom border, sticky top z-20, padding 0 26px. Left zone: a .hamburger (mobile only) + #crumbs BREADCRUMB. Right zone (.top-right, gap 12): the ⌘K button, the wallet pill, the avatar.
   - BREADCRUMB (#crumbs, CSS 368): 13px muted text; go(id) writes innerHTML = "<b>"+CRUMB[id]+"</b>". CRUMB map (JS 12067) produces hierarchical strings like "Get leads ▸ Goal", "Get leads ▸ Market", "Get leads ▸ Discover", "My research ▸ Med spas · Miami", "Billing", "Settings" — i.e. the breadcrumb is route-driven and shows section ▸ subscreen with a ▸ chevron.
   - ⌘K BUTTON (.kbtn, CSS 2397): pill, 1px border, white bg, shadow-sm; content = 🔎 icon + "Search or jump…" label + <kbd>⌘K</kbd>. onclick openCmd().
   - WALLET / CREDITS PILL (.wallet, CSS 386-413): rounded pill, white bg, 1px border, shadow-sm. Content = a .coin (16px gold radial-gradient circle #ffd86b→#e9a200) + #walletTxt mono tnum "3,540 credits". A .wallet.low variant turns amber when balance is low.
   - AVATAR (.avatar, CSS 414): 32px circle, indigo→violet gradient (135deg #5b3df5→#9d7bff), white initial "A".

4. ⌘K COMMAND PALETTE (#cmdOverlay modal, markup 8646-8689; JS COMMANDS 18549, openCmd/renderCmd/cmdKey 18607-18690): a full overlay+modal dialog (role=dialog aria-modal). Big search input placeholder "Search or jump to… (try 'workspace', 'billing', 'Solea')", live oninput renderCmd filtering, grouped rows (cmdgrp headers: "Go to" / "Actions" / "Look up a business"), each row has an icon + title + ↵ meta. Keyboard: ↑/↓ navigate, Enter open, Esc close, with aria-activedescendant. Footer hint "↑↓ navigate · ↵ open · esc close · ? shortcuts". COMMANDS includes jump-to navigation (Get leads, My research, Workspace, Touchpoints, Billing, Settings), Actions (New research, Discover a market), and business lookups (Solea Brickell Med Spa, Glow Aesthetic Lounge, Radiance MedSpa) that open the workspace + lead drawer. So it is a JUMP/ROUTER palette, not just business search.

5. MOBILE NAV (.mobnav bottom bar, markup 8408-8424; CSS 6240-6270): a fixed 5-button bottom nav on phones — 🧭 Get leads · 🗂️ Research · 🪙 Billing · ⚙️ Settings · 🔎 Search (opens ⌘K). Plus a slide-in drawer version of .side (transform translateX, .scrim backdrop) toggled by the topbar .hamburger via toggleSide() at ≤760px.

6. TOAST (.toast #toast, CSS 2312-2329; markup 8746): a single global role=status aria-live=polite toast used everywhere (toast('…')) for action feedback ("Saved", "Filter added", "Status → contacted", "Exported to CSV").

7. GLOBAL KEYBOARD (JS 18716): ⌘K/Ctrl+K opens palette; Esc closes every overlay (palette, sidebar, drawer, filter editor, signal lib). go(id) router (12093) hides/shows .view sections, rewrites breadcrumb, syncs .active on both .nav and .mobnav, lazy-renders the target screen, closes the mobile drawer, scrolls to top.

**Current:** Shipped chrome lives in app/[locale]/(agency)/layout.tsx with three client components and is visually + structurally a DIFFERENT shell from the prototype.

LAYOUT (app/[locale]/(agency)/layout.tsx): a CSS-grid .agency-shell (globals.css 412: grid-template-columns 240px 1fr, light --color-agency-bg). Sync default export, Suspense-wrapped server children. Renders <AgencySidebar> + a <header> (AgencyHeader) over <main>. Auth enforced per-page, not here.

SIDEBAR (components/agency/AgencySidebar.tsx + globals.css 418-505): a LIGHT cool-gray rail (background var(--color-agency-bg), 1px right border), NOT the prototype's dark glowing navy. Brand row = a tiny 9px indigo dot + "mapsly" + an "Agency" tag pill (NOT the circular black logomark SVG, NOT a wordmark in --display, NO version footer). Nav is grouped into section labels "Workspace / Insight / Account" with items Discover, Campaigns, Touchpoints, Agency settings, Team & billing (hrefs /discover /campaigns /touchpoints /agency-settings /team/billing). Active state = light indigo tint background (rgba(91,61,245,.1)) — NOT the indigo gradient + yellow inset bar. NO collapse/expand icon-rail; NO railtoggle; NO icon-only collapsed mode. Mobile = horizontal scroll-tab strip (globals.css 508), NOT a bottom .mobnav + slide-in drawer.

TOPBAR (AgencyHeader inside layout.tsx): a plain <header> (padding 10px 24px, background var(--color-bg-2), 1px bottom border, flex space-between). NOT sticky, NO glass/backdrop-blur, height ~48px not 60px. Left zone = a single mono uppercase tag reading t('topbar_tag') = "Lead workspace". There is NO BREADCRUMB at all — no #crumbs, no CRUMB map, no section ▸ subscreen hierarchy. Right zone = <WalletPill> + <JobsTray> + <CommandK>. NO avatar.

⌘K (components/agency/CommandK.tsx): present but it is a BUSINESS-SEARCH palette only, not a jump/router palette. Trigger button shows "⌘K Search" (NOT the prototype's roomy "Search or jump…" pill with separate kbd). Opens a generic <Modal> titled "Find a business", placeholder "Search businesses…", debounced fetch to /api/agency/search, keyboard nav (↑↓/Enter/Esc), aria-activedescendant. It has NO "Go to" navigation rows, NO "Actions" rows, NO grouped command sections — and selecting a result currently just routes to /discover (the per-business detail route was demolished). i18n keys agency.commandK.\* exist.

CREDITS PILL (components/agency/WalletPill.tsx): present and wired to real data (reads AgencyWallet: planCredits+purchasedCredits+rolloverCredits-heldCredits). Renders a rounded pill linking to /usage, content = "◈" glyph + "{n} credits" (mono 12px). But the design diverges: NO gold radial-gradient .coin (uses a flat ◈ char), border is generic --color-border not the white-pill+shadow-sm look, and the low-balance state shows "0 credits — add" with an indigo border rather than the prototype's amber .wallet.low treatment. Label format "3,540 credits" matches.

JOBS TRAY (components/agency/JobsTray.tsx): PRESENT (this is the one element the prototype only references as a concept). Polls /api/agency/jobs every 4s, shows a pill ("N running" / "N recent") with a status dot, expands to a 280px popover with per-job X/Y progress bars for discovery/enrichment. No prototype visual to match against, but it fits the agency density language.

TOAST: no global toast component is mounted in the agency chrome (the prototype's ubiquitous toast() feedback channel is absent from the shell).

DESIGN APPROACH: shipped chrome is inline-styles + a handful of globals.css .agency-_ classes using shared design tokens (--color-_, --font-\*). The prototype is a self-contained dark-rail/glass-topbar design with bespoke classes (.side/.topbar/.wallet/.kbtn/.crumbs). The two do not share visual language: light vs dark rail, no glass topbar, different nav taxonomy, no breadcrumb, weaker credits + ⌘K affordances.

**Gaps:**

- [critical] Nav taxonomy mismatch — shipped items (Discover/Campaigns/Touchpoints/Agency settings/Team & billing) do not match the prototype's rail (Get leads/My research/Billing/Settings). Different mental model, different routes, different copy. — This is the root of 'fully not aligned'. The whole portal IA reads differently. Needs a product decision on which taxonomy is canonical before chrome can be aligned; if prototype wins, rename/regroup nav + routes.
- [critical] Sidebar palette inverted — shipped rail is light cool-gray; prototype rail is dark #0d1020 with indigo+yellow radial glows, white wordmark, and an indigo-gradient+yellow-inset active state. — Single biggest visual divergence. The dark rail is the signature of the prototype's agency look.
- [major] No icon-rail collapse/expand — prototype has a 64px icon-only collapsed mode ↔ 232px expanded, toggled by a chevron .railtoggle. Shipped is a fixed 240px rail with no collapse. — Core chrome interaction (toggleRail) entirely missing.
- [major] No breadcrumb — prototype topbar shows route-driven hierarchical crumbs (e.g. 'Get leads ▸ Discover', 'My research ▸ Med spas · Miami') via a CRUMB map. Shipped shows a single static 'Lead workspace' tag, no hierarchy, no per-page update. — Users lose location context across subscreens. Needs a CRUMB equivalent keyed by route/segment.
- [major] Topbar is not a glass sticky bar — prototype topbar is 60px, sticky, rgba glass + backdrop-blur, padding 0 26px. Shipped is a non-sticky ~48px plain bar. — Affects perceived polish and scroll behavior.
- [major] ⌘K is search-only, not a jump/command palette — prototype palette has grouped 'Go to' / 'Actions' / 'Look up a business' commands (navigation + actions + business lookup). Shipped only does business search and even that dead-ends at /discover. — The 'Search or jump…' promise in the trigger copy is unmet. Needs command groups wired to navigation + actions.
- [minor] ⌘K trigger affordance weaker — prototype is a roomy pill '🔎 Search or jump… ⌘K' (kbd shown separately, shadow-sm). Shipped is a compact '⌘K Search' button. — Copy + sizing divergence.
- [minor] Credits pill design diverges — prototype has a gold radial-gradient coin + white pill + shadow-sm + amber .low state. Shipped uses a flat ◈ glyph, generic border, indigo (not amber) empty state. — Data binding is correct (real wallet); only the visual treatment is off.
- [minor] No user avatar in topbar — prototype shows a 32px indigo→violet gradient avatar with the agency initial. Shipped topbar has none. — Account affordance / menu anchor missing.
- [minor] No brand logomark / wordmark / version footer in rail — prototype has the circular black 'm' SVG logomark, a --display wordmark, and a 'v0.19 prototype' foot. Shipped has a 9px dot + 'mapsly' text only. — Brand identity weaker; version footer (could surface package.json version per versioning.md) absent.
- [major] No global toast channel in the shell — prototype mounts one #toast (aria-live) used for all action feedback. Shipped agency chrome mounts none. — Many downstream actions (status changes, exports, filter edits) rely on this feedback channel; without it each feature reinvents feedback.
- [minor] Mobile chrome shape differs — prototype uses a fixed bottom .mobnav (5 buttons incl. Search) + slide-in drawer via hamburger. Shipped uses a horizontal scroll-tab strip, no hamburger, no bottom nav, no Search entry on mobile. — Agency is desktop-first so lower priority, but it is still a divergence.
- [minor] JobsTray has no prototype counterpart to validate against — it is PRESENT and reasonable, but its placement/visual weight should be reconciled once the topbar is redesigned. — Keep; just restyle to match the new glass topbar + dark-rail accent system.

**Build spec:**

- 0. PRODUCT DECISION (blocking): confirm the canonical nav taxonomy. The gap analysis assumes the prototype is source of truth, so align shipped nav to Get leads / My research / Billing / Settings (or the agreed mapping to existing routes /discover, /campaigns, etc.). Lock the route↔label↔crumb mapping before touching CSS.
- 1. Introduce an agency chrome token/style module: add the dark-rail design to globals.css (or a dedicated agency-chrome.css) — port .side gradients (#0d1020 + indigo/yellow radial glows), expanded (232px) vs collapsed (64px) widths, dark nav buttons, indigo-gradient + yellow-inset active state. Replace the current light .agency-nav look.
- 2. Rebuild AgencySidebar.tsx as a collapsible icon rail: add the circular logomark SVG + wordmark + railtoggle chevron; add collapsed/expanded state (client useState, optional localStorage persistence); icon-only mode hides labels; render the version string in a .foot (read package.json version per versioning.md). Wire active state to usePathname against the agreed route map.
- 3. Rebuild the topbar (AgencyHeader): make it a 60px sticky glass header (rgba bg + backdrop-blur, bottom border). Left = hamburger (mobile) + breadcrumb; right = ⌘K pill + WalletPill + JobsTray + avatar.
- 4. Add a Breadcrumb component: a CRUMB map keyed by route segment producing 'Section ▸ Subscreen' strings (i18n via messages agency.crumbs.\*). Render it client-side from usePathname (or pass per-page crumb props). Use the ▸ chevron separator and bold the leaf.
- 5. Upgrade CommandK into a jump/command palette: add grouped commands — 'Go to' (nav targets), 'Actions' (New research, Discover a market), and 'Look up a business' (the existing /api/agency/search results). Keep keyboard nav + a11y. Restyle the trigger to the roomy '🔎 Search or jump… ⌘K' pill. Fix selection routing once a per-business detail route exists; until then keep the search→/discover fallback but add real nav rows.
- 6. Restyle WalletPill: add the gold radial-gradient coin, white-pill + shadow-sm treatment, and an amber low-balance state (.wallet.low equivalent) replacing the indigo empty state. Keep the real wallet data binding.
- 7. Add a user Avatar component in the topbar (32px indigo→violet gradient, agency initial from session) as the anchor for an account menu (sign out, settings).
- 8. Mount a global Toast provider in the agency layout (aria-live region) and expose a toast() client hook so downstream features share one feedback channel.
- 9. Rework mobile chrome to match: fixed bottom .mobnav (Get leads / Research / Billing / Settings / Search) + hamburger-driven slide-in drawer with scrim, replacing the scroll-tab strip; ensure ⌘K reachable on mobile.
- 10. Restyle JobsTray to sit cleanly in the new glass topbar (dot/pill colors against the new accent system).
- 11. Add/extend i18n keys: agency.crumbs.\*, agency.commandK group labels + action/nav row labels, avatar/account menu labels, toast strings as needed.
- 12. Validate: browser-test the agency shell (desktop + 380px), confirm sticky glass topbar, breadcrumb updates per route, ⌘K jump works, rail collapses, wallet low state, toast fires; Lighthouse mobile ≥90 / a11y ≥95; run ux-reviewer-agency + copy-reviewer.

**Files:**

- `app/[locale]/(agency)/layout.tsx`
- `components/agency/AgencySidebar.tsx`
- `components/agency/CommandK.tsx`
- `components/agency/WalletPill.tsx`
- `components/agency/JobsTray.tsx`
- `components/agency/Breadcrumb.tsx`
- `components/agency/Avatar.tsx`
- `components/agency/Toast.tsx`
- `components/agency/AgencyTopbar.tsx`
- `app/globals.css`
- `messages/en.json`
- `messages/es.json`
- `messages/en-CA.json`
- `messages/fr.json`

---

## welcome — MISSING (~11h)

**Prototype:** The prototype's agency entry screen is `#view-welcome` (docs/portal-prototype.html lines 6760-6905), a full-width branded marketing-grade hero that sells the product BEFORE dropping the user into the discovery flow. It is the first screen `go()` renders for the welcome route and the only screen that fires `runCountUps()`.

STRUCTURE (two stacked sections inside `.section` blocks):

1. HERO (`.editorial` gradient surface > `.hero` 2-col grid `minmax(0,1.04fr) minmax(0,0.96fr)`, gap 38px, `align-items:center`):
   LEFT COLUMN (`.hero-copy`):
   - `.eyebrow` (uppercase, 11.5px, weight 700, letter-spacing 0.1em, color var(--indigo-700)): "Welcome back, Anchor Local" — personalized with the agency name.
   - `<h1>` font-size 38px, max-width 16ch, using `--display` (Space Grotesk): "Find the local businesses that **need what you sell** — with the reason." The middle phrase wrapped in `.hl` (highlight).
   - `.sub` paragraph (15.5px, max-width 46ch): "Mapsly maps every **local business on Google** in a city — the med spas, dentists, HVAC shops — and tells you **which ones have the problem you fix, and why**, in plain English. Not a contact database — a shortlist with reasons." (bold spans on the load-bearing phrases).
   - `.hero-stats` (flex row, gap 30px) — THREE animated count-up stats:
     • `data-to="150"` → "US metros ready to search"
     • `data-to="2100000" data-fmt="compact"` → renders "2.1M" → "local businesses mapped on Google"
     • `data-to="50" data-suffix="+"` (colored var(--indigo)) → "expert signals competitors can't see"
     Each `.num` is 30px `--display` weight 600; `.lbl` is 12px var(--muted), max-width 17ch.
   - CTA row (flex, gap 12px): `<button class="btn punch big" data-go="goal">` "Find my first leads →" (the `punch` variant is the YELLOW brand CTA: bg var(--yellow) #f2e94e, border #e3d83a, dark ink text, yellow glow shadow). Beside it a `.note`: "Free plan · [coin icon] 60 credits included · no card needed" — the credit count uses `.cr` (mono, tnum, weight 700) with an inline `.ic-coin` gold radial-gradient dot.

   RIGHT COLUMN (`.peek`, `aria-hidden="true"`) — a faithful static mini-mock of the leads workbench (white card, 16px radius, big soft drop-shadow `0 24px 50px -28px rgba(20,22,60,.4)`):
   - `.peek-head`: green `.pdot` + "Med spas · Miami" + right-aligned `.pcount` "64 qualified".
   - THREE `.peek-item` rows, each with `.peek-top` (name + `.peek-meta` "★ rating · N reviews · neighborhood" in mono) and a right-aligned `.peek-match` percentage pill (indigo tint), then `.peek-sigs` signal chips:
     • Solea Med Spa · ★4.2 · 212 reviews · Brickell · 88% — chips: "Overdue for a redesign", "Runs Meta ads without a pixel" (`.pain` = coral).
     • Glow Aesthetics Studio · ★4.6 · 88 reviews · Wynwood · 81% — chips: "Invisible locally", "Reputation slipping" (pain).
     • Lumière Skin Bar · ★3.9 · 47 reviews · Coral Gables · 76% — chips: "Losing mobile customers", "Legal & compliance risk" (pain).
   - `.peek-fade` gradient overlay at the bottom (fades to white, suggesting more rows).
   - `.psig` chips: indigo-tint pill; `.psig.pain` chips: coral-50 bg / coral text. (At ≤920px the hero collapses to single column.)

2. TESTIMONIALS (`.grid.g2.section`, `align-items:stretch`) — TWO `.quotecard`s (white, 16px radius, big yellow opening-quote glyph via `::before`):
   - 5-star `.qstars` (gold ★★★★★) + `.qtext` (16px `--display`, weight 500) "Apollo gave me names. Mapsly gives me the **reason to call** — the slow site, the dead pixel, the unanswered reviews. My reply rate went from 2% to 19%." + `.qchose` (coral) "Switched from Apollo" + `.qwho` "Marcus Hale · owner, Brightpath Agency (Toronto)".
   - Second card: "One search pulled **64 med spas losing bookings** to a slow site — with the proof for each. Two retainers signed that month." + "Replaced manual prospecting" + "Dana Reyes · founder, Coastline Studio".

BEHAVIOR / DATA:

- On entering the view, `runCountUps(el)` animates each `.countup` from 0 to `data-to` over 900ms with cubic ease-out, honoring `prefers-reduced-motion` (jumps to final value). `fmtCount` handles compact (2.1M) and `toLocaleString` formatting; suffix ("+") appended.
- The single primary CTA routes to `goal` (the goal-picker → build → workspace flow). Everything else on the screen is read-only marketing.

DESIGN TOKENS (prototype `:root`): `--display:"Space Grotesk"`, `--indigo:#5b3df5`, `--indigo-700:#4226c9`, `--yellow:#f2e94e`, `--coral:#b96562`, `--coral-50:#faecec`, `--muted:#64708c`, `--ink:#0f172a`, `--mono` JetBrains-style, `--mesh` soft cool gradient background for `.editorial`.

INTENT: This is a confidence-building "you're in the right place, here's the payoff, here's your free credits — go" screen. ONE CTA, no decisions required. It frames the discovery flow before the user has to pick anything.

**Current:** There is NO welcome/home screen in the shipped agency portal. The agency sidebar's first (and only "workspace") landing item is `/discover` (components/agency/AgencySidebar.tsx line 126: `{ href: "/discover", labelKey: "discover", ... }`), so the agency's effective front door is the picker.

`/discover` (app/[locale]/(agency)/discover/page.tsx) renders a SYNC default export wrapping an async `DiscoverBody` in Suspense (per cacheComponents Pattern 2). The body does auth → AgencyMember lookup → loads metros (US_METROS) + active BusinessCategory rows, then renders a plain header ("Discover" h1 + one-line gray sub) and immediately drops the user into `<DiscoverFlow>` (modules/agency-portal/discover/components/DiscoverFlow.tsx) — a bare metro chip picker (§1) + category chip picker (§2) + cells-math/Preview-cost box (§3) + CostQuoteBar. No hero, no stats, no peek, no testimonials, no CTA framing, no count-ups.

Design approach of the shipped flow: utilitarian Tailwind utility classes (rounded-full pills, slate/indigo borders, `text-sm`) — NOT the prototype's editorial/branded language. No Space Grotesk display font (globals.css only ships `--font-serif: Fraunces` + `--font-mono: JetBrains Mono`), no yellow "punch" CTA token, no `.editorial`/`.hero`/`.peek`/`.quotecard` styles, no count-up animation. The matching indigo `#5b3df5` token IS present (globals.css `--color-agency-indigo`).

A grep across app/, modules/, components/ for `countup`, `hero-stats`, `peek-item`, `view-welcome`, `runCountUps`, "Find my first leads", "need what you sell" returns ZERO hits — none of the welcome content or behavior exists.

Note: the non-member fallback `redirect({ href: "/home" })` in discover/page.tsx (line 59) targets `/home`, which only exists under `(smb)` (app/[locale]/(smb)/home/page.tsx). There is no agency `/home` or `/welcome` route at all.

**Gaps:**

- [critical] No welcome/home screen exists in the agency portal — the entire branded hero, stats, peek mock, testimonials, and framing CTA are absent; users land straight on the discovery picker. — This is the prototype's designated front door and the primary reason the user says the portal is 'fully not aligned.' Entire screen missing.
- [critical] No single framing CTA ('Find my first leads →') routing into the discovery/goal flow; instead the user must immediately make metro+category selections with no context. — Prototype is deliberately one-CTA, zero-decision. Shipped front door forces an upfront picker decision (violates the welcome screen's intent).
- [major] No animated count-up stats (150 metros / 2.1M businesses / 50+ signals) with the runCountUps cubic-ease + prefers-reduced-motion behavior. — Core trust/scale proof. Needs a client component (count-up uses requestAnimationFrame; respect reduced-motion).
- [major] No product-peek mini-mock (3 sample lead cards with rating/reviews/neighborhood meta, match-% pills, and indigo/coral signal chips). — Right column of the hero — shows the payoff visually. Static, aria-hidden; pure presentation.
- [major] No testimonial quotecards (2 cards with stars, quote, 'switched from / replaced' tag, attribution) and the yellow opening-quote glyph styling. — Social proof / Apollo-vs-Mapsly positioning. Below the hero.
- [minor] Personalized eyebrow ('Welcome back, {agencyName}') is absent — no agency-name binding on any landing surface. — Requires fetching the AgencyMember→Agency name; the discover page already does the member lookup so the agency record is one join away.
- [major] Design-token / typography divergence: prototype hero uses Space Grotesk (--display) and a yellow 'punch' CTA (#f2e94e); shipped globals.css ships neither a display font nor a yellow token. — To match the prototype's brand language a --font-display (Space Grotesk via next/font) and --color-yellow token must be added; otherwise the rebuilt screen will look off-brand even if structurally complete.
- [minor] 'Free plan · 60 credits · no card needed' credit note with the gold coin icon is absent on the entry screen. — Reinforces the free-tier offer at the moment of first action. The .cr/.ic-coin pattern already exists conceptually in WalletPill but not on a welcome surface.
- [major] Routing/IA: sidebar lands on /discover with no /welcome (or /home) agency route; the prototype treats welcome as the default destination. — Decision needed: make welcome the default agency landing (new route + redirect/nav change) vs. prepend the hero above the picker on /discover. Prototype models them as distinct screens (welcome → goal flow).

**Build spec:**

- 1. Add design primitives to app/globals.css (or theme layer): a `--font-display` var wired to Space Grotesk via next/font/google in the agency layout (display:'swap', latin subset), and a `--color-yellow: #f2e94e` token plus a `.btn-punch` (yellow CTA) style. Confirm `--color-agency-indigo` (#5b3df5) and a coral token are available; add `--color-coral`/`--color-coral-50` if missing.
- 2. Create the route: app/[locale]/(agency)/welcome/page.tsx — SYNC default export wrapping an async `WelcomeBody` in Suspense (cacheComponents Pattern 2). Body: setRequestLocale, auth() → unauthorized() if no session, AgencyMember lookup → if no member redirect to the correct agency landing (NOT /home, which is SMB), and join to Agency to get the agency name for the personalized eyebrow. metadata robots:noindex.
- 3. Build the WelcomeHero server component: `.editorial` gradient surface containing the 2-col `.hero` grid. Left: eyebrow 'Welcome back, {agencyName}', the 38px display h1 with the .hl highlight span, the .sub paragraph with bold phrases, the HeroStats client component, and the CTA row (yellow punch button → link to the goal/discover flow + the '60 credits · no card needed' note with coin icon). Right: the static PeekMock (aria-hidden).
- 4. Build HeroStats as a 'use client' component: render the three stats; port runCountUps (requestAnimationFrame, 900ms, cubic ease-out, fmtCount with compact/locale formatting + suffix) and honor prefers-reduced-motion (jump to final). Drive values from props (150 / 2_100_000 / 50) so they can later be wired to real counts (US_METROS.length, indexed business count, signal-registry size).
- 5. Build PeekMock (server, presentational): the .peek card with .peek-head (green dot + 'Med spas · Miami' + '64 qualified'), three .peek-item rows (name, mono meta, match-% pill, signal chips with .pain coral variant), and the .peek-fade overlay. Use the sample data from the prototype.
- 6. Build Testimonials (server, presentational): the .grid.g2 of two .quotecard components with stars, quote text (display font), coral 'chose' tag, attribution, and the yellow ::before opening-quote glyph.
- 7. Wire the CTA target: point 'Find my first leads →' at the discovery entry (the goal/build flow if/when it exists, otherwise /discover). Use next-intl Link.
- 8. Decide + implement IA: make /welcome the agency default landing — either redirect the agency root to /welcome and/or add a sidebar nav item, OR (lighter) render the hero ABOVE the existing DiscoverFlow on /discover. Recommend the dedicated /welcome route to match the prototype's screen separation; update AgencySidebar + agency.nav messages (item_welcome, brand eyebrow) accordingly.
- 9. Add i18n message keys under agency.welcome.\* in messages/en.json (eyebrow, headline parts, sub, stat labels, cta, credit note, peek sample copy, testimonials) — no inline strings per i18n rule. Mirror the en-only baseline; follow-up task for es/fr-CA.
- 10. Responsive + a11y: collapse .hero to single column ≤920px, ensure the peek is aria-hidden, give the count-up numbers aria-labels, tap targets ≥44px on the CTA, and verify Lighthouse mobile Perf ≥90 / a11y ≥95. Browser-validate as an agency member (renders 200, count-ups fire, CTA routes) and anonymous (redirects to sign-in).

**Files:**

- `app/[locale]/(agency)/welcome/page.tsx`
- `modules/agency-portal/welcome/components/WelcomeHero.tsx`
- `modules/agency-portal/welcome/components/HeroStats.tsx`
- `modules/agency-portal/welcome/components/PeekMock.tsx`
- `modules/agency-portal/welcome/components/Testimonials.tsx`
- `app/globals.css`
- `app/[locale]/(agency)/layout.tsx`
- `components/agency/AgencySidebar.tsx`
- `messages/en.json`

---

## Goal — "What do you sell?" (signal-bundle templates) (key: goal) — DIVERGENT (~40h)

**Prototype:** A dedicated full-width step screen `#view-goal` ("What do you SELL?") that frames intent as PICKING A GOAL TEMPLATE — a saved bundle of expert signals — with a LIVE, EDITABLE signal-detail panel. Layout: `.goalsplit` two columns.

LEFT (`.goalleft`, searchable template list):

- Search input (`#tplSearch`, placeholder "Search goals — web, ads, SEO, reputation, booking…") that filters on title/name/who/out/category AND each preset signal's label (so "pixel"/"booking" find their template) via `renderTplGrid(q)`.
- A grouped list (`#tplGrid`): "Your templates" (user-saved, key `my_<n>`, deletable via × ) first, then "Templates". Each row (`.tplrow`) = icon + title + a small category tag (`.tplcat`) + a "who" sub-line + a right-aligned meta showing the COUNT of active signals ("3 signals"). Selected row gets `.sel` + aria-pressed; selecting only swaps the RIGHT panel (no list reflow/blink).
- An always-visible Custom row ("⚙️ Custom · blank — Start from scratch — pick exactly the signals you want") and a "← Back" button to welcome.
- 13 preset templates in TEMPLATES data, each with {name, icon, title, cat, who, out, filters[]}: website (🌐 Website redesign/Web), seo (🔍 Local SEO/Search), ads (📣 Paid ads/Ads), reviews (⭐ Reputation/Reviews), booking (📅 Booking tool/SaaS), social (📸 Social media/Social), content (✏️ Content / blog/Search), fullservice (🧰 Full-service/Bundle), reactivation (♻️ Reactivation/Bundle), email (📧 Email & CRM/Bundle), custom (⚙️). Each filter row carries {t:title, on:bool, why:rationale, sig:true, optional matchMode/sset/sig}.

RIGHT (`.goalright`, sticky detail panel `#tplDetail`, aria-live):

- EMPTY STATE before a goal is picked: target-icon SVG, "Pick a goal to see who it finds", guidance copy ("this panel shows exactly which signals it uses, the recipe behind each, and lets you tune it all right here"), and 3 tips (Most agencies start with Website redesign or Local SEO / Selling a tool? Try Booking-tool SaaS / Want full control? Custom).
- PICKED STATE (`renderTplDetail` after `pickTpl`→`loadGoalFrom` clones the template's filters into editable GOAL state {base, name, customized, filters[]}):
  • Head: signal icon, an EDITABLE goal-name `<input id=goalNameInput>` (oninput updates GOAL.name), a sub-line ("Preset signal bundle" OR "Customized · based on <baseTitle>") with a live active-signal count, and a "Save as template" button (disabled until customized; persists to MYTEMPLATES).
  • Intro copy: "These expert signals decide who we target. The preset already works — keep it as-is, or tune, remove and add as you like."
  • `#filters` rendered by `renderFilters()`: signals grouped by OUTCOME bucket (Growing & worth your time / Weak online presence / Wasting money / Reputation at risk / …), each group header with a one-line value statement. Each signal = a card (`.sigc`) with: an on/off SWITCH (role=switch, `toggleFilt`), name + a SIGNAL or DATA badge + a data-status badge + confidence dots (composites), a plain-English "means" line, and a "Tune signal / How it works / Hide details" expander (`toggleTune`). Expanded card shows: "How it works" recipe (composite → match-mode any/all toggle + per-condition toggle lines; single-input → recipe input rows), a "🔒 what it's built from is our expertise" lock note for composites, the tuning CONTROL (strictness / mode-select / scale / platform / presence per SIG_META.setting), and a "Remove signal" button. Editing any of this calls `markCustomized()`.
  • An Advanced raw-data `<details class=rawexp>` drawer for atomic single-source DATA filters rendered as inline sentences ("Mobile speed is below 50 /100 ×") with operator word-select + inline value inputs + remove ×, and "+ Add raw field".
  • "＋ Add signal or raw data" button → opens the SIGNAL LIBRARY modal (`openSigLib`): searchable (`#sigLibSearch`), grouped into 8 sections (★ Top expert signals (composites) always-open, Reputation / Reviews, Website & Tech, Search / SEO, Profile & identity, Reachability & Contacts, Business qualifiers, AI research), each row = name + SIGNAL/DATA badge + data-status + truncated description + "＋ Add" (carries default op/val into GOAL.filters via `addSigFromLib`, marks customized, also seeds workspace WB.filters). Count footer "N signals & raw fields".
  • Reassurance copy ("✓ No pressure — the preset … is a great start. Add, tune or remove signals anytime, including later on your leads table.").
  • Primary CTA: "Choose your market →" (go('build')) + note "Set signals once here — next is just where to look."

Data model: GOAL is the single source of truth for the active signal set (signals are chosen ONCE here; the Build/market screen reads GOAL read-only via `renderBuildGoalRail`). Backed by TEMPLATES (13 bundles), SIG_META (per-signal group/means/pitch/recipe/confidence/setting), SIGLIB (~60+ library entries across 8 groups), MYTEMPLATES (user-saved). Design uses the prototype's tokenized agency look (cream/indigo classes like .tplrow, .sigc, .badge-sig, .goalsplit; the SMB cream + agency indigo system from the prototype's own CSS).

**Current:** A goal/intent step EXISTS and is wired, but as a fundamentally different paradigm: free-text describe-your-offer → deterministic strategy preview, NOT pick-a-signal-bundle → live editable signal-tuning panel.

`app/[locale]/(agency)/campaigns/new/page.tsx` — auth-gated shell (Suspense + auth + AgencyMember check) titled "New campaign" / "Tell us what you sell — we'll turn it into a costed research strategy and take you straight to discovery." Mounts `<CampaignIntake>`.

`modules/campaign/components/CampaignIntake.tsx` — a 2-pane client component. LEFT = a free-text form with 4 fields: Campaign name (optional), "What are you selling?" (textarea, the primary classifier input), "Who's the buyer?" (optional ICP), "Pain points you solve" (optional). RIGHT = a READ-ONLY "Proposed strategy" panel updated via a 500ms-debounced `getStrategyAction`, showing four groups: Target categories (chips), Enrichments (chips), Suggested filters (mono list of `signalKey comparator value`), and "Why this strategy" (rationale bullets), plus a "~$X / business" cost label. "Save campaign" → `createCampaignAction` → redirect to `/discover?campaign=…`.

`modules/campaign/strategy.ts` — PURE deterministic keyword classifier: `classifyIntent` maps free text into one of 5 buckets (website, booking_saas, reputation, ads_ppc, seo) + `general` fallback; each bucket has a hand-tuned strategy (recommendedCategories, recommendedEnrichments, signalWeights, suggestedFilters with real registry keys, rationale). Also exports `STRATEGY_TEMPLATE_SEEDS` (3 templates: sell-websites, sell-booking-saas, sell-reputation) intended to seed a `StrategyTemplate` table for "one-click starting points" — but no UI consumes them.

`app/[locale]/(agency)/campaigns/page.tsx` — a campaigns INDEX (list of saved Campaign rows + "New campaign" CTA + empty state). No template grid, no signal bundles.

Styling everywhere = Tailwind utility classes in the slate/indigo family (border-slate-200, bg-indigo-600, text-slate-500, font-mono) — not the prototype's tokenized component classes, and not warm-cream; closer to the agency indigo but ad-hoc utilities rather than a shared design system.

What's wired to data: Campaign + (per comments) ResearchPlan/StrategyTemplate Prisma models, modules/signals/registry.ts keys, modules/cost/pricing.ts for the cost estimate. There is NO TEMPLATES-style bundle catalog, NO SIG_META (recipe/means/pitch/confidence per signal), NO signal-library modal, NO per-signal cards/toggles/tuning, NO save-as-template UI, NO editable GOAL working state.

**Gaps:**

- [critical] Core paradigm mismatch: prototype is pick-a-goal-template (signal bundle); shipped is free-text-describe-your-offer. The user-facing mental model, layout, and interaction are entirely different. — Prototype LEFT = searchable list of 13 named signal-bundle templates each showing an active-signal count; shipped LEFT = 4 free-text fields. There is no template-picker UI at all.
- [critical] No live, editable signal-detail panel. Prototype RIGHT panel lets the user toggle/tune/remove each signal and add more; shipped RIGHT panel is read-only strategy output. — Shipped StrategyPreview renders chips + a mono filter list + rationale — none interactive. No on/off switches, no expanders, no recipe, no tuning controls, no remove.
- [critical] No per-signal SIGNAL/DATA cards with meaning, recipe ('How it works'), confidence dots, and locked-composite explanation. — Prototype sigCardHtml + SIG_META carry means/pitch/recipe/conf/setting per signal — the core 'expertise made visible' moat. Shipped shows only `signalKey comparator value` strings.
- [major] No outcome grouping of signals (Growing / Weak web / Wasting money / Reputation at risk …). — Prototype groups cards by OUTCOMES with a value statement per group; shipped lists filters flat.
- [critical] No signal-library 'Add signal or raw data' modal (8 groups, ~60+ entries, searchable). — openSigLib/renderSigLib/addSigFromLib + SIGLIB don't exist on the shipped side; the agency cannot add or browse signals here.
- [major] No editable goal name + Preset/Customized state + Save-as-template. — Prototype #goalNameInput, customized tracking, saveMyTemplate/MYTEMPLATES, deleteMyTemplate. Shipped only has an optional campaign-name text input; STRATEGY_TEMPLATE_SEEDS exist in code but are unused by any UI.
- [major] No 'Your templates' (saved) vs 'Templates' (preset) two-tier list. — Prototype groups user-saved templates above presets and supports delete; shipped has no template concept in the UI.
- [minor] No empty-state guidance panel ('Pick a goal to see who it finds' + 3 tips). — Shipped right panel empty state is a single sentence about typing what you sell.
- [minor] Template/search semantics differ: prototype searches across signal labels too (e.g. 'pixel' finds the template using it); shipped has no template search. — renderTplGrid includes preset signal labels in the haystack.
- [major] No match-mode (any/all) and per-condition toggles for composite signals. — Prototype matchModeHtml + condLinesHtml let users include/exclude composite conditions; shipped has nothing comparable.
- [minor] No Advanced raw-data drawer (operator + value inline-sentence filters, de-emphasized). — Prototype .rawexp drawer separates atomic DATA filters from signal cards.
- [major] GOAL working-state model not implemented: prototype chooses signals ONCE here and the market step reads them read-only; shipped derives filters from free text and never lets the user own/edit them before discovery. — Downstream (Build/market) consumes GOAL in the prototype; shipped passes only campaignId to /discover.
- [major] Design-system divergence: ad-hoc Tailwind slate/indigo utilities instead of the prototype's tokenized agency component classes (.goalsplit/.tplrow/.sigc/.badge-sig) and look. — No shared tokens/fonts from the prototype; visual language does not match.
- [minor] Reassurance + CTA copy/flow differ: prototype 'Choose your market →' with low-pressure messaging; shipped 'Save campaign' → /discover. — Different voice and next-step framing.

**Build spec:**

- 1. DECIDE the model: adopt the prototype's pick-a-bundle paradigm as the canonical Goal step. Keep the existing deterministic strategy.ts as the seed source for bundle contents and the cost estimate (do NOT throw it away). The free-text intake can remain as an optional secondary path ('Custom · describe it') but the PRIMARY UX must be the template grid + editable signal panel.
- 2. BUILD the data layer: create a TEMPLATES catalog (modules/campaign/goal-templates.ts) of the 13 named bundles (website, seo, ads, reviews, booking, social, content, fullservice, reactivation, email, custom) each = {key, icon, title, category, who, out, filters:[{signalKey, on, why, matchMode?, setting?}]}. Map every filter's signalKey to modules/signals/registry.ts. Add a SIG_META layer (means, pitch, recipe[], confidence 1–3, setting{type:strictness|mode|scale|platform|presence}) per signal — extend registry.ts entries rather than duplicating where possible.
- 3. BUILD a SIGNAL LIBRARY source (modules/signals/library.ts) grouping registry signals into the 8 prototype groups (★ Top composites, Reputation/Reviews, Website & Tech, Search/SEO, Profile & identity, Reachability & Contacts, Business qualifiers, AI research) with SIGNAL vs DATA classification and a default comparator/value per entry.
- 4. CREATE GoalPicker client component (modules/campaign/components/GoalPicker.tsx) replacing/ wrapping CampaignIntake: two-pane .goalsplit. LEFT = searchable template list (search across title/who/out/category/signal-labels), 'Your templates' + 'Templates' groups, per-row active-signal count, selected highlight without list reflow, always-visible Custom row, Back.
- 5. CREATE the editable signal-detail panel (GoalDetail.tsx): empty-state ('Pick a goal to see who it finds' + 3 tips); picked-state with editable goal name, Preset/Customized sub-label + live active count, Save-as-template (disabled until customized).
- 6. CREATE SignalCard.tsx: on/off switch, SIGNAL/DATA + confidence badges, means line, expandable 'How it works' (composite → match-mode any/all + per-condition toggles; single → recipe rows), locked-composite note, tuning control by setting type, Remove. Group cards by OUTCOME buckets with per-group value statements.
- 7. CREATE SignalLibraryModal.tsx (openable from '+ Add signal or raw data'): searchable, 8 collapsible groups (Top always open), rows with badges + description + '+ Add' that pushes into the working GOAL state with default op/val. Add an Advanced raw-data drawer for DATA-tier filters as inline-sentence rows.
- 8. IMPLEMENT working GOAL state (a useReducer or zustand store) as the single source of truth: clone template filters on pick (loadGoalFrom), markCustomized on any edit, persist saved templates (StrategyTemplate table — wire STRATEGY_TEMPLATE_SEEDS + a createTemplate action; add a deleteTemplate action).
- 9. WIRE cost: reuse modules/cost/pricing.ts to compute '~$X / business' from the active signals' required enrichments (mirror the existing estimatedCostUsd) and show it live as signals toggle.
- 10. WIRE downstream: on 'Choose your market →' / Save, persist the resolved signal set onto the Campaign (filters + signalWeights) and read it read-only on the market/discover step (replace the current free-text→/discover redirect with carrying the GOAL).
- 11. APPLY the agency design system: introduce shared tokens/component classes matching the prototype (or port the prototype CSS for .goalsplit/.tplrow/.sigc/.badge-sig etc.) instead of ad-hoc slate utilities; verify against .claude/rules/ui-ux-agency.md.
- 12. TESTS + validation: unit-test template→filters→cost mapping and classifyIntent fallback for Custom; browser-validate the two-pane flow (pick template → toggle/tune/add/remove → save) per .claude/rules/test-scenarios.md Scenario G (agency portal); keep registry keys as the single source of truth so templates never drift.

**Files:**

- `app/[locale]/(agency)/campaigns/new/page.tsx (modify — mount GoalPicker; keep auth shell)`
- `modules/campaign/components/CampaignIntake.tsx (modify/replace — becomes the optional free-text 'Custom' path, not the primary UI)`
- `modules/campaign/components/GoalPicker.tsx (create — two-pane goal screen)`
- `modules/campaign/components/GoalDetail.tsx (create — editable signal-detail panel)`
- `modules/campaign/components/SignalCard.tsx (create — per-signal card with toggle/tune/recipe/remove)`
- `modules/campaign/components/SignalLibraryModal.tsx (create — searchable grouped add-signal modal + raw-data drawer)`
- `modules/campaign/goal-templates.ts (create — the 13 TEMPLATES bundles mapped to registry keys)`
- `modules/signals/library.ts (create — 8-group signal library source + SIGNAL/DATA classification)`
- `modules/signals/registry.ts (modify — add SIG_META fields: means/pitch/recipe/confidence/setting per signal)`
- `modules/campaign/strategy.ts (modify — feed bundles + reuse classifier for the Custom path; keep deterministic core)`
- `modules/campaign/actions.ts (modify — add createTemplate/deleteTemplate + persist resolved GOAL signal set onto Campaign)`
- `modules/campaign/goal-state.ts (create — working GOAL reducer/store: loadGoalFrom, markCustomized, add/remove/toggle/tune)`
- `modules/cost/pricing.ts (reuse — live cost-per-business from active enrichments)`
- `prisma/schema.prisma (verify/extend — StrategyTemplate + Campaign columns for filters/signalWeights)`
- `app/[locale]/(agency)/campaigns/page.tsx (minor — link/CTA consistency with the new goal screen)`
- `modules/campaign/__tests__/strategy.test.ts (modify — cover template→filters→cost mapping)`

---

## Market — "Where should we look?" (metros × categories) (key: market) — DIVERGENT (~26h)

**Prototype:**
SCREEN: docs/portal-prototype.html `#view-build` (lines 7071-7306), shown via go('build'); on entry it calls renderBuildGoalRail() + renderMarketSelector() + renderSteps('build'). It is step 2 of a 5-step linear "Get leads" flow. STEPS registry = [goal→Goal, build→Market, preview→Preview, discover→Discover, enriching→Enrich]; a `.steps` stepper bar (`#steps-build`) renders the numbered progress at top. Breadcrumb = "Get leads ▸ Market".

HEADER: H1 "Where should we **look**?" (the word "look" wrapped in `.hl` accent span). Sub-copy: "Two ways in: target the exact cities & categories you want, or search everything we've already mapped."

LAYOUT: two-column CSS grid `grid-template-columns: 1.05fr 0.95fr` (left = selector card, right = goal rail card), each in a `.card`.

LEFT CARD — two-mode market selector via a `.seg2` segmented tablist (role=tablist) with two tabs:
• TAB A "🎯 Target markets" (default on) → `#mkt-body-target`
• TAB B "🔎 Search everywhere" → `#mkt-body-search`
setMarketMode(mode) toggles `.on` + aria-selected + body visibility and swaps the footer Continue button. State lives in MKTSEL = { mode:'target', cells:[{city:'Miami, FL', cat:'Med spa'}], refineCities:[], refineCats:[], leadCount:50 }.

MODE A · Target markets (#mkt-body-target): - Note copy: "Know your market? **Pick a city and a category, then add it** — repeat for each market you want. You choose exactly which pairings to map." - `.mkt-add` row = two combobox typeaheads + a primary "＋ Add market" button:
· City input (#mktCityInput, placeholder "City or metro") with custom dropdown (#mkt-drop-city). mktAddDrop('city') filters MKT_CITY_OPTS [["Miami, FL","metro · ~30km"],["Orlando, FL","metro"],["Tampa, FL","metro"],["New York, NY","metro"],["Los Angeles, CA","metro"]], shows label + grey `.meta` sub-label, plus a footer note MKT_CITY_NOTE "Type any US city — we map it to its metro (Brickell, Miami Beach → Miami)." Picking calls mktAddFill (fills input only; does NOT create a market).
· Category input (#mktCatInput, placeholder "Category of local business") with dropdown (#mkt-drop-cat) over MKT_CAT_OPTS [["Med spa","~420 in Miami"],["Dentist","~1,100"],["Plastic surgeon",""],["Dermatologist",""],["Hair salon",""]] + MKT_CAT_NOTE "Every Google category of local business — type to search all of them."
· "＋ Add market" (#mktAddBtn → mktAddMarket()): validates both filled (toast "Pick a city and a category"), enforces max 9 (toast "Up to 9 markets — keeps your spend predictable"), dedupes (toast "That market is already added"), pushes {city,cat} to MKTSEL.cells, clears inputs, toasts "Added · {cat} · {cityShort}". - "Your markets" list: eyebrow header (#mktCellsHead) that live-counts → "Your markets · N". `#mktCells` renders one `.cellrow` per market: a `.freshdot` status dot (rotates aging/fresh/new via mktFresh(i)), bold name "{cat} · {cityShort}", a `.note` "~{biz} local businesses" (mktEstCount: deterministic 120–460), and a removable "×" (mktRemoveCell, keyboard-accessible, min 1 enforced with toast "Keep at least one market"). renderMarketCells() also calls syncCellsFromMkt() to rebuild the downstream CELLS array (name/fresh/seen/biz/match/disc/enr) so Preview + Discover stay consistent. - Footer note: "Each market = one city × one category. Add up to 9 — keeps your spend predictable."

MODE B · Search everywhere (#mkt-body-search): - Mint callout (var(--mint-50)/--mint border): "Not sure where to start? Search Mapsly's existing index — businesses already discovered and enriched by us. No discovery, no waiting. You only pay for the leads you take." - Optional multi-select Category typeahead (#mktRefCatInput, max 3, chips in #mktRefCatChips) over MKT_CAT_OPTS; label "Category (optional)". - Optional multi-select City/metro typeahead (#mktRefCityInput, max 3, chips in #mktRefCityChips) over MKT_CITY_OPTS; label "City / metro (optional)"; note "Leave blank to search every category and metro." - "How many leads do you want?" lead-count chipset (#mktLeadChips) over LEAD_PRESETS [25,50,100,250,500,1000]; default 50; setLeadCount() updates state (selection-only — no cost shown on this page; cost moved to Preview). - Closing note: "These match your goal's signals and are pre-enriched — contacts, reviews and signals already in. Pay only for the ones you keep."

RIGHT CARD — read-only Goal/signals rail (`#buildGoalRail`, rendered by renderBuildGoalRail()): - Header eyebrow "Your goal" + a small "Edit signals" button → go('goal'). - Note: "These **expert signals** were set on the previous step — same set, every market you add. Edit them anytime." - Body shows GOAL.name (falls back to the website template for display only) with an optional "Customized" badge, "N active signal(s)" count, and one `.bgr-chip` per active filter, each carrying a SIGNAL or DATA badge (badge-sig / badge-data, driven by isSignalKind).

FOOTER: "← Back" (data-go=goal) + a mode-aware Continue button (#mktContinue): both modes route to go('preview'); label is "Preview & credits →" (target) or "Preview & cost →" (search).

DESIGN TOKENS: palette via CSS vars — --bg #f4f5fb, --ink #0f172a, --indigo #5b3df5 (+ -50/-100/-700), --mint #caecec / --mint-50 / --mint-ink; fonts: Space Grotesk (--display) for headings/names, Inter (--font) body, JetBrains Mono (--mono). Components use shared classes: .card, .seg2, .mkt-add, .combo/.opts, .cells/.cellrow/.freshdot, .pill.indigo, .chipset/.ch, .bgr-chip, .badge-sig/.badge-data, .eyebrow, .note, .btn(.primary/.sm), .steps.

**Current:**
Shipped at app/[locale]/(agency)/discover/page.tsx → renders modules/agency-portal/discover/components/DiscoverFlow.tsx (the "Market" equivalent). It is a single client component, NOT part of a multi-step flow (no Goal step exists in the agency routes; ls of app/[locale]/(agency)/ shows: agency-settings, campaigns, discover, setup, team, touchpoints, usage — no `goal`, no stepper).

Page: SYNC default export + Suspense body (auth → unauthorized() / no AgencyMember → redirect /home), loads metros from US_METROS (lib/geo/us-metros.ts — 37 metros) and up to 80 active BusinessCategory rows from Prisma. Header H1 "Discover" + sub "Pick metros and categories, preview the cost, and pull the live market. Cells discovered in the last 6 months are served from your data for $0." Container `mx-auto max-w-4xl p-6`.

DiscoverFlow content (DiscoverFlow.tsx):
• Section "1 · Metros (N selected · fixed radius per metro)" = a flat `flex-wrap` grid of ALL 37 metro buttons (pill toggles, multi-select). No typeahead, no search, no metro meta/radius detail.
• Section "2 · Categories (N selected)" = a flat `flex-wrap` grid of up to 80 category pill toggles. No typeahead/search, no per-category count.
• A bordered card showing cross-product math "N metros × M categories = K cells" + a "Preview cost" button calling preflightDiscoveryAction({cells}) (cells = full cartesian product of selected metros × categories). On quote: "{freshCount} cells fresh (served free) · {refetchCount} will fetch · {netCredits} credits". Inline error/success lines.
• CostQuoteBar.tsx: sticky bottom bar "This will cost $X · wallet $W → $Z", gate auto/confirm/approval ($2/$5 thresholds), "Run · $X" button → runDiscoveryAction({estimateId}) with needs_requote/quote_expired/needs_approval/insufficient_credits handling. (walletUsd is not passed from the page, so wallet line never shows.)

DESIGN: raw Tailwind utility classes only — slate/indigo/emerald/amber/red palette (text-slate-900, border-indigo-500, bg-indigo-50, etc.), default sans font. No CSS design tokens, no Space Grotesk/--display, no --mint, none of the prototype's shared component classes. Pills are `rounded-full border px-3 py-1`. Real backend wiring is solid (preflight/run actions, cost gate); the UX shell is the divergent part.

**Gaps:**

- [critical] No two entry modes. Prototype has a Target-markets / Search-everywhere segmented tablist (.seg2 + setMarketMode); shipped has only a single static select-and-price flow. The entire 'Search everywhere' mode (search Mapsly's pre-enriched index, optional refine cats/cities, lead-count presets, pay-per-kept-lead messaging) is absent. — This is a distinct product entry path (use existing index, no discovery, no wait) — its omission removes half the screen's intended functionality.
- [critical] No add-market builder. Prototype = City typeahead + Category typeahead + '＋ Add market' that composes explicit {city,cat} pairs into a 'Your markets' list (you choose exactly which pairings). Shipped = select metros and categories independently and the app auto-multiplies them into the full cartesian product. The mental model and control surface are fundamentally different. — Cartesian auto-expansion can silently create unwanted/expensive cells (e.g. 5 metros × 6 cats = 30 cells); the prototype's per-pair add prevents this and is the core UX intent.
- [critical] No 'Your goal' signals rail. Prototype's right card shows the active goal/signals (buildGoalRail: GOAL name, Customized badge, N active signals, per-filter SIGNAL/DATA chips) + 'Edit signals' link, reinforcing 'same signals applied to every market'. Shipped has no goal context anywhere on the page — and no Goal step exists in the agency routes at all. — Depends on a missing upstream Goal step; the rail is the connective tissue between Goal and Market in the prototype flow.
- [major] Not part of a stepped flow. Prototype renders a `.steps` stepper (Goal·Market·Preview·Discover·Enrich) and Back/Continue routing into Preview. Shipped 'Discover' is a standalone page with no stepper, no Back, and runs discovery inline rather than advancing to a Preview step. — Continue button label is also mode-aware ('Preview & credits →' vs 'Preview & cost →') in the prototype.
- [major] No typeahead/search for cities or categories. Prototype uses .combo/.opts comboboxes (filter-as-you-type over MKT_CITY_OPTS / MKT_CAT_OPTS, with meta sub-labels and helper notes, plus 'type any US city/category'). Shipped renders a fixed 37-button metro grid + up-to-80-button category grid with no search — does not scale and breaks at >~20 options. — Shipped already loads 80 categories as buttons; without search this is an unusable wall of chips.
- [major] No per-market freshness + estimate. Prototype 'Your markets' rows show a freshness dot (aging/fresh/new) and '~N local businesses' per pair. Shipped shows no freshness or business-count per cell on the selection screen (only an aggregate freshCount/refetchCount after pricing). — Freshness is the prototype's core value cue ('this cell is fresh → $0'); surfacing it pre-quote drives selection.
- [major] No 9-market cap / spend-predictability guardrails. Prototype enforces max 9 markets, min 1, dedupe, with explicit toasts. Shipped has no cap on selected metros/categories or resulting cells. — Unbounded cells defeats the prototype's 'keeps your spend predictable' promise.
- [major] Design system divergence. Prototype uses CSS-var palette (--indigo #5b3df5, --mint, --bg #f4f5fb, --ink) + Space Grotesk display font + shared classes (.card/.seg2/.cellrow/.freshdot/.bgr-chip/.pill/.chipset). Shipped uses ad-hoc raw Tailwind slate/indigo utilities and the default sans font with no shared tokens. — Per CLAUDE.md the agency palette is cool gray + indigo; the prototype's exact tokens/fonts/components are the source of truth and are not used here.
- [minor] Copy/voice divergence. Prototype H1 'Where should we look?' with .hl accent + two-ways-in sub-copy, mint index callout, 'pay only for the ones you keep', 'keeps your spend predictable'. Shipped uses terse 'Discover' / 'Pick metros and categories…' copy. The agency voice and value framing differ. — Copy should follow .claude/rules/ui-ux-agency.md + copy-voice.md and match the prototype's framing.
- [minor] Lead-count selection (Search-everywhere mode only) absent. Prototype LEAD_PRESETS [25,50,100,250,500,1000] chipset + 'How many leads do you want?'. Shipped has no lead-count selector. — Belongs to Mode B; selection-only here, cost confirmation happens on Preview.
- [minor] Wallet line never renders. CostQuoteBar supports walletUsd but DiscoverPage does not pass it, so the '· wallet $W → $Z' and insufficient/Add-credits states are dead. — Cheap fix while reworking — fetch agency wallet balance and pass it through.

**Build spec:**

- 1. Adopt the design tokens before rebuilding the screen: ensure the agency CSS vars (indigo, mint, bg, ink) and the Space Grotesk display font are available as Tailwind theme tokens / globals.css classes so this screen and the rest of the (agency) portal share one source of truth (matches .claude/rules/ui-ux-agency.md). Replace ad-hoc slate/indigo utilities accordingly.
- 2. Restructure /(agency)/discover into the prototype's stepped 'Get leads' flow OR, minimally, into the two-column Market layout. Add a stepper component (Goal·Market·Preview·Discover·Enrich) and Back/Continue routing. Decide with Viktor whether the full Goal step is in-scope (it does not exist yet) — if not, gate this gap as 'depends on Goal step'.
- 3. Convert the H1 to 'Where should we look?' (with accent on 'look') and the two-ways-in sub-copy; switch container to the two-column grid (~1.05fr / 0.95fr) of two cards.
- 4. Build the .seg2 segmented tablist with two modes (🎯 Target markets default / 🔎 Search everywhere); wire a `mode` state that toggles which body renders and which Continue label shows.
- 5. MODE A · build the add-market builder: a CityCombobox + CategoryCombobox (filter-as-you-type, meta sub-labels, helper notes) + '＋ Add market' button. Compose explicit {city, category} pairs into a `markets` state array. Add validation: require both, dedupe, max 9, toasts. Replace the cartesian auto-expansion in DiscoverFlow's `cells` useMemo with the user-curated pair list.
- 6. MODE A · render the 'Your markets · N' list: one row per pair with a freshness dot (from real cell freshness — query DiscoveryRegistry/cell membership), bold '{category} · {cityShort}', '~N local businesses' estimate (from registry totalAvailable or geocode estimate), and a remove × (keyboard-accessible, min 1).
- 7. MODE B · build the 'Search everywhere' body: mint index callout, optional refine-category multiselect (max 3 chips), optional refine-city multiselect (max 3 chips), and a lead-count chipset [25,50,100,250,500,1000] default 50. Wire to the existing-index search path (saved/pre-enriched leads) rather than fresh discovery.
- 8. Build the read-only Goal/signals rail (right card): 'Your goal' eyebrow + 'Edit signals' link, GOAL name + Customized badge, 'N active signals', per-filter SIGNAL/DATA chips. Source from the goal/signals state once a Goal step exists; until then, render the active signal set from the chosen template.
- 9. Move cost OFF this screen into a Preview step (prototype is selection-only here). Continue routes to Preview where preflightDiscoveryAction + CostQuoteBar run. If keeping inline pricing short-term, at minimum pass walletUsd to CostQuoteBar so the wallet/insufficient states work.
- 10. Re-point the data layer: metros should feed a searchable combobox (US_METROS), categories a searchable combobox (BusinessCategory, all not just 80) — both keyed by the registry that powers freshness + counts. Keep preflight/run server-action wiring intact; only change the input shape from cartesian to curated pairs.
- 11. Validate per .claude/rules/browser-testing.md: agency auth, 380px mobile (cards stack, .mkt-add reflows), keyboard add/remove, no console errors, Lighthouse mobile ≥90 / a11y ≥95; copy-reviewer + ux-reviewer-agency pass.

**Files:**

- `modules/agency-portal/discover/components/DiscoverFlow.tsx (rewrite: two-mode selector, add-market builder, goal rail, remove cartesian auto-expansion)`
- `app/[locale]/(agency)/discover/page.tsx (rewrite header/copy/layout to two-card grid; pass wallet balance + goal/signals + freshness data; add stepper)`
- `modules/agency-portal/discover/components/MarketModeTabs.tsx (new · .seg2 segmented tablist)`
- `modules/agency-portal/discover/components/AddMarketBuilder.tsx (new · City+Category comboboxes + Add market + 'Your markets' list)`
- `modules/agency-portal/discover/components/MarketCombobox.tsx (new · reusable typeahead over metros / categories)`
- `modules/agency-portal/discover/components/SearchEverywherePanel.tsx (new · Mode B: refine multiselects + lead-count chipset + index search)`
- `modules/agency-portal/discover/components/GoalRail.tsx (new · read-only 'Your goal' signals panel + Edit signals)`
- `modules/agency-portal/discover/components/MarketStepper.tsx (new · Goal·Market·Preview·Discover·Enrich progress)`
- `modules/agency-portal/discover/components/MarketRow.tsx (new · freshness dot + name + ~N businesses + remove ×)`
- `app/globals.css (add/confirm agency CSS-var tokens: --indigo, --mint, --bg, --ink + Space Grotesk display font) `
- `tailwind config / theme tokens (map the agency palette + display font so components use shared tokens, not ad-hoc utilities)`
- `modules/discovery/actions.ts (adjust preflight/run input to accept curated {city,category} pairs + optional Mode-B index-search params; add freshness/estimate query for the selection screen)`
- `modules/agency-portal/discover/__tests__/discover-flow.test.tsx (new · add/remove/dedupe/max-9, mode switch, pair-based cells)`
- `messages/en.json (new market-step i18n keys for the rebuilt copy, per i18n.md)`

---

## Preview — "Before you spend — here's the market" (key: preview) — DIVERGENT (~22h)

**Prototype:** STEP 3 of the discover funnel (view-preview, docs/portal-prototype.html lines 7308-7325). Header: H1 "Before you spend — <span class=hl>here's the market</span>"; sub copy "Here's an estimate of what this will find and cost — nothing is charged until you confirm. New or aging markets are mapped live, so their numbers are approximate (~)." Body (#prevBody) rendered by renderPreview() which branches on MKTSEL.mode: TARGET mode -> renderPreviewTarget (lines 17193-17351); SEARCH mode -> renderPreviewSearch (lines 17354-17430). Footer is a separate sticky dark "costbar" (#prevCostbar).

TARGET MODE (renderPreviewTarget) composes 5 blocks:

1. FRESHNESS CALLOUT (top): chooses one of three honest states from the cell mix — amber 🕗 "Mixed markets — K already mapped (estimates from cache), N mapped live on Discover (approximate)." / amber 🆕 "New markets — we map them live on Discover, so every number here is an estimate." / green ✅ "Recently mapped — numbers are from our latest snapshot." (cellIsKnown vs cellIsNew partition CELLS).
2. FOUR KPI CARDS (.grid.g4 of .stat tiles, all values count-up animated via runCountUps, prefixed with ~ to signal estimate): a) "Local businesses in market" = ~sum(c.biz), detail "across N cells"; b) "Have contacts" = ~74%, detail "est. reachable by email/phone/social — from similar markets"; c) "Active on Google" = ~round(totBiz\*0.45), detail "recent reviews, open now"; d) "Match your signals" = ~sum(known cells' match) in indigo (or em-dash "—" when all cells are brand-new, detail "computed after discovery"), detail "your S signals applied (estimate) [· + new cells est. after discovery]". Below tiles a .note: "Estimates — confirmed live on Discover before you spend on enrichment."
3. PER-CELL CREDIT MATRIX (.card with H2 "Per-cell credit matrix" + a "＋ Add / edit markets" button). A horizontally-scrollable table.matrix, columns: Market | Freshness | Businesses | Discover | Enrich. Each row: cell name; a freshness label with a colored dot (.freshdot .fresh=green ●/.aging=amber ◐/.stale=red ○/.new=faint ○) + text ("● fresh"/"◐ aging"/"○ stale"/"○ new"); ~biz count; Discover credits with coin icon (c.disc, exact-ish); Enrich credits "~enr" with coin icon (always approximate, = c.enr or max(1, round(biz\*0.18))). tfoot totals row: "Total (N cells)" | (blank) | ~totBiz | coin totDisc | coin ~totEnr. Note under table: "Enrich credits are approximate — they scale with the real business count we find on Discover."
4. TWO-COLUMN SUMMARY (.grid 1.1fr/.9fr): LEFT card "What you picked" — Goal name, Markets ("N cells of local businesses"), then signals grouped BY RESEARCH (RESEARCH_ORDER), each group shows research label + source (.src) and the active signal names as indigo pills; "✎ Change signals/filters" button. RIGHT card "What it costs" — line ① "Discover N markets" = coin totDisc with note "The only exact-ish cost — runs first. ~30 sec per cell."; line ② "Enrich — per research" = coin ~totEnrResearch with a per-research sub-breakdown (each research label + source, cost "~X cr" or "computed · free" for free-basis researches; cost basis: biz-basis = unit×estTargets, cell-basis = unit×cellCount); "Estimated total" = coin ~(totDisc+totEnrResearch); green callout 🪙 "Balance: <fmtCredits(WALLET_CREDITS)> credits."
5. STICKY COSTBAR FOOTER (#prevCostbar, .costbar dark indigo-glow pill, lines 2007-2053): .big with coin icon "Discover N markets — totDisc credits"; .small "Only Discover runs now — you confirm enrichment after, with real counts."; spacer; "← Back" (data-go=build); "Discover →" primary big (data-go=discover). Crucially the footer prices ONLY discovery — enrichment is confirmed in a later step with real counts.

SEARCH MODE (renderPreviewSearch, lines 17354-17430): mint ⚡ callout "These are ready, pre-enriched leads…"; 3 KPI cards (.grid.g3): "Ready leads"=want, "Already enriched"=100% (mint), "Match your signals"=~want (indigo); a "Your fill plan" card with a 2-col table.matrix (Market | Leads from this cell) deterministically filling want across pre-mapped cells best-match-first + total; two-col summary (What you picked / What it costs at RATE_PER_LEAD=2 credits/lead, balance → after, plus an over-budget amber callout with a "Top up" path); sticky costbar "Get want ready leads — X credits" + "Get want leads →".

Design tokens: cream/agency surfaces, --display (Fraunces) for big numerals, .stat .v 32px display weight 600 with letter-spacing, coin icon spans, count-up animation as brand signature, freshness dot color semantics (green/amber/red/faint), dark gradient costbar pinned bottom.

**Current:** Shipped preview is a single React form-flow, not a dedicated preview screen. Route app/[locale]/(agency)/discover/page.tsx mounts <DiscoverFlow> (modules/agency-portal/discover/components/DiscoverFlow.tsx). DiscoverFlow does metro/category chip selection inline, then "Preview cost" calls preflightDiscoveryAction({cells}) and stores a QuoteState {estimateId, netUsd, netCredits, freshCount, refetchCount}.

The entire "preview" is ONE sentence (DiscoverFlow.tsx lines 202-207): "{freshCount} cells fresh (served free) · {refetchCount} will fetch · <b>{netCredits} credits</b>". There are NO KPI cards (no businesses-in-market, no have-contacts, no active-on-Google, no match-your-signals), NO per-cell credit matrix (no Market/Freshness/Businesses/Discover/Enrich table), NO per-cell freshness dots, NO freshness callout describing the mix, NO "what you picked / what it costs" two-column summary, and NO per-research enrichment breakdown.

The sticky footer is CostQuoteBar.tsx (modules/agency-portal/discover/components/CostQuoteBar.tsx). It is generic Tailwind (slate/indigo, white bg, sticky bottom), copy "This will cost $X.XX · $Y saved from fresh cache · wallet $A → $B" with a gate pill and a single "Run · $X.XX" button. It prices in DOLLARS (netUsd.toFixed(2)) and runs discovery immediately — it does NOT scope the spend to "Discover only" with enrichment confirmed later. No Fraunces display font, no count-ups, no coin icon, no dark gradient pill, no "Discover N markets — X credits" framing, no "← Back / Discover →" stepper navigation.

The funnel framing also differs: prototype is a 4-step wizard (goal → build/markets → preview → discover) with a steps indicator; shipped is a single page where selection + preview + run all live together. The richer enrichment/freshness UI that the prototype shows in this screen does partly exist elsewhere shipped (EnrichPanel.tsx, FreshnessChip.tsx, VsCellBar.tsx in the same module) but is NOT used on the pre-flight preview — they sit in the post-discovery raw-list/enrich flow.

**Gaps:**

- [critical] No KPI cards — the 4 estimate tiles (Local businesses in market ~N, Have contacts ~74%, Active on Google ~N, Match your signals ~N) are entirely absent; shipped shows only a credit count. — This is the headline value of the screen ('here's the market'). Prototype lines 17307-17312.
- [critical] No per-cell credit matrix — the Market | Freshness | Businesses | Discover | Enrich table (with totals tfoot) does not exist; shipped collapses every cell into one aggregate netCredits number. — Per-cell transparency is the core of the 'before you spend' promise. Prototype lines 17314-17327.
- [major] No per-cell freshness dots/labels — shipped has only an aggregate 'freshCount fresh / refetchCount will fetch'; no green/amber/red/faint dot per cell, no fresh/aging/stale/new labels. — FreshnessChip.tsx exists in the module but is not wired into preview. Prototype .freshdot CSS lines 1156-1167; labels at 17235-17240.
- [major] No freshness mix callout — the top amber/green honest-state banner ('Mixed markets…/New markets…/Recently mapped…') is missing. — Sets expectation that numbers are estimates. Prototype lines 17204-17218, 17306.
- [major] Pricing is in dollars, not credits — CostQuoteBar shows '$X.XX' and 'wallet $A → $B'; prototype speaks credits throughout ('N credits', coin icon, balance in credits). — Unit mismatch with the prototype's credit economy and the shipped Usage/wallet page. CostQuoteBar.tsx lines 35,46; netCredits IS available on the quote but unused in the bar.
- [major] Footer scopes the wrong spend — shipped 'Run · $X' runs discovery+commit immediately; prototype footer prices ONLY discovery ('Discover N markets — X credits', enrichment confirmed later with real counts). — Changes the spend model the user is consenting to. Prototype lines 17346-17350, footer .small copy.
- [major] No 'What you picked / What it costs' summary, including signals-grouped-by-research and the ①Discover/②Enrich-per-research cost breakdown. — Prototype lines 17328-17345. Requires research grouping (RESEARCHES/RESEARCH_ORDER) + per-research cost basis logic.
- [major] Design language divergent — no Fraunces display numerals, no count-up animation, no coin icon, no dark indigo-gradient sticky pill; shipped uses plain slate Tailwind tiles/strip. — Prototype .stat/.costbar CSS lines 2007-2120; runCountUps brand signature line 17189.
- [minor] Header/copy mismatch — shipped header is 'Discover' + a generic paragraph at page level; prototype is H1 'Before you spend — here's the market' with the estimate-disclaimer sub. — page.tsx lines 78-83 vs prototype lines 7315-7320.
- [minor] No stepper / Back navigation — shipped is single-page; prototype preview is a wizard step with steps indicator and '← Back / Discover →'. — Prototype #steps-preview line 7314, footer nav 17349-17350.
- [major] SEARCH (ready-leads) preview mode is entirely unbuilt — no ready-leads KPIs, fill-plan table, or per-lead credit gate. — Only relevant if the shipped funnel supports the search/ready-leads mode. Prototype renderPreviewSearch lines 17354-17430.
- [critical] No estimate-data source — the KPI/matrix numbers (biz count, 74% reachable, 45% active, signal match, per-cell enrich estimate) need a preflight estimate payload that preflightDiscoveryAction does not currently return. — Server action returns only {netUsd, netCredits, freshCount, refetchCount}; must be extended to per-cell estimates + market KPIs.

**Build spec:**

- 1. Extend the preflight server action (modules/discovery/actions.ts preflightDiscoveryAction) to return a richer PreflightPreview payload: per-cell rows [{name (category·metro), freshness: fresh|aging|stale|new, bizEstimate, discoverCredits, enrichCreditsEstimate}], market KPIs {totalBiz, haveContactsPct (default ~74 from cohort), activeOnGooglePct (~45/0.45), matchCount (sum of known-cell matches, or null when all-new)}, freshness mix {knownCount, newCount}, and a research cost breakdown [{researchKey, label, source, cost, free}]. Keep returning netCredits + estimateId. Use cached cell snapshots where present (fresh/aging) and mark new/stale cells as estimate-only.
- 2. Add a shared visual token layer for the agency credit economy if not already present: a CoinIcon component, a count-up hook (useCountUp) reused from any existing dashboard, Fraunces display class for stat values, and freshness-dot color tokens (green/amber/red/faint). Put in modules/agency-portal/discover/components or a shared ui/ location.
- 3. Build PreviewKpiCards.tsx — 4 .stat-style tiles (Local businesses ~N / Have contacts ~74% / Active on Google ~N / Match your signals ~N or em-dash) with ~ prefix, count-up, and the exact detail strings from the prototype. Render the 'Estimates — confirmed live on Discover…' note beneath.
- 4. Build FreshnessMixCallout.tsx — derive amber-mixed / amber-new / green-recent state from knownCount/newCount and render the matching icon + copy verbatim from prototype lines 17209/17213/17217.
- 5. Build PreviewCreditMatrix.tsx — scroll-x table with columns Market | Freshness (FreshnessChip dot+label) | Businesses (~) | Discover (coin) | Enrich (~coin), per-cell rows + totals tfoot, plus the 'Enrich credits are approximate…' note and a '＋ Add / edit markets' affordance.
- 6. Build PreviewSummary.tsx — two-column 'What you picked' (Goal, Markets, signals-grouped-by-research as indigo pills) and 'What it costs' (①Discover note, ②Enrich-per-research sub-breakdown, Estimated total, balance callout in credits). Reuse the research grouping/cost-basis logic ported from the prototype (RESEARCHES/RESEARCH_ORDER, biz/cell/free bases).
- 7. Rework CostQuoteBar.tsx (or add a credit-mode variant) to: speak credits not dollars, use the dark indigo-gradient sticky pill style, show 'Discover N markets — X credits' + 'Only Discover runs now — you confirm enrichment after, with real counts.', and render '← Back' + 'Discover →' actions. Keep the gate/approval logic but express thresholds in credits. Preserve dollar mode for other call sites if any depend on it.
- 8. Recompose DiscoverFlow.tsx: after preview() succeeds, replace the single-sentence quote line (lines 202-207) with FreshnessMixCallout + PreviewKpiCards + PreviewCreditMatrix + PreviewSummary, and swap the footer to the credit-mode CostQuoteBar driven by the new payload. Wire 'Discover →' to runDiscoveryAction so the footer scopes to discovery only.
- 9. Update header copy in page.tsx to the prototype H1/sub ('Before you spend — here's the market' + estimate disclaimer), or move the header into the preview state so the selection state keeps its own heading. Add a lightweight steps indicator if the wizard framing is desired.
- 10. (Optional, if ready-leads mode is in scope) Add a search-mode branch rendering the ready-leads KPIs + fill-plan table + per-lead credit gate per renderPreviewSearch.
- 11. Validate: browser-test the discover route as an agency member — preview renders 4 KPI cards, per-cell matrix with freshness dots, credit-denominated sticky footer; verify count-ups, mobile 380px layout, and that no $ values appear. DB-assert preflight payload shape. Snapshot the per-research cost math in a unit test.

**Files:**

- `modules/agency-portal/discover/components/DiscoverFlow.tsx`
- `modules/agency-portal/discover/components/CostQuoteBar.tsx`
- `modules/agency-portal/discover/components/PreviewKpiCards.tsx`
- `modules/agency-portal/discover/components/FreshnessMixCallout.tsx`
- `modules/agency-portal/discover/components/PreviewCreditMatrix.tsx`
- `modules/agency-portal/discover/components/PreviewSummary.tsx`
- `modules/agency-portal/discover/components/FreshnessChip.tsx`
- `modules/agency-portal/discover/preview-estimate.ts`
- `modules/discovery/actions.ts`
- `app/[locale]/(agency)/discover/page.tsx`

---

## Discover — raw list "Found ~120 local businesses" (discover-rawlist) — DIVERGENT (~16h)

**Prototype:** The prototype's Discover screen (docs/portal-prototype.html lines 7330-7466, driven by renderDiscover() at line 17441 + showDiscoverError() at 17515) is a vertical, single-column "raw market" page wrapped in a 4-step→5-step wizard. Top to bottom:

1. STEPPER (`<div class="steps" id="steps-discover">`, rendered by renderSteps()): horizontal pill stepper of STEPS = Goal · Market · Preview · Discover · Enrich. Done steps green ✓, current ("Discover") indigo, future muted, with `.line` connectors. CSS at lines 2261-2301.

2. H1 (`#discoverH1`): `Found <span class="hl">~412 local businesses</span>` (the count and "~N" come from CELLS; appends "across M markets" when M>1). `.hl` is the indigo highlight.

3. Sub (`p.sub`): exact copy — "This is the **raw market we found on Google & Maps** — names, categories, ratings, review counts. It's not yet enriched, so your signals and contacts aren't here yet. Enrichment is the next step."

4. ERROR CALLOUT (`#discoverErr`, `class="callout amber hidden"`, role=alert): hidden by default, revealed by showDiscoverError(). Copy: "⚠️ **DataForSEO 503 · upstream issue.** The map provider is temporarily unavailable. No credits were spent. Retry in 2 min — or check status.dataforseo.com." with a "↻ Retry" `.btn.sm` that hides the callout + toasts. CSS .callout.amber lines 2122-2136 (amber border #f1dba6, amber-50 bg, amber text).

5. 4 KPI STAT CARDS (`<div class="grid g4 section">` → four `.stat` tiles). Each tile = `.k` label (11.5px muted 600) + `.v` value (Space Grotesk display, 32px, 600, -0.02em tracking) + `.d` descriptor (11.5px muted). The four, in order:
   - Discovered = N (`#discStatTotal`), descriptor "whole market"
   - Have a website = ~86% of N (`#discStatWeb`), descriptor "86% — from the listing"
   - Active on Google = ~45% of N (`#discStatActive`), descriptor "recent reviews · open now"
   - Owner-claimed = ~78% of N (`#discStatClaimed`), descriptor "78% verified listings"
     All percentages are deterministic fractions of the discovered count (webPct=86, activePct=45, claimedPct=78), explicitly NOT random and knowable from the listing pull with no enrichment. g4 = 4 equal cols, collapses to 1col under 880px. .stat = white card, 1px var(--line) border, 16px radius, shadow-sm.

6. RAW MARKET TABLE in a `.card.section`: section header `<h2 id="discMarketTitle">The market — 412 businesses` followed by an inline `.note` "Raw discovery data — your signals apply after enrichment." Table inside `.scroll-x` with exactly 5 columns: **Business · Category · Rating · Reviews · Website**. Rows from fillTables() (line 13109) render `DISCOVER.slice(0,6)`: Business cell uses `td.biz` (name 600-weight + `.addr` sub-line 11.5px faint = street address), Category plain, Rating as "★ 4.4", Reviews plain count, Website as "✓" or "—". Base table styling (lines 1170-1199): uppercase 11px letter-spaced faint-700 `th`, 12px `td`, hover row tint. Below table a `.note` (`#discTableNote`): "Showing 6 of 412 · raw discovery data. Enrich to apply your signals and reveal contacts."

7. TIP NOTE (`#discTip`, `.note.section`): "💡 Tip: narrow with the free discovery filters first (rating, reviews, website, open) — then enrich only those."

8. STICKY ENRICH FOOTER (`<div class="costbar">`, CSS 2007-2025): pinned bottom, **dark** (#0d1020 with an indigo radial-gradient glow at top-left), 18px radius, big -8px shadow, light text. Left block: `.big` (Space Grotesk 20px 600) = coin icon + "Enrich the market — 412 businesses" + `.small` "· ~494 credits" (credits ≈ N×1.2). Below it `.small` (12px #aab2cc) subcopy: "We apply your 5 signals to the enriched data and reveal your matches + contacts. ~6 min. You can close this page — we keep working and email you." (signal count from GOAL.filters; minutes ≈ N/70). Right: `.btn.primary.big` "Enrich →". Credit-aware: when credits > wallet, button becomes "Add credits →" routing to billing and subcopy switches to "Not enough credits — this needs ~N, you have X. Add credits to run it." Page has `padding-bottom:120px` to clear the sticky bar.

Design language: cool-gray/indigo agency palette via CSS custom props (--bg #f4f5fb, --ink #0f172a, --muted #64708c, --faint #97a1bb, --line #e6e9f3, --indigo #5b3df5, --indigo-50 #eeebff). Fonts: Inter body, **Space Grotesk display** (all big stat values + costbar headline), JetBrains Mono for numeric. Layout is one narrow reading column, KPI-first, with the table as a teaser (only 6 of N shown) and the dark sticky CTA as the single dominant action.

**Current:** Shipped at app/[locale]/(agency)/discover/[discoveryId]/page.tsx (Suspense-wrapped async body, auth + AgencyMember gate, loads getRawListSummary + getRawList(take:50) + saved lists + getResearchOverview) rendering modules/agency-portal/discover/components/RawListTable.tsx, ReachabilityBanner.tsx, CohortCard, CellStandardsPanel, Sparkline, FreshnessChip.

It is a DIFFERENT screen than the prototype — a real, data-wired, denser tool with extra sections the prototype doesn't have, but missing the prototype's KPI-first framing and signature components:

- Header (page.tsx 168-176): plain `<h1>{discovery.name ?? "Raw list"}</h1>` + a mono sub "N cells · N businesses · status …". NO "Found ~N local businesses" hero, NO `.hl` highlight, NO sub paragraph explaining "raw market".
- NO stepper. The wizard chrome (Goal·Market·Preview·Discover·Enrich) is entirely absent.
- NO 4 KPI stat cards (Discovered / Have a website / Active on Google / Owner-claimed). Confirmed absent everywhere (grep found zero hits). Instead the page leads with a 3-up grid of CohortCard tiles (pitch/count/reachable — a different concept), a cell-freshness chip row, a CellStandardsPanel + a review-count Sparkline, and an optional "Saved lists" grid. These are net-new "comprehension layer" sections (§4.19/4.20) not in the prototype.
- ReachabilityBanner.tsx (replaces the prototype's plain-fact framing): white rounded card with a one-line "N businesses · N reachable · N phone-only · N unreachable (hidden)" + a thin 3-segment donut/bar + a "Show N hidden — why?" link. This is reachability-centric framing the prototype's KPI cards do NOT have; conversely the prototype's website/active/claimed framing is absent.
- RawListTable.tsx (the table): 10 columns — select checkbox · Business(name+category mono) · Reach(chip) · Rating · Reviews · Web(●/○) · Phone · Metro · Enrichment(9-dot strip) · Open→. This is a power-table (multi-select, client filter chips for hasWebsite/minRating/reachability, show-hidden toggle, Load-more pagination), NOT the prototype's 5-col teaser. Address sub-line is replaced by category; the prototype's "★ rating" and "✓/—" website glyphs differ.
- Enrich CTA: there is NO sticky dark costbar. Enrich is only reachable AFTER selecting rows — a sticky white/blur bulk bar appears (RawListTable 448-493) with "N selected · Clear · [list name input] · Save as list · Enrich selected (N)", opening the EnrichPanel slide-over. The prototype's always-present "Enrich the market — N businesses · ~X credits" whole-market CTA with the dark gradient and minutes/credit-aware copy is gone.

Design approach: raw Tailwind utility classes throughout (bg-white, border-slate-200, text-slate-\*, indigo-600 accents, rounded-xl). NO shared design tokens, NO Space Grotesk display font, NO costbar gradient — agency layout sets up no next/font display face (grep found none). Visually generic slate/indigo card UI, not the prototype's tokenized cool-gray + Space-Grotesk-display look.

**Gaps:**

- [critical] 4 KPI stat cards (Discovered / Have a website / Active on Google / Owner-claimed) — the prototype's defining KPI-first header — are entirely absent. No equivalent of webPct/activePct/claimedPct deterministic fractions surfaced. — This is the headline framing of the screen; replaced by unrelated CohortCard/reachability tiles. Prototype lines 7371-7392, renderDiscover 17448-17472.
- [critical] Sticky dark 'Enrich the market — N businesses · ~X credits' costbar is missing. Enrich is gated behind row selection (a white bulk bar), so the whole-market enrich CTA + credit/minutes copy + credit-aware 'Add credits →' fallback never appears. — Prototype .costbar 7450-7465 + renderDiscover 17485-17512. The dominant single CTA of the screen is structurally different.
- [major] Hero H1 'Found ~N local businesses' (with indigo .hl highlight and 'across M markets') replaced by a plain '{name}/Raw list' + mono meta line. The 'raw market we found on Google & Maps … not yet enriched' sub paragraph is absent. — Prototype 7334-7341 + renderDiscover 17456-17460. Loses the orientation/teaser narrative.
- [major] Wizard stepper (Goal·Market·Preview·Discover·Enrich) not rendered on the shipped page. — Prototype #steps-discover + renderSteps 12232. Shipped page has no flow context that this is step 4 of an enrich wizard.
- [major] No shared design tokens or Space Grotesk display font. Shipped uses generic Tailwind slate/indigo utilities; big numbers are not in the display face; the costbar gradient/dark surface is absent. — Prototype --display Space Grotesk on .stat .v and .costbar .big; tokens --indigo/--line/--muted etc. Shipped agency layout registers no display font.
- [major] Raw market table shape diverges: shipped is a 10-col power-table (select/Reach/Phone/Metro/9-dot Enrichment/Open) vs prototype's 5-col teaser (Business+address / Category / ★Rating / Reviews / ✓Website showing only 6 of N). — This may be an intentional product upgrade, but it abandons the prototype's 'teaser → enrich whole market' model. Decide which is canonical. Prototype 7414-7430 + fillTables 13109.
- [minor] Reachability framing differs from prototype: shipped leads with a reachability banner (reachable/phone-only/unreachable hidden) where the prototype framed the market via website/active/claimed KPIs. The two framings should be reconciled, not duplicated. — ReachabilityBanner.tsx. Banner is a reasonable addition but doesn't satisfy the KPI-card gap.
- [minor] Error state: prototype has the amber DataForSEO-503 callout with Retry; shipped detail page has no inline upstream-error/retry affordance on the raw list. — Prototype #discoverErr 7343-7369 + showDiscoverError 17515. Lower priority for a detail page that loads from DB.
- [minor] Table footer note + tip note ('Showing 6 of N…', '💡 Tip: narrow with the free discovery filters first…') absent. — Prototype 7427-7448. The shipped filter chips partly serve the tip's intent.

**Build spec:**

- 1. Establish agency design tokens + display font so the screen can match the prototype palette. Add the cool-gray/indigo CSS custom props (--bg #f4f5fb, --ink, --muted, --faint, --line, --indigo #5b3df5, --indigo-50/100/700) and register Space Grotesk via next/font in the (agency) layout, exposing a `font-display` utility. Map prototype classes to Tailwind tokens or add a small shared style module so .stat/.costbar visuals are reproducible.
- 2. Add the 4 KPI stat cards as a new server component KpiStatCards (or inline grid) above the table: grid-cols-4 (1col <880px), each = label / big display-font value / descriptor. Wire to summary: Discovered = summary.total; Have a website = count with website (derive from rows/summary — prefer a real getRawListSummary field over the prototype's flat 86%); Active on Google (recent reviews + open) and Owner-claimed = real DB-derived counts if available, else deterministic fractions with honest descriptors. Match copy: 'whole market', 'N% — from the listing', 'recent reviews · open now', 'N% verified listings'.
- 3. Replace the plain header with the prototype hero: H1 'Found ~{summary.total} local businesses' (+ 'across {cellCount} markets' when >1) with an indigo .hl span, and the 'raw market we found on Google & Maps … not yet enriched' sub paragraph.
- 4. Add the wizard stepper component (Goal·Market·Preview·Discover·Enrich) with current='Discover', done states ✓, line connectors — matching .steps CSS. Render it at the top of the page if this view is part of the enrich wizard flow.
- 5. Build the sticky whole-market enrich costbar (StickyEnrichBar): dark #0d1020 surface + indigo radial-gradient glow, sticky bottom, page gets pb-[120px]. Left: coin icon + 'Enrich the market — {total} businesses · ~{credits} credits' (credits derived from real pricing, not N×1.2 guess) + subcopy with signal count + est. minutes + 'you can close this page, we email you'. Right: 'Enrich →' primary. Make it credit-aware: when wallet < cost, swap to 'Add credits →' routing to billing with the shortfall copy. Open the existing EnrichPanel scoped to the whole market (or selected subset if any).
- 6. Reconcile reachability vs KPI framing: keep ReachabilityBanner but demote it below the KPI cards (or fold reachable-count into the KPI strip) so the two don't compete. Keep the 'Show N hidden — why?' link wired to the table's show-hidden toggle (currently onShowHidden is not passed in page.tsx — wire it).
- 7. Decide the table model. If the prototype teaser is canonical: add a 5-col compact mode (Business+address / Category / ★Rating / Reviews / ✓Website) showing first 6 with the 'Showing 6 of N' note + 'Enrich to reveal' framing, and move the 10-col power-table behind the enriched/list views. If the power-table is canonical (likely, given multi-select/save-as-list already shipped): keep it but restore the address sub-line, ★-prefixed rating, and the footer/tip notes; ensure the costbar (step 5) supplies the whole-market CTA the prototype intended.
- 8. Add the amber DataForSEO-503 error callout + Retry affordance (or wire to the page's error.tsx) so upstream failures surface with 'No credits were spent' messaging.
- 9. Add the table footer note ('Showing N of M · raw discovery data. Enrich to apply your signals and reveal contacts.') and the 💡 tip note about narrowing with free discovery filters first.
- 10. Browser-validate at desktop + 380px per .claude/rules/browser-testing.md: KPI grid collapses to 1col, costbar stays sticky and legible on mobile, stepper wraps, no horizontal scroll; capture screenshots.

**Files:**

- `app/[locale]/(agency)/discover/[discoveryId]/page.tsx`
- `modules/agency-portal/discover/components/RawListTable.tsx`
- `modules/agency-portal/discover/components/ReachabilityBanner.tsx`
- `modules/agency-portal/discover/components/DiscoverKpiCards.tsx (new)`
- `modules/agency-portal/discover/components/EnrichCostBar.tsx (new)`
- `modules/agency-portal/discover/components/DiscoverStepper.tsx (new)`
- `modules/agency-portal/discover/components/DiscoverErrorCallout.tsx (new, optional)`
- `modules/discovery/raw-list.ts (extend getRawListSummary with website/active/claimed counts)`
- `app/[locale]/(agency)/layout.tsx (register Space Grotesk display font + design tokens)`
- `app/globals.css or a shared agency tokens module (CSS custom props for cool-gray/indigo palette)`

---

## Enriching — progress screen (key: enriching) — MISSING (~12h)

**Prototype:** A dedicated full-page progress view (`<section id="view-enriching">`, docs/portal-prototype.html L7469-7521) shown immediately after the user authorizes an enrichment run. Structure, top to bottom:

1. HERO H1: "Enriching <span class=hl>61 leads</span>…" (the count is the run's lead total; `.hl` = indigo highlight).
2. SUB paragraph (the background-OK message, the core of this screen): "You can **close this page** — work continues on our servers and we'll email you when it's done (~6 min). Track it anytime from the Jobs tray." Bolds "close this page"; states an ETA and points at the Jobs tray.
3. A `.editorial` card containing:
   a. A header row (flex space-between, 13px): left `<b id="enrPct">38%</b>`, right `<span class="note">23 of 61 leads · ~3 min left</span>` — i.e. percent + "X of N leads · ~M min left".
   b. A progress bar: `<div class="bar"><i id="enrBar" style="width:38%"></i></div>`. `.bar` = 9px tall, radius 6, track #eef1f6; `.bar > i` = indigo→violet gradient (linear-gradient(90deg,#5b3df5,#9d7bff)), width-transition 0.4s.
   c. A `.joblist` (flex column, gap 9px) of SIX named stage rows, each `.job` = 12.8px text, 9px/12px padding, 1px border, radius 10, white bg, with a leading status glyph:
   - DONE rows: green `.check` (16px green circle, white "✓") + label. Row 1: "Mapped market & applied filters — 61 matches". Row 2: "Contacts extracted — 52 reachable, 9 hidden".
   - IN-PROGRESS row: `.spin` (15px indigo spinner, 1s rotate) + label with a per-stage X/N. Row 3: "Website & tech signals + Lighthouse — 23/61".
   - PENDING rows: empty 16px spacer glyph + `style="opacity:.5"`. Row 4 "Reviews & reputation signals"; Row 5 "Expert layer (med-spa playbook)"; Row 6 "Draft first touches".
4. ACTION row (margin-top 18px): primary button "See the leads workbench →" (`onclick=openWorkspace(null)` — jumps into the workbench while the run continues) + secondary button "Close — notify me" (`data-go="welcome"` — leaves the screen, relying on email + Jobs tray).

Behavior (prototype JS, L18791-18807): a MutationObserver detects the view becoming visible and animates `enrBar`/`enrPct` from 38% to 100% in +4%/500ms steps (demo-only fake progress). Real impl would bind these to actual run progress.

The six stages map to the real enrichment families/pipeline: market/filters (discovery), contacts, website+tech+Lighthouse, reviews/reputation, expert playbook layer (category-specific), draft touches (touchpoints). The screen's job: make a multi-minute server job feel safe to walk away from, while showing which stage is live and giving an immediate "keep working" escape hatch.

**Current:** No dedicated enriching/progress screen exists in the shipped agency portal. There is no `view-enriching` analog, no route segment for it (app/[locale]/(agency)/discover has only page / [discoveryId] / signals / lists / business — no enriching/progress page), and no full-page staged checklist.

The shipped enrichment flow:

- `modules/agency-portal/discover/components/RawListTable.tsx` (L485-503): "Enrich selected (N)" button opens `<EnrichPanel>` as a slide-over.
- `modules/agency-portal/discover/components/EnrichPanel.tsx`: a right-side aside (Tailwind, indigo accent) that lists the 9 ENRICHMENT_PRICES families with checkboxes + per-row cost, previews a quote via `preflightEnrichAction`, and runs via `runEnrichAction`. On success it does NOT navigate or open a progress screen — it only renders a one-line inline string (L211-216): "Enrichment started ({runId}…). Results stream in as the worker runs." The panel stays open showing the family list. No %, no ETA, no staged checklist, no "close, we'll email you" copy.

The only background-progress UI is the topbar HUD `components/agency/JobsTray.tsx` (rendered in app/[locale]/(agency)/layout.tsx L25,L140): a collapsed pill (renders nothing when idle) that polls `GET /api/agency/jobs` every 4s. Open, it shows a dropdown list of running Discovery/EnrichmentRun jobs, each with a flat single X/N count + one 4px indigo progressbar and a "done" flash. It is a glance widget, not the prototype's per-stage checklist.

Backend exists but is stage-blind for progress: `prisma/schema.prisma` `EnrichmentRun` (L2205-2230) tracks only run-level `unitsRequested`/`unitsCompleted` (+ skippedFresh/skippedHidden) and a status enum (PENDING/RUNNING/PARTIAL/OK/FAILED); per-family `EnrichmentJob` rows (L2233-2249) exist but `/api/agency/jobs/route.ts` (the JobsTray feed, defines `AgencyJob` with done/total) only exposes the run-level unitsCompleted/unitsRequested — it does NOT roll up jobs into the six named stages the checklist needs. No email-on-completion is wired to the UI copy (no "we'll email you" surface), and no ETA/min-left is computed anywhere.

**Gaps:**

- [critical] No dedicated enriching progress screen at all — the prototype's reassuring 'you can close this page' moment after authorizing a run has no shipped equivalent; the user is left on the slide-over with a single inline 'Results stream in' string. — This is the entire FOCUS of the audit. Prototype L7469-7521 vs EnrichPanel.tsx L211-216.
- [critical] Six-stage named checklist (done/in-progress/pending with ✓/spinner/dimmed states) is absent. JobsTray shows one flat X/N bar per run, not the per-stage Mapped→Contacts→Website+Lighthouse→Reviews→Expert layer→Draft touches breakdown. — This is the signal-vocabulary moat made visible — it's what makes the wait legible. Needs per-stage data the API doesn't yet expose.
- [critical] Background-OK / 'close this page · we'll email you when it's done (~6 min) · track from the Jobs tray' messaging is missing entirely. Nothing reassures the user the work survives navigation, and no completion email is surfaced. — Prototype SUB L7471-7475. Core reason the screen exists.
- [major] No headline % + 'X of N leads · ~M min left' summary and no large lead-count hero. EnrichPanel never shows percent or ETA; JobsTray shows raw counts only, no minutes-left estimate. — Prototype L7484-7488. ETA computation does not exist server-side.
- [major] No 'See the leads workbench →' primary CTA to jump into the workbench while the run continues. The shipped flow leaves you on the panel; the only forward nav is 'Save as list'. — Prototype primary button onclick=openWorkspace(null) L7516-7518.
- [major] No 'Close — notify me' secondary CTA / explicit exit-with-notification affordance. — Prototype L7519 data-go=welcome.
- [major] Design language divergence: prototype uses shared tokens + the editorial card, .bar gradient (#5b3df5→#9d7bff), .job rows, .check/.spin. JobsTray uses ad-hoc inline styles and a 4px flat indigo bar; EnrichPanel uses Tailwind utility classes. No reuse of the prototype's .editorial/.bar/.joblist component vocabulary. — Per ui-ux-agency.md the agency palette is honored, but the staged-progress component shape and gradient bar are not reproduced.
- [major] Progress data binding gap: /api/agency/jobs exposes only run-level unitsCompleted/unitsRequested. The checklist needs per-stage completion (counts of EnrichmentJob grouped by family→stage) and the discovery 'mapped market' + touchpoint-draft stages, which the endpoint does not return. — schema.prisma L2205-2249; route.ts AgencyJob shape. EnrichmentJob.family exists and can be grouped, but isn't surfaced.
- [minor] No live progress mechanism on the screen itself. Prototype fakes it via MutationObserver+setInterval; shipped would need to poll the (extended) jobs API or use SSE. Currently nothing on a progress surface updates because the surface doesn't exist. — realtime-and-optimistic.md prefers SSE for server-originated events; a 4s poll (as JobsTray already does) is acceptable per its own comment.
- [minor] i18n: prototype copy is English inline. Shipped EnrichPanel is explicitly English-only (header comment); any new screen must add messages/\*.json keys per i18n.md rather than hardcoding. — i18n.md — no inline strings in .tsx.

**Build spec:**

- 1. Extend the jobs feed to be stage-aware. In app/api/agency/jobs/route.ts, for each running EnrichmentRun, group its EnrichmentJob rows by family and map families → the six display stages (1 Mapped market & filters [from the parent Discovery: cellCount/fresh+refetched], 2 Contacts extracted [contact family: completed + a reachable/hidden split from EnrichmentRun.unitsSkippedHidden], 3 Website & tech + Lighthouse [website/lighthouse families], 4 Reviews & reputation, 5 Expert layer/playbook, 6 Draft first touches [touchpoints]). Return per-stage {key,label,state:'done'|'running'|'pending',done,total}. Add a run-level pct (unitsCompleted/unitsRequested) and an etaMinutes estimate (elapsed × (total-done)/done, clamped). Keep the existing flat AgencyJob shape for backward-compat with JobsTray; add a `stages` array + `pct` + `etaMinutes` fields.
- 2. Add a Zod response schema + a small typed client fetcher (e.g. modules/agency-portal/discover/lib/jobs.ts) the new screen and JobsTray can both consume.
- 3. Create the screen component components/agency/EnrichingProgress.tsx (client). Render: hero H1 'Enriching {count} leads…' (count highlighted), the background-OK sub paragraph, an editorial card with header row (pct bold + 'X of N leads · ~M min left'), a gradient progress bar (track + indigo→violet fill, width=pct, 0.4s transition), and the six-row stage checklist with ✓ green-check (done) / spinner (running) / dimmed spacer (pending) glyphs and per-stage 'done/total' or evidence text. Poll the stage-aware jobs endpoint every 4s (mirror JobsTray's AbortController + cleanup pattern); stop polling at 100%/OK.
- 4. Add the two CTAs: primary 'See the leads workbench →' linking into the raw-list/workbench for the discovery (router.push to /discover/[discoveryId]) and secondary 'Close — notify me' linking to the agency home; both keep the run going server-side. Wire a small success toast/note confirming the completion email will be sent.
- 5. Mount the screen. Two options — pick the route approach: add app/[locale]/(agency)/discover/[discoveryId]/enriching/page.tsx (Suspense-wrapped per cache-components Pattern 2, reads the latest running EnrichmentRun for the discovery server-side for first paint, then the client component takes over polling). Navigate to it from EnrichPanel.run() on `status:'ok'` (replace the inline 'Enrichment started' string with router.push to the enriching route, passing runId).
- 6. Reuse/port the prototype's .editorial/.bar/.joblist/.check/.spin styles into the agency token system (app/globals.css under an .enriching-\* namespace, or Tailwind equivalents) so the gradient bar + checklist match the prototype rather than JobsTray's flat 4px bar. Use --color-agency-indigo and the #5b3df5→#9d7bff gradient.
- 7. Add i18n keys under agency.enriching.\* in messages/en.json (title, background_ok with {count}/{eta} ICU, the six stage labels, summary 'X of N leads · ~M min left' with ICU plural, both CTA labels) and consume via useTranslations; do not hardcode English.
- 8. Surface completion email: confirm/extend the enrichment worker (app/api/internal/\* + cron dispatch) to send a 'your N leads are enriched' email on run finish via the Resend adapter, since the screen promises it. If already wired, just reference it; if not, add it (gated by run owner).
- 9. Validate: browser-validate the screen as an agency member at /discover/[id]/enriching with a seeded RUNNING EnrichmentRun (assert hero count, pct, six stages with correct states, ETA, both CTAs, mobile 380px). DB-assert the stage rollup matches EnrichmentJob counts. Lighthouse mobile ≥90, a11y ≥95 (progressbar has aria-valuenow, stages announce state). Cleanup seeded run.

**Files:**

- `app/[locale]/(agency)/discover/[discoveryId]/enriching/page.tsx`
- `components/agency/EnrichingProgress.tsx`
- `modules/agency-portal/discover/lib/jobs.ts`
- `app/api/agency/jobs/route.ts`
- `modules/agency-portal/discover/components/EnrichPanel.tsx`
- `modules/agency-portal/discover/components/RawListTable.tsx`
- `app/globals.css`
- `messages/en.json`
- `components/agency/JobsTray.tsx`

---

## Workspace — leads workbench (the heart) (workspace-leads) — DIVERGENT (~64h)

**Prototype:** The prototype `#view-workspace` (docs/portal-prototype.html L7524-7879 + render\* JS) is a full leads WORKBENCH for one cell. Structure:

HEADER: "← All research" back-link; H1 `#wsTitle` "Med spas · Miami"; meta line — "We mapped the local med spas on Google in Miami — the ~412 in this market. Website-redesign goal · [fresh dot] Fresh · mapped 2 days ago · spend to date [coin] 81 credits".

TABS (`.wtabs`): "Leads <ct 8>" / "Touchpoints <ct 6>", counts derived live (recomputeWorkspaceCounts).

LEADS TOOLBAR (`.wb-toolbar`): (1) search box "Search leads in this set…"; (2) seg "Group by cell / No groups" (setGroup → renders `.grphead` group rows with collapse chevrons + per-group lead count, disables pagination when grouped); (3) seg "Comfortable / Compact" density (toggles `.compact` class → smaller row padding/font); (4) "vs cell" checkbox toggle (default ON) with info-tip — drives COMPARE_MKT, appends a green/red delta (▲+N / ▼−N / ≈ typical) vs the cell median (MKT p50) to every numeric cell via fmtDelta(); (5) "Fields ▾" popmenu button → renderColsMenu; (6) funnel icon button (Filters) with count badge + active dot; (7) layers icon (Coverage) with "0/9" badge.

FILTERS PANEL (collapse-panel, toggled by funnel): editable filter chips (`#fchips`, fchipsHtml) + "＋ Add filter" → openFilterEditor modal (field picker over FIELD_META, operator select ≥/≤/=/</between/is-has, value inputs, between min/and/max). Compact chips bar (`#filterChipsBar`) shows when panel closed. Default seed filters: perf<50, reviews≥20, builtOn=Wix/GoDaddy. Filters applied in visibleLeads() via evalFilter.

COVERAGE PANEL (toggled by layers): covLine — "Coverage · Have: [✓ family chips] · Not yet: [todo family chips · cell] · Enrich →". Families = DATA_FAMILIES (9). A family is "have" only if every visible lead has it.

THE POWER TABLE (`table.wb`, renderWBHead/renderWBBody/rowHtml, activeCols()): columns in order — [select checkbox] · Business (name + "addr · cell" sub-line) · [Cell, optional] · Match % (sortable, `l.m`) · GOAL-SIGNAL columns (one per active goal composite signal, makeSigCol → goalMatchCell shows ✓/value+vs-cell delta or "·—"; short header label via SHORT_COL_LABEL, full name on hover) · Pain points (PAIN_COL — up to 2 colored `.ppchip` chips by signal group + "+N" overflow, full list in title=) · Built on (default on) · Reachable (default on, colored pill green/amber) · [22 other toggleable raw/fact columns: Reviews, Rating, Lighthouse, Site age, Meta ads, Google ads, Pixel, 3-pack rank, Organic /mo, Category, City, Claimed, Open status, Has website, Photos, Price tier, Phone (contactCell), Email, Social, Last contacted] · Status (clickable `.statpill` that CYCLES NEW→CONTACTED→REPLIED→WON→LOST→HIDDEN on click) · Touch (touchPill None/Draft/Sent/Queued/Replied). Sortable headers with ▲/▼; numeric cells colored by tone() + vdot. Raw column with un-enriched backing family renders "— enrich" greyed. Empty state: "No leads match. Clear a filter or widen your search."

PAGINATION (`#wbPager`, renderPagination, Boxly pattern): "Show [10/20/50/100 select] of N · start–end of N" + numbered pages with ‹ › and ellipsis windowing (getPageNumbers). Hidden in grouped view.

BULK BAR (`.bulkbar`, sticky, shown on selection): "N selected" · "Select all N filtered" link (selectAllFiltered across all pages) · "Generate touches" (primary) · "Set status ▾" (openStatusMenu popover over ST_ORDER) · "Export CSV" · "Clear". Row select supports shift-click range select; header checkbox selects current page.

TOUCHPOINTS TAB: callout, stats strip (tpStats), own toolbar (search + status seg All/New/Contacted/Replied/Won/Lost), grouped-by-business table, own pager + bulk bar (Set status / Regenerate all / Mark all sent / Export CSV).

DESIGN: agency cool-gray + indigo palette via CSS vars, Inter + JetBrains Mono mono for data, dense above-the-fold, keyboard/bulk-first.

**Current:** There is NO shipped "workspace" route. The closest analog is the saved-list PIPELINE page: app/[locale]/(agency)/discover/[discoveryId]/lists/[listId]/page.tsx rendering modules/agency-portal/discover/components/LeadsPipelineTable.tsx (the only real shipped leads table).

LeadsPipelineTable (client, useOptimistic): a 7-column read table — Business (name + "category · city" mono sub-line) · Reach (reachability chip) · Rating (right, mono) · Reviews (right, mono) · Phone (mono) · Status (a pill that cycles NEW→CONTACTED→REPLIED→WON→NEW on click, plus separate "won"/"lost" buttons) · "Open →" link. Above it: a static per-status count chip row (new/contacted/replied/won/lost/hidden + count). overflow-x-auto, sticky thead. NO select checkboxes, NO bulk bar, NO filters, NO search, NO sort, NO density toggle, NO group-by, NO pagination, NO Fields menu, NO vs-cell, NO Match %, NO goal-signal columns, NO pain-point chips, NO coverage line, NO tabs. Header (page.tsx L124-142): "← Research overview", H1 list.name, "{n} leads · {serviceType}". Status mutation via setLeadStatusAction (optimistic, real DB).

SignalsTable (separate route /discover/[discoveryId]/signals/page.tsx + SignalsTable.tsx): a DIFFERENT 4-column read table — Business · "Signals vs cell" (VsCellBar percentile bars for reviews) · Expert findings (confidence pill + signalKey + explanation chips) · Open →. This is the prototype's "vs cell" idea but on its own page, not a toggle on the leads table, and only for reviews; it has no select/bulk/filter/pagination either.

RawListTable (modules/.../RawListTable.tsx, used on the discovery overview) is actually the richest shipped table and the nearest to the prototype workbench mechanics: it HAS select checkboxes + select-all, a sticky bulk-action bar (Clear / Save-as-list with name input / Enrich selected), discovery-time filter CHIPS (Has website, rating ≥ 3/4/4.5, reachability tiers, show-hidden), a 9-dot enrichment-state strip column, and cursor "Load more" pagination. Columns: select · Business · Reach · Rating · Reviews · Web · Phone · Metro · Enrichment(9 dots) · Open →. But it is the RAW discovery list, not the leads workbench, and lacks Match %, goal-signal columns, pain chips, vs-cell, density, group-by, Fields menu, sort, numbered pagination, status pills, touch column.

DESIGN DIVERGENCE: LeadsPipelineTable, SignalsTable and RawListTable use raw Tailwind `slate-*`/`indigo-*`/`emerald-*` utility classes — NOT the agency design tokens. app/globals.css defines `--color-agency-indigo:#5b3df5`, `--font-mono` (JetBrains Mono), etc., and a full set of agency table PRIMITIVES exists in modules/agency-portal/components/ (LeadsTable.tsx, LeadRow.tsx, StatusPill.tsx, BulkActionBar.tsx, FilterRow.tsx — with density support, sortable header cells, SignalChip, BusinessCell, avatar tones, token-based styling) but these are DEAD CODE: grep confirms ZERO imports of them anywhere. The shipped tables reinvented a thinner table inline instead of using them.

DATA: lists page loads only Business {name,category,city,rating,reviewCount,website,phone,reachability} + lead.status — NO snapshot/percentile data, NO signal/finding data, NO match score, NO builtOn/perf/ads/3-pack/traffic, NO contacts beyond phone, NO touch state. So most prototype columns have no backing query.

**Gaps:**

- [critical] No tabbed workbench shell: prototype has one cell page with Leads/Touchpoints tabs + header meta (mapped/fresh/spend credits); shipped splits leads (lists/[listId]), signals, touchpoints across 3 unrelated routes with no shared shell or tabs. — The product's core surface doesn't exist as designed; it's fragmented.
- [critical] No Match % column and no goal-signal columns. Prototype shows Match % (sortable) + one column per active goal composite signal (✓/value + vs-cell delta). Shipped pipeline has neither — there is no match score in the query or UI. — These ARE the workbench — they're why a lead qualifies. Needs Lead.matchScore + per-signal join.
- [critical] No Pain-points chip column. Prototype renders up to 2 colored signal-group chips + '+N' overflow per lead (other angles to pitch). Shipped has nothing equivalent. — Tom's closing weapon. Needs PlaybookFinding join + chip rendering by signal group.
- [critical] No 'vs cell' comparison on the leads table. Prototype: default-ON toggle appends green/red median deltas to every numeric cell. Shipped: vs-cell exists ONLY on a separate read-only Signals page, only for reviews, no toggle. — VsCellBar component already exists — wire percentile bands into the leads cells + add the toggle.
- [critical] No bulk select / bulk-action bar on the leads table. Prototype: row checkboxes, shift-click range, select-all-filtered across pages, sticky bar (Generate touches / Set status ▾ / Export CSV / Clear). Shipped LeadsPipelineTable has none (RawListTable has a different bulk bar). — Mandatory per ui-ux-agency.md. Reuse RawListTable's selection pattern + add status/touch/export bulk actions.
- [critical] No Fields menu (column manager). Prototype: searchable popmenu grouped by Workflow / Already-enriched (by category) / Not-enriched, each row toggle + funnel-to-filter; drives which of ~25 columns show. Shipped table has a fixed 7 columns, no column control. — Largest single mechanic missing. renderColsMenu is ~150 lines of logic to port.
- [critical] No filters panel / filter chips / filter editor on leads. Prototype: collapsible chips panel, editable chips (field+op+value), Add-filter modal over FIELD_META, default seed filters, evalFilter pipeline. Shipped leads table has zero filtering (RawListTable has only fixed discovery chips). — Needs a generic field/op/value filter model + editor + client eval.
- [major] No Group-by-cell. Prototype: groups rows under collapsible cell headers with per-group counts and disables pagination. Shipped: flat list only. — Matters because a discovery spans multiple cells.
- [major] No density toggle (Comfortable/Compact). Prototype toggles row padding/font. Shipped LeadsPipelineTable is fixed density (the unused LeadsTable primitive supports density but isn't used). — Required by ui-ux-agency.md; trivial once the table is component-ized.
- [major] No sortable columns. Prototype: clickable headers with ▲/▼, sort by match/reviews/rating/perf/etc. Shipped leads table: no sort at all. — Tom scans 100 rows; sort is table-stakes.
- [major] No numbered pagination + page-size select. Prototype: Show 10/20/50/100, start–end of N, ‹ 1 … n › windowing. Shipped leads table: renders ALL rows, no pager (RawListTable only has cursor Load-more). — Performance + usability; spec requires bounded rendering.
- [major] No in-table search on leads. Prototype: 'Search leads in this set…' over name/addr/builtOn. Shipped leads table: none. — RawListTable also lacks free-text search.
- [major] No coverage line/panel ('Have / Not yet / Enrich →', 0/9 families). Prototype surfaces per-set enrichment coverage on the workbench. Shipped: enrichment lives only as 9 dots in RawListTable and an EnrichPanel; no set-level coverage summary on leads. — Ties the workbench to the enrichment economy.
- [major] Missing columns: Built on, Lighthouse/perf, Site age, Meta ads, Google ads, Pixel, 3-pack rank, Organic /mo, Photos, Price tier, Email, Social, Claimed, Open status, Has website, Last contacted, Touch. Shipped leads table has only Business/Reach/Rating/Reviews/Phone/Status. — ~18 columns + their backing data are absent from the query and UI.
- [minor] Status pill cycle order wrong/limited. Prototype cycles full ST_ORDER incl. LOST/HIDDEN and offers a Set-status popover. Shipped pill cycles NEW→CONTACTED→REPLIED→WON→NEW only, with side won/lost buttons; no HIDDEN, no popover picker. — Behavioral divergence; also no bulk status.
- [major] No Touch column / touchpoint linkage on the leads row. Prototype shows per-lead Touch pill (None/Draft/Sent/Queued/Replied) and 'Generate touches' bulk action. Shipped: touchpoints are a fully separate route with no per-lead column. — Breaks the leads↔outreach workflow shown in the prototype.
- [major] Design-token + typography divergence. Prototype uses agency CSS vars (--color-agency-indigo, JetBrains Mono for data) and the existing agency primitives. Shipped tables use ad-hoc Tailwind slate/indigo utilities and ignore the token-based LeadsTable/StatusPill/BulkActionBar/FilterRow primitives, which are dead code. — Either adopt the primitives or delete them; current state is inconsistent + duplicative.
- [minor] Header meta thin. Prototype header: mapped-date, freshness dot+label, spend-to-date credits, goal. Shipped header: just '{n} leads · {serviceType}'. — FreshnessChip component exists and can be reused.
- [minor] No empty/loading states matched to spec wording. Shipped empty copy differs and there's no 'No leads match. Clear a filter or widen your search.' (because no filters) and no skeletons. — Cosmetic until filters/pagination land.

**Build spec:**

- 1. Decide the shell: introduce a single workbench route per cell/list with Leads + Touchpoints tabs and a rich header (back-link, freshness via FreshnessChip, mapped-date, spend credits, goal). Either repurpose lists/[listId] or add discover/[discoveryId]/cells/[cellKey]. Wrap async body in Suspense (cache-components Pattern 2).
- 2. Adopt the existing agency primitives instead of ad-hoc Tailwind: build the table on modules/agency-portal/components/LeadsTable.tsx (LeadsTableHeaderCell sortable, density prop), StatusPill, BulkActionBar, FilterRow, SignalChip/SignalChipGroup, BusinessCell. Delete or fully wire these — no dead code.
- 3. Extend the server query: load Lead.matchScore (add if missing), latest BusinessSnapshot (reviewCount, rating, perf, percentiles/bands per signal), PlaybookFinding (flagged → goal-signal matches + pain-points), Business tech/ads/serp/contacts fields, touchpoint state per lead, and per-lead enrichment family map. Page server-side (cursor or offset) and pass plain serialized rows (Pattern 4 — no function props; pre-resolve labels).
- 4. Build the column model: port activeCols/COLS/SHORT_COL_LABEL into a typed registry. Render Business, Match % (sortable), goal-signal columns (✓/value + vs-cell delta), Pain-points chips (group-colored, top-2 +N), Built on, Reachable, plus the ~18 toggleable raw columns, Status (cycle + popover), Touch. Greyed '— enrich' for un-enriched families.
- 5. Wire 'vs cell': add a COMPARE_MKT toggle (default ON) that appends median deltas to numeric cells (port fmtDelta over snapshot percentile bands) and reuse VsCellBar where a full distribution is wanted.
- 6. Build the Fields menu: port renderColsMenu — searchable, grouped (Workflow / Already-enriched by category / Not-enriched), per-row toggle + funnel-to-filter; not-enriched toggles trigger the existing EnrichPanel flow.
- 7. Build filters: a generic {field, op, value, value2} model + FilterRow chips panel + add/edit modal over a FIELD_META registry, default seed filters, client+server eval; compact chips bar when panel closed; filters icon with count/dot.
- 8. Add toolbar mechanics: in-table search, Group-by-cell (collapsible group headers, disables pagination), Comfortable/Compact density, numbered pagination with page-size 10/20/50/100 + range, coverage panel (Have/Not yet/Enrich → · n/9).
- 9. Add bulk: row checkboxes + shift-click range + select-all-filtered (all pages) + sticky BulkActionBar (Generate touches, Set status ▾ popover over full ST_ORDER, Export CSV, Clear) backed by batched server actions.
- 10. Polish: skeletons, empty state 'No leads match. Clear a filter or widen your search.', mobile (no horizontal break / 44px targets), a11y (aria-sort, focus, color+label), Lighthouse mobile ≥90 with virtualization for >100 rows (@tanstack/react-virtual).
- 11. Tests: unit for filter eval + fmtDelta/vs-cell + column registry + pagination windowing; integration for the leads query + bulk status action; browser pass per ui-ux-agency.md.

**Files:**

- `app/[locale]/(agency)/discover/[discoveryId]/lists/[listId]/page.tsx (modify — expand query: matchScore, snapshots/bands, findings, tech/ads/serp/contacts, touch state, enrichment map; pass rich rows; add tabbed shell + rich header)`
- `modules/agency-portal/discover/components/LeadsPipelineTable.tsx (modify/replace — rebuild as the full workbench table on agency primitives, OR extract into LeadsWorkbench.tsx)`
- `modules/agency-portal/discover/components/LeadsWorkbench.tsx (create — toolbar: search, group-by, density, vs-cell toggle, Fields menu, filters/coverage icons; pagination; bulk bar orchestration)`
- `modules/agency-portal/discover/components/FieldsMenu.tsx (create — port renderColsMenu)`
- `modules/agency-portal/discover/components/LeadsFilters.tsx (create — filter chips panel + add/edit modal, FIELD_META registry, eval)`
- `modules/agency-portal/discover/components/CoverageLine.tsx (create — Have/Not yet/Enrich → · n/9)`
- `modules/agency-portal/discover/leads-columns.ts (create — typed column registry: COLS, activeCols, SHORT_COL_LABEL, goal/pain/match/vs-cell cell renderers)`
- `modules/agency-portal/discover/leads-filter.ts (create — {field,op,value} model + evalFilter + fmtDelta/vs-cell helpers; mirror raw-list-filter.ts)`
- `modules/agency-portal/components/LeadsTable.tsx (use — currently dead; adopt as the table primitive)`
- `modules/agency-portal/components/StatusPill.tsx (use — currently dead; adopt for status cells + bulk picker)`
- `modules/agency-portal/components/BulkActionBar.tsx (use — currently dead; adopt for the sticky bulk bar)`
- `modules/agency-portal/components/FilterRow.tsx (use — currently dead; adopt for filter chips)`
- `modules/agency-portal/discover/components/VsCellBar.tsx (reuse for distribution cells)`
- `modules/agency-portal/discover/components/FreshnessChip.tsx (reuse in header)`
- `modules/discovery/save-list-actions.ts (modify — add bulk setStatus + export-CSV + select-all-filtered server actions)`
- `prisma/schema.prisma (modify if Lead.matchScore / per-lead touch-state denorm is missing)`
- `modules/agency-portal/discover/__tests__/leads-filter.test.ts (create)`
- `modules/agency-portal/discover/__tests__/leads-columns.test.ts (create)`

---

## Workspace — Touchpoints tab (workspace-touchpoints) — DIVERGENT (~40h)

**Prototype:** LOCATION & SHELL — The Touchpoints UI is a TAB inside `view-workspace`, peer to the Leads tab (`<div class="wtabs">` with `#wtab-leads` and `#wtab-touch Touchpoints <span class="ct" id="wtabTouchCt">`; count = TOUCHES.length). Toggled by `wsTab('touch')`, which calls `renderTP()`. It shares the workspace's single source of truth: LEADS[] + TOUCHES[]. Touchpoints are generated FROM selected leads in the Leads tab (bulkbar "Generate touches" → openTouchGen()), then `wsTab('touch')` switches to this tab. This shared-state, two-tab workspace is the core architectural intent — touch state, lead status, and the lead drawer all stay in sync across both tabs.

PANE CONTENTS (`#wpane-touch`), top to bottom:

1. CALLOUT (`.callout.section`): ✍️ "Touches are grouped by business — each card is the full sequence we drafted for that lead, grounded in real signals. Open a card to read every step."
2. STAT STRIP (`.tpstats #tpStats`, rendered by renderTouchStats()): a horizontal flex of 5 `.tpstat` tiles, each {big num (18px/700), uppercase 10.5px label, faint sub-line}:
   - Reachable = count of LEADS with ≥1 phone/email/social · sub "have a contact"
   - Enriched = LEADS.length · sub "in this workspace"
   - Touches = TOUCHES.length · sub "{N} business(es) · avg {x.x}/biz"
   - Contacted = LEADS in [CONTACTED,REPLIED,WON,LOST] · sub "reached out"
   - Won = LEADS WON · sub "new retainer(s)" · `.tpstat.win` colors num green
     Computed LIVE from LEADS+TOUCHES; renderTouchStats() also fires from wsTab and after any status/touch change.
3. TOOLBAR (`.wb-toolbar`): search input (`#tpSearch`, placeholder "Search businesses or messages…", oninput=renderTP — matches business name OR message body) + a status segmented control (`.seg.sm`) with buttons All/New/Contacted/Replied/Won/Lost (setTPFilter; All default-on). Filter is by the underlying LEAD status.
4. BUSINESS-GROUPED TABLE (`table.wb #tpTable`), header: [select-all checkbox] / Business / Touches (num) / Sent (num) / Status / [expand]. Rows are produced by renderTP() over tpGroups() (TOUCHES grouped by business name, filtered by status+search, paginated):
   - Each `.tprow` (whole row clickable → toggleTPCard to expand): checkbox (selects the business's full sequence); Business cell = clickable `.bizname` (→ openDrawerForTouch, opens lead drawer scrolled to its Touches section) with an `.addr` sub-line of CONTACT CHIPS (contactCell phones tel: / emails mailto: / socialCell) or "—"; Touches = step count; Sent = "{sent}/{k}"; Status = a clickable `.statpill.st-{STATUS}` (setBizStatus → shared openStatusMenu, mutates LEAD status, re-renders Leads table + this table + drawer + toast); expand chevron `.tpcard-chv` (rotates 180° when open).
   - EXPANDED DETAIL ROW (`.tpdetailrow` colspan=6 → `.tpdetail`): renders one `.tpstep` card per touch via tpStepHtml(t), then a "View lead →" link.
   - Empty state: ✉️ "No sequences match. Generate touches from selected leads."
5. PAGINATION (`.wbpager #tpPager`, renderTPPagination): "Show [pageSize select] of {total}" + range "{start}–{end} of {total}" + numbered pager (getPageNumbers with ellipsis) + prev/next. Page-size options PAGE_SIZES; resets to page 1 on filter/search change.
6. BULK BAR (`.bulkbar #tpBulk`, shown when ≥1 selected): "{n} business(es) selected" + actions: Mark sent (markTPSent), Set status ▾ (bulkSetStatusTP via shared menu), Regenerate all · {cost} cr (bulkRegenTP — spends COST_PER_TOUCH credits/touch), Clear.

EXPANDABLE GROUNDED-SEQUENCE STEP CARD (tpStepHtml, the centerpiece, `.tpstep`):

- Head: "Touch {seq} of {of}" + a right-aligned Sent/Draft toggle pill (sentToggle: green "Sent ✓" when sent, else "Mark sent"; setTouchStatus flips it and syncs lead touch summary).
- EDITABLE textarea (`.tpedit #tpedit-{i}`) pre-filled with the touch body (in-place editing; saveTouch reads value at click-time).
- "WHY THIS WORKS" chips (`.tpstep-chips`): for each pain in t.pains, painChipHtml(p) → `.ppchip.{group}` colored by signal group (sigMeta). These chips are the grounding — the signals/pains the message leans on.
- Actions (`.tpstep-actions`): Save (saveTouch) + Regenerate · {COST_PER_TOUCH} cr (regenTouch — rebuilds this step from buildSequence, sets Draft, spends 1 credit, toasts wallet remaining).

GROUNDING ENGINE (buildSequence + grounded + PAIN_HOOK): the message body is generated from REAL lead signals — opener references concrete facts ("your site scores {perf}/100 on Google's mobile speed test", "you're running ads but there's no tracking pixel firing", "you're ranked #{pack} in Maps", "with {reviews} reviews you clearly have demand"); follow-ups pull plain-English PAIN_HOOK strings keyed off the lead's fired pain points (painPointsFor). Sequence length 1–3 (TG.count), tone-aware (Direct/Punchy/Warm via tgTone). This is the "grounded in real signals" promise made visible.

DESIGN TOKENS: indigo accent `--indigo:#5b3df5`, ink `--ink:#0f172a`, lines `--line:#e6e9f3`, bg `--bg:#f4f5fb`, surface-2 `--surface-2:#fafbff`, radius vars, shadow-sm; Inter body. Status pills `.st-{STATUS}`, pain chips `.ppchip.{group}`. Cool-gray + indigo agency palette throughout.

**Current:** Shipped Touchpoints is a STANDALONE top-level nav route, not a workspace tab. `app/[locale]/(agency)/touchpoints/page.tsx` is a Suspense-wrapped server page that auth-gates, scopes drafts through agency discoveries → cellKeys → businesses → OutreachDraft rows (take 100, newest first), maps via `toTouchpointDraft`, and renders into `<div className="mx-auto max-w-4xl p-6">`: a header ("Touchpoints" + "{n} drafts" mono sub + a paragraph), then `<GenerateTouchpointsPanel/>`, then `<TouchpointsList drafts/>`. It is reachable from the sidebar (`components/agency/AgencySidebar.tsx` has a `/touchpoints` nav item with IconTouchpoints). There is NO workspace shell and NO Leads tab peer — Leads/Discover live under a separate `/discover` route, so the shared-state two-tab workspace from the prototype does not exist.

`modules/agency-portal/discover/components/TouchpointsList.tsx` ("use client") renders a flat `flex flex-col gap-3` of `TouchpointCard`s. Each card (slate-bordered rounded-xl): business name + a channel pill + a predicted-tier pill (tierClass: high=emerald/medium=amber/else=slate); right side "Copy all" + indigo "Copy body" buttons; optional Subject block; the body in a read-only `<pre>`; a "Why this works" section = a flat `<ul>` of bullet strings from `draft.why`; and a row of `usedSignals` mono chips. Empty state: "No touchpoints yet" + a paragraph naming `generateTouchesForLeads`.

`modules/agency-portal/discover/components/GenerateTouchpointsPanel.tsx` ("use client") is a small inline form: "What are you selling?" text input + a Channel select (Email/DM/Phone/Social) + a Generate button calling `generateTouchpointsAction` (modules/outreach/actions.ts), then router.refresh(). Backed by modules/outreach/{actions,generate,first-touch,channels,handoff,nano-fill}.ts.

DESIGN APPROACH: pure generic Tailwind utility classes (slate-200/500/700/800, indigo-600, emerald/amber tiers, rounded-xl, font-mono for meta). It does NOT use the prototype's design tokens (`--indigo`, `--ink`, `--line`), the `.tpstat`/`.tprow`/`.tpstep`/`.ppchip`/`.statpill` component classes, or the agency CSS in components/agency. No stat strip, no table, no grouping, no expand/collapse, no editing, no per-step Save/Regenerate/Sent toggle, no status pills, no contact chips, no pagination, no bulk bar, no search, no status filter, no credit cost surfacing.

**Gaps:**

- [critical] Wrong shell: shipped is a standalone /touchpoints route; prototype is a TAB inside view-workspace, peer to Leads, sharing one LEADS+TOUCHES state. Touch generation flows from selecting leads in the Leads tab, and lead status edited in Touchpoints reflects back into Leads + the drawer. None of this exists. — The shared-state two-tab workspace is the architectural intent; flat route can't keep lead status / drawer / touch state in sync.
- [critical] Stat strip entirely missing. Prototype has 5 live tiles (Reachable / Enriched / Touches / Contacted / Won) with sub-lines and a green Won tile, computed from LEADS+TOUCHES. — renderTouchStats() — no equivalent shipped. This is the at-a-glance outreach state.
- [critical] Business-grouped expandable table missing. Shipped renders one flat card PER DRAFT; prototype groups all touches under each business into one expandable row (Business / Touches / Sent / Status / expand), one card = the full sequence for that lead. — tpGroups()+renderTP(). The grouping is the whole information model of the tab.
- [critical] No expand/collapse interaction. Prototype rows toggle open to reveal per-step cards (toggleTPCard, TP_OPEN, rotating chevron). Shipped shows everything flat, always expanded, no row affordance. —
- [critical] Touch steps are read-only in shipped (<pre>). Prototype each step is an EDITABLE textarea (.tpedit) with in-place Save (saveTouch reads value at click-time). — Editing the draft in place is a core Tom workflow.
- [major] No per-step Regenerate (regenTouch · 1 cr) and no bulk Regenerate all (bulkRegenTP) with credit cost shown. Shipped offers only Copy. — Credit-spend surfacing (COST_PER_TOUCH, wallet remaining toast) is part of the credit-economy UX.
- [major] No Sent/Draft per-step toggle (sentToggle/setTouchStatus) and no Sent count column ('{sent}/{k}'). Shipped has no concept of sent state per touch. — Drives the Sent column, lead touch summary (syncLeadTouch), and bulk Mark sent.
- [major] No clickable status pill per business (.statpill.st-{STATUS} → shared openStatusMenu → mutates lead status, re-renders everywhere + toast). Shipped shows a static predicted-tier pill only. — Prototype Status is the editable LEAD status; shipped predictedTier is a different, non-interactive concept.
- [major] No contact chips on the business row. Prototype shows phone (tel:) / email (mailto:) / social chips under the name (contactCell/socialCell) or '—'. — Reachability surfaced inline; ties to the Reachable stat.
- [major] No status filter segmented control (All/New/Contacted/Replied/Won/Lost, setTPFilter) and no search over business name OR message body (#tpSearch). Shipped has neither. —
- [major] No pagination. Prototype paginates the business groups (renderTPPagination, page-size select, numbered pager). Shipped just caps at 100 drafts server-side and dumps them all. —
- [major] No bulk-action bar (select businesses → Mark sent / Set status ▾ / Regenerate all / Clear). Shipped has no multi-select at all. — bulkbar #tpBulk; agency rules mandate bulk actions on every table.
- [major] 'Why this works' shape diverges: prototype = colored pain/signal CHIPS per step (painChipHtml → .ppchip.{group}, grounded in the lead's fired pains); shipped = a flat gray bullet <ul> of why-strings plus a separate row of mono usedSignals chips. — Prototype binds the chips to the signal group taxonomy (sigMeta); shipped chips are uncolored raw signal keys.
- [major] No grounding engine / signal-referenced copy visible. Prototype bodies reference concrete facts (perf score, missing pixel, Maps rank, review count) via grounded()+PAIN_HOOK and are tone/length configurable. Shipped just displays whatever generateTouchpointsAction stored, with a free-text 'selling what' + channel. — The prototype makes the 'grounded in real signals' promise literally visible in every line.
- [major] Sequence concept absent. Prototype = multi-step sequence (Touch 1 of N, 1–3 steps, tone Direct/Punchy/Warm). Shipped first-touch is single-draft per business (toTouchpointDraft → one subject/body). — modules/outreach/first-touch.ts is single-touch; needs multi-step sequence model.
- [major] Design system mismatch: shipped uses generic slate/indigo Tailwind utilities, not the prototype tokens (--indigo/--ink/--line) or the agency component classes (.tpstat/.tprow/.tpstep/.statpill/.ppchip). Visual identity does not match the agency portal. — Per ui-ux-agency.md cool-gray+indigo; the rest of the agency portal should share tokens.
- [minor] Callout intro line missing ('✍️ Touches are grouped by business — each card is the full sequence…'). — Sets the mental model for the grouped/expand pattern.
- [minor] 'View lead →' deep-link from an expanded sequence into the lead drawer (openDrawerForTouch) missing — depends on a lead drawer existing in the workspace. — Blocked on the workspace/drawer not existing in shipped.
- [minor] Tab badge count (Touchpoints <span class='ct'>= TOUCHES.length) missing. — Depends on the workspace tabs existing.

**Build spec:**

- 1. DECIDE THE SHELL. The prototype's Touchpoints is a tab inside a shared-state workspace (Leads + Touchpoints over one LEADS/TOUCHES set). Confirm the target: either (a) build a workspace shell at /discover (or a new /workspace) with Leads + Touchpoints tabs sharing selection + lead state + a lead drawer, or (b) keep /touchpoints standalone but re-skin it to the prototype's stat-strip + grouped-table shape. The prototype intent is (a); this spec assumes (a) but the table/cards work in either.
- 2. ADOPT AGENCY DESIGN TOKENS. Replace generic slate/indigo Tailwind with the prototype tokens/classes (--indigo #5b3df5, --ink, --line, --surface-2, radius/shadow vars) and port .tpstats/.tpstat(.win)/.tprow/.tpcard-chv/.tpdetail/.tpstep/.tpstep-\*/.tpedit/.tpsent/.statpill/.ppchip into the agency CSS. Make TouchpointsList visually match the prototype.
- 3. BUILD THE STAT STRIP. New TouchStats component: 5 tiles (Reachable / Enriched / Touches / Contacted / Won) computed from the workspace's lead+touch read-model, with sub-lines and the green Won tile. Wire it to recompute after any status/touch mutation.
- 4. BUILD THE GROUPED, EXPANDABLE TABLE. Rewrite TouchpointsList to group touches by business (tpGroups equivalent): header Business / Touches / Sent / Status / expand; row = name (clickable to drawer) + contact chips + step count + sent/k + clickable status pill + chevron; expand toggles a detail region of per-step cards. Add open/collapse state.
- 5. BUILD THE GROUNDED STEP CARD (tpStepHtml port). Per step: 'Touch {seq} of {of}', Sent/Draft toggle pill, editable textarea, 'why this works' colored pain/signal chips (port painChipHtml → .ppchip.{group} via the signal registry group), and Save + Regenerate (· N cr) actions.
- 6. ADD CONTROLS. Search (name + message body), status segmented filter (All/New/Contacted/Replied/Won/Lost), pagination over business groups (page-size select + numbered pager), and a sticky bulk bar (Mark sent / Set status ▾ / Regenerate all · cost / Clear) with multi-select.
- 7. WIRE MUTATIONS. Server actions: edit touch body (save), regenerate touch (single + bulk, debit credits, log cost), toggle sent status (per touch + bulk), set lead status (per business + bulk via the shared status menu). All revalidate the touchpoints + leads + lead tags so the two tabs/drawer stay in sync.
- 8. UPGRADE THE GENERATION MODEL to multi-step sequences. Extend modules/outreach/first-touch.ts + generate.ts to produce 1–3 grounded steps per business (grounded() opener from real signals + PAIN_HOOK follow-ups keyed on the lead's fired pains), tone-aware (Direct/Punchy/Warm) and length-selectable; persist seq/of/pains/status on OutreachDraft (schema fields likely needed). Surface signal-referenced copy in the body.
- 9. ADD CREDIT-COST SURFACING. Show per-regenerate and bulk-regenerate credit cost on buttons and a wallet-remaining toast, integrating with the existing usage/wallet system.
- 10. VALIDATION. Browser-validate as an agency member: stat tiles compute, expand/collapse, edit+save persists, regenerate debits credits, sent toggle + status pill update everywhere, search/filter/pagination/bulk work; cross-agency scoping still enforced; mobile 380px; Lighthouse perf≥90/a11y≥95; status pills color+label not color-alone; chips have accessible text.

**Files:**

- `app/[locale]/(agency)/touchpoints/page.tsx (modify — feed a grouped read-model + stats; or fold into a workspace shell)`
- `modules/agency-portal/discover/components/TouchpointsList.tsx (rewrite — grouped expandable table + step cards, agency tokens)`
- `modules/agency-portal/discover/components/GenerateTouchpointsPanel.tsx (modify — add sequence length + tone, align to prototype touch-gen)`
- `modules/agency-portal/discover/components/TouchStats.tsx (create — the 5-tile stat strip)`
- `modules/agency-portal/discover/components/TouchStepCard.tsx (create — grounded editable step card: Sent toggle, why-chips, Save/Regenerate)`
- `modules/agency-portal/discover/components/TouchpointsBulkBar.tsx (create — multi-select bulk actions)`
- `modules/agency-portal/discover/touchpoints.ts (modify — grouped-by-business read-model + sequence shaping + contact/reachability fields)`
- `modules/outreach/first-touch.ts (modify — multi-step sequence generation)`
- `modules/outreach/generate.ts (modify — persist seq/of/pains/status; grounded multi-step bodies)`
- `modules/outreach/actions.ts (modify/add — saveTouch, regenTouch (single+bulk), setTouchSent, setLeadStatus, with credit debit + revalidate)`
- `prisma/schema.prisma (modify — OutreachDraft: add seq/of/sequenceId/sent-status if multi-step persistence is needed)`
- `components/agency/AgencySidebar.tsx (modify — only if Touchpoints moves into a workspace shell)`
- `app/[locale]/(agency)/*globals/agency CSS (modify — port .tpstat/.tprow/.tpstep/.ppchip/.statpill/.tpedit/.tpsent classes + tokens)`
- `messages/en.json (modify — touchpoints stat labels, filters, callout, bulk actions, why-this-works copy)`

---

## research-list (My research / research switcher / home) — MISSING (~16h)

**Prototype:** SCREEN id="view-research" — "My research" is the agency portal's PRIMARY workspace directory: every market of local businesses the agency has mapped. Framing copy: "a research IS its leads — open one to work the set; paid results are permanent, re-open any for 0 credits."

LAYOUT (docs/portal-prototype.html lines 7880-7969; render JS lines 14025-14332):

1. HEADER ROW (flex, space-between, wrap): left = H1 "My research" + .note subtitle ("Every market of local businesses you've mapped. A research **is** its leads — open one to work the set. Paid results are permanent — re-open any for 0 credits."); right = primary button "＋ New research" (data-go="welcome" → starts a new discovery).

2. FILTER TOOLBAR (.rfbar, role=group "Filter research"), built to scale to hundreds of research:
   - Search box (input#researchSearch, magnifier icon) placeholder "Search research or location…", oninput=setResearchSearch(v); matches research name + all cell names (researchMatches, line 14154).
   - "Location" multiselect button (#rfBtnLoc, aria-haspopup) → dropdown (#rfDropLoc) with an in-dropdown search box, a scrollable checkbox list of every DISTINCT metro across all research (allMetros, sorted), per-metro count badge (metroCounts), and a "Clear" footer link. Active-count badge (#rfCountLoc) on the button.
   - "Category" multiselect (#rfBtnCat / #rfDropCat) — identical pattern over distinct categories (allCats / catCounts).
   - "Clear filters" link (#rfClear, hidden until a filter is active). Outside-click closes both popovers.
     Filter semantics: q substring on name+cells; locs = OR-match on the research's metros; cats = OR-match on its categories.

3. TWO LISTS, each header + container:
   - "Pinned" (h2#rlistPinnedH, .rlist#rlistPinned) — research where pinned=true (empty → "No pinned research.").
   - "Recent" (h2#rlistRecentH, .rlist#rlistRecent) — all non-pinned (empty → "No other research.").
   - Empty-all state (#rlistEmpty, hidden by default): "No research matches these filters · Clear filters".

4. RESEARCH CARD / ROW (researchRowHtml, lines 14089-14117) — expandable .rgroup:
   - Header .rrow (role=button, tabindex, aria-expanded, Enter-toggles): a freshness dot (.freshdot.{fresh|aging}) ; name (.nm) ; meta line (.mk) = "{goal} goal · {fresh} (mapped {mapped}) · {total} leads · {nCells} cell(s)" ; a credits-to-date stat (.sp > b.cr with coin icon + number, label "credits to date") ; an "opened {opened}" stat ; an "Open →" button (event.stopPropagation → openResearch(name)) ; a disclosure chevron (.rchev).
   - EXPANDED per-cell breakdown (.rcells, only when open): one .rcell per cell, each = a dot (.cdot) + cell metro label (cellLabel = metro portion of "{category} · {metro}") + "{n} leads" (.ccount). Cells are INFORMATIONAL (location coverage); there is ONE "Open →" per whole research because the leads workspace is always combined across cells.
   - Default expansion seed: pinned research starts expanded (RESEARCH_OPEN). toggleResearch persists per-row open state.

DATA BINDINGS per research (MY_RESEARCH, lines 14025-14062): name, goal, fresh ("fresh"|"aging"), mapped (relative), opened (relative), credits (int, spend-to-date), pinned (bool), cells[] each {cell:"{category} · {metro}", leads}. Aggregate lead count = sum of per-cell counts (researchLeadCount). The focus note also implies an ARCHIVE tab/state alongside pinned/recent.

DESIGN LANGUAGE: agency cool-gray + indigo, dense, keyboard-friendly, mono for numbers/cells; tool-y precise copy ("credits to date", "{n} cells"), no SMB warmth. This screen is the default home object the agency returns to every session.

**Current:** There is NO "My research" list anywhere in the shipped agency portal. The prototype's primary navigation object does not exist as a screen, a route, or a query.

- Sidebar (components/agency/AgencySidebar.tsx lines 37-39, 126-144): the first/workspace item is "/discover" ("Discover"), then "/campaigns", "/touchpoints", then account items. There is no "My research" / "Home" item. The agency layout (app/[locale]/(agency)/layout.tsx) renders this sidebar; auth + nav carry no research-directory concept.
- /discover (app/[locale]/(agency)/discover/page.tsx): a NEW-discovery wizard only. The body loads categories + US metros and renders <DiscoverFlow metros categories /> — a cell picker (pick metros x categories → preflight cost → run). modules/agency-portal/discover/components/DiscoverFlow.tsx has exactly two <h2> sections (metro picker, category picker) and NO list of prior/recent/pinned discoveries, no "Open →", no history. After running it shows only "Discovery started (id…). Results stream in…". So /discover never lists what you've already mapped.
- /discover/[discoveryId] (app/[locale]/(agency)/discover/[discoveryId]/page.tsx): a single discovery's RAW-LIST detail (cohort tiles + freshness chips + cell-standards + reachability banner + RawListTable + saved sub-lists). Reachable only if you already know the id — there is no index that links to it. It IS the per-research workspace, but with no directory in front of it.
- No query lists discoveries: grep for discovery.findMany / listDiscoveries / getResearch returns only generated Prisma files, overview.ts (per-cell), and unrelated touchpoints/outreach. The only Discovery.findMany usages are by-id detail loads.
- Campaigns (app/[locale]/(agency)/campaigns/page.tsx) lists Campaign rows (intent → costed strategy), a DIFFERENT object — not the research directory.

CRUCIAL: the data layer is already in place. The Discovery model (prisma/schema.prisma lines 2283-2312) carries every field a research card needs: name, isPinned, researchStatus (enum ACTIVE|ARCHIVED, lines 2108-2111 — the prototype's archive), lastOpenedAt, cellKeys[], cellCount, totalBusinesses, spendToDateUsd, totalCostUsd, freshnessJson, createdAt, finishedAt, plus indexes @@index([agencyId, createdAt]) and @@index([agencyId, researchStatus]). So the gap is purely the UI screen + a list query + nav wiring + pin/archive/rename actions — no migration required. Design-approach divergence: shipped agency pages use Tailwind utility classes (max-w / slate / indigo) and Suspense-wrapped server bodies, whereas the prototype uses bespoke .rfbar/.rlist/.rgroup/.freshdot classes; the build must translate prototype components into the shipped Tailwind/token system.

**Gaps:**

- [critical] Entire 'My research' screen absent — no route, page, or component renders pinned/recent research cards. The prototype's primary workspace home does not exist. — Agency users have no way to find a discovery they ran earlier except by raw /discover/[id] URL. /discover only starts a NEW one.
- [critical] No list query for discoveries scoped to the agency. — Need getResearchList({agencyId}) -> Discovery.findMany ordered by isPinned desc, lastOpenedAt/createdAt desc, filtered researchStatus=ACTIVE, selecting name/cellKeys/cellCount/totalBusinesses/spendToDateUsd/freshnessJson/lastOpenedAt/isPinned. Index @@index([agencyId, researchStatus]) already supports it.
- [critical] Sidebar has no 'My research' nav item and no default landing on it. — Prototype treats research as the home object. Shipped first item is 'Discover' (the new-research wizard). Add a /research (or /home) item above Discover and make it the agency default landing.
- [major] Pinned vs Recent split + pinned-first ordering missing. — Two sections (Pinned, Recent) with per-section empty copy; pinned cards seeded expanded.
- [major] Research card / row component missing (freshness dot, name, meta line 'goal · fresh (mapped X) · N leads · M cells', credits-to-date stat, opened-X stat, Open arrow button, expandable per-cell breakdown). — researchRowHtml lines 14089-14117. Per-cell sub-rows are informational (metro + lead count); ONE Open per research (combined leads workspace).
- [major] Expand/collapse per-cell breakdown (location coverage) not built. — RESEARCH_OPEN state + toggleResearch; cellLabel reduces '{category} · {metro}' to metro; per-cell '{n} leads'.
- [major] Filter toolbar (search + Location + Category multiselects with in-dropdown search, count badges, Clear) absent. — Built to scale to hundreds of research. allMetros/allCats/metroCounts/catCounts. researchMatches OR-semantics on metros/cats, substring on name+cells.
- [major] Pin / unpin action not wired. — Discovery.isPinned exists in schema but no server action toggles it; the card pin affordance + optimistic update are missing.
- [major] Archive state + (likely) an Archive tab not surfaced. — ResearchStatus ACTIVE|ARCHIVED exists; focus note says pinned/recent + archive. Need an archive action and an archived view/filter.
- [minor] 'New research' CTA from this screen missing. — Should route to /discover (the existing wizard). Trivial once the screen exists.
- [minor] Rename research not exposed. — Discovery.name is nullable and detail page falls back to 'Raw list'; cards show name prominently, so a rename action is expected from the directory.
- [minor] Goal field has no schema home. — Prototype card shows a 'goal' (Website redesign / Local SEO / Paid ads). Discovery has intentCampaignId but no goal label. Either derive goal from the linked Campaign/intent or add a label; otherwise omit the goal segment of the meta line.
- [minor] Freshness + relative-time + credits formatting (mono, locale-aware) not present for cards. — fresh/aging dot from freshnessJson; 'mapped X ago' from createdAt/finishedAt; 'opened X' from lastOpenedAt; credits-to-date from spendToDateUsd (or a credits ledger if credits != USD).

**Build spec:**

- 1. Add list query: create modules/agency-portal/research/queries.ts with getResearchList({agencyId}) using `use cache` + NEXT_PHASE guard + EMPTY constant (per cache-components.md Pattern 1). Query Discovery.findMany where {agencyId, researchStatus:'ACTIVE'}, orderBy [{isPinned:'desc'},{lastOpenedAt:'desc'},{createdAt:'desc'}], select name/cellKeys/cellCount/totalBusinesses/spendToDateUsd/freshnessJson/lastOpenedAt/createdAt/finishedAt/isPinned/intentCampaignId. cacheTag(`agency-${agencyId}-research`).
- 2. Derive card view-model server-side (avoid function props per Pattern 4): for each row pre-resolve metros[] + categories[] from cellKeys ('{category} · {metro}' split), per-cell {metroLabel, leadCount}, total leads, freshness state (fresh|aging from freshnessJson age vs 182-day window), relative 'mapped'/'opened' strings, formatted credits, and a goal label (from linked Campaign/intent if present, else omit). Output a plain serializable ResearchCard[].
- 3. Build the page: app/[locale]/(agency)/research/page.tsx — SYNC default export + Suspense-wrapped async body (Pattern 2/5), auth() -> unauthorized(), AgencyMember check -> redirect('/home') (mirror discover/page.tsx). Resolve agencyId, call getResearchList, split into pinned/recent, render header + toolbar + lists.
- 4. Header: H1 'My research' + subtitle copy from prototype + primary 'New research' button linking to /discover. Use agency Tailwind tokens (slate/indigo), not bespoke prototype CSS.
- 5. ResearchCard component (client where it needs expand/pin interactivity): freshness dot, name, meta line ('{goal} goal · {fresh} (mapped {mapped}) · {total} leads · {n} cells'), credits-to-date stat, 'opened {opened}' stat, 'Open ->' link to /discover/[discoveryId], chevron. Expandable per-cell breakdown listing metro + '{n} leads'. Pinned cards default-expanded.
- 6. Two sections 'Pinned' / 'Recent' with per-section empty copy and an all-empty/filtered-empty state ('No research matches these filters · Clear filters').
- 7. ResearchFilters client component: search input (name+cells substring) + Location multiselect + Category multiselect (each with in-dropdown search, count badges, Clear), driven off the distinct metros/categories of the loaded set; OR-match semantics per researchMatches. Pure client filtering over the already-loaded list (counts are small per agency; no server round-trip needed).
- 8. Pin/unpin server action: modules/agency-portal/research/actions.ts setResearchPinned({discoveryId, pinned}) — auth + agency ownership check, Discovery.update isPinned, revalidateTag(`agency-${agencyId}-research`,'minutes'); wire with useOptimistic on the card pin control.
- 9. Archive action + Archive view: archiveResearch({discoveryId}) sets researchStatus='ARCHIVED' + revalidate; add an Archive tab/filter (and an unarchive). Default view shows ACTIVE only.
- 10. Rename action: renameResearch({discoveryId, name}) (Zod-validated, agency-scoped) exposed from the card (inline or modal).
- 11. Nav + default landing: add a 'My research' item to AgencySidebar (href '/research', icon, label key) positioned above Discover; add agency.nav.item_research to messages/en.json; set it active for '/research'. Make /research the agency default landing (redirect from the agency root / post-auth).
- 12. Stamp lastOpenedAt: on opening a discovery (/discover/[discoveryId]), update Discovery.lastOpenedAt so Recent ordering is meaningful (after() / non-blocking).
- 13. Validate: browser pass (renders pinned+recent, filters work, expand toggles, Open routes, pin/archive optimistic) at desktop + 380px; DB assert pin/archive flips the row; copy-reviewer (agency voice) + ux-reviewer-agency; Lighthouse mobile >=90 / a11y >=95.

**Files:**

- `app/[locale]/(agency)/research/page.tsx (create — the My research screen)`
- `modules/agency-portal/research/queries.ts (create — getResearchList + EMPTY/NEXT_PHASE guard + card view-model)`
- `modules/agency-portal/research/actions.ts (create — setResearchPinned / archiveResearch / renameResearch)`
- `modules/agency-portal/research/components/ResearchCard.tsx (create — expandable card with per-cell breakdown, pin)`
- `modules/agency-portal/research/components/ResearchFilters.tsx (create — search + Location + Category multiselects)`
- `components/agency/AgencySidebar.tsx (modify — add /research nav item, make active, reorder above Discover)`
- `app/[locale]/(agency)/layout.tsx (modify — pass new nav label)`
- `messages/en.json (modify — agency.nav.item_research + research.* copy keys)`
- `app/[locale]/(agency)/discover/[discoveryId]/page.tsx (modify — stamp lastOpenedAt on open)`
- `app/[locale]/(agency)/discover/page.tsx (optional — back-link to /research)`
- `modules/agency-portal/research/__tests__/queries.test.ts (create — ordering/filter invariants)`

---

## billing — DIVERGENT (~34h)

**Prototype:** A SINGLE unified "Billing & credits" page (docs/portal-prototype.html lines 7972-8404, id="view-billing", reached via sidebar `data-go="billing"` + mobile-nav "Billing" + a topbar credit pill). All content is HARDCODED static HTML — there is NO render\*() function for billing (unlike most other prototype screens). The page is a top-to-bottom credit-economy narrative built from 7 blocks:

1. HEADER + CREDIT EXPLAINER. h1 "Billing & credits" (the word "credits" wrapped in <span class="hl">). Sub-paragraph copy: "Discovery is free. Every lead comes with contacts — go deeper only on the ones you'll pitch. **1 credit = 1 lead with contacts** · **3 credits = 1 fully-enriched lead** (reviews, ads, SERP, AI research, compliance). **100 first-touch messages = 10 credits.**"

2. CURRENT-PLAN + WALLET CARD (.card). Top row: eyebrow "Current plan", name "Growth" (20px/750), note "6,000 credits / mo · renews Jul 1", and a right-aligned <span class="pill indigo dot">Best value</span>. A usage bar: a flex line "This cycle: <coin>2,460 used" / right "3,540 of 6,000 left", then <div class="bar"><i style="width:41%"></i></div> (animated progress), then note "41% of this cycle used. Plan credits reset on renewal · top-ups never expire." Below: a 2-col grid of .stat tiles — "Plan balance" with gold-coin glyph + "3,540" + detail "≈ 1,180 fully enriched · or 3,540 contacts"; "Top-up balance" + "0" + "never expires". Then a 🔒 .callout: "A run your balance can't cover won't start — server-enforced. No surprise charges."

3. PLANS GRID (.plans, 4 columns desktop / 2 / 1). Four .plancard tiers, each with: plan-name, plan-price (38px display font, $ + <small>/ mo</small>), plan-credits line (gold-coin + "N credits"), a DUAL-OUTCOME .plan-yield grid (two boxes: "fully enriched" count vs "with contacts" count), plan-rate ("$0.05 / enriched lead"), a ✓-bulleted .plan-feat list, an indigo .plan-calc box with a worked example, and a .plan-cta button. The tiers and EXACT numbers:
   - Free · $0 · 150 credits one-time · 50 fully enriched / 150 contacts · "Never expire · no card" · CTA "Start free".
   - Starter · $19/mo · 900 credits/mo · 300 fully enriched / 900 contacts · "from $0.06 / enriched lead" · CTA "Choose Starter".
   - Growth (FEATURED, .plancard.featured with indigo glow + .plan-rec ribbon "Recommended · best value") · $99/mo · 6,000 credits/mo · 2,000 fully enriched / 6,000 contacts · "$0.05 / enriched lead" · feature "Deep audit included (speed + keywords)" · CTA "Current plan" (disabled).
   - Scale · $299/mo · 24,000 credits/mo · 8,000 fully enriched / 24,000 contacts · "from $0.037 / enriched lead" · adds "Priority support" · CTA "Choose Scale".

4. WHAT-A-CREDIT-BUYS card (.creditbuys) — 4 rows (label + sub-description on left, mono cost on right): Discovery "Free · unlimited" (green); Lead with contacts = 1 credit; Full enrichment = 3 credits; First-touch messages (per 100) = 10 credits. Plus a 💡 .callout worked example: "Map Med spas · Miami (free) → contacts on 200 leads (200) → fully enrich your best 40 (120) → 100 first touches (10) = 330 credits."

5. TOP-UP card (.packrow) — eyebrow "Top-up · one-time", 2 .pack tiles: "+1,000 / $50 / $0.05 per credit / Buy +1,000" and "+5,000 / $200 / $0.04 per credit / Buy +5,000" (primary). Footer note: "From $0.04 / credit · never expires · added to your balance… This is the only place real money is spent." Buttons wire to a toast'd Stripe-checkout demo.

6. WHY-MAPSLY-IS-CHEAPER card (.compare) — 3 competitor-comparison columns: Mapsly (.cmp.win, "$0.037–0.06 / enriched lead", "Cheapest · your baseline"), Per-seat contact tools ("≈ 2–4× the cost"), Per-action AI agents ("≈ 4–10× the cost"), each with a price + multiplier pill + note.

7. USAGE / CREDIT-LEDGER card — h2 "Usage", note "Every credit in and out — your activity, not a bill.", then a 4-col table (When / What / Credits / Balance) with red debits ("−114"), green credits ("Free", "+6,000", "+36 Failed run refund"), running Balance column.

DESIGN LANGUAGE: warm card aesthetic — white .card on light bg, 14-18px border-radius, soft box-shadows (--shadow-sm), display font for big numbers (plan-price 38px, stat .v 32px), gold radial-gradient coin glyph (.ic-coin), indigo accent (--indigo / --indigo-50/100/700), green/amber/red semantic tokens, mono tnum figures for credit counts. Mobile-responsive grids (4→2→1).

**Current:** The shipped portal splits this into TWO disconnected pages, neither matching the prototype, and the data model uses completely different plan names/prices/grants.

1. `app/[locale]/(agency)/team/billing/page.tsx` (841 lines) is a Stripe SUBSCRIPTION page, not a credit-economy page. It renders: eyebrow "Settings · Billing", h1 "Subscription"; a Current-plan card showing a <dl> of Plan/Status/Renews rows with a status pill + Stripe "Manage subscription" portal button (or a staff note); and an Invoices table (Date/Invoice/Amount/Status/Open) wired to `getAgencyInvoices`. It has NO credit explainer, NO usage bar, NO plan-balance/top-up tiles, NO plans grid, NO what-a-credit-buys, NO top-up packs, NO competitor compare, NO credit ledger. Plan names come from i18n (Solo/Growth/Pro/Boutique/Custom — messages/en.json agency.settings.billing). Fully i18n'd, inline-styled with --color-\* tokens (NOT the prototype's --indigo/--ink/--line warm tokens), --font-sans/--font-mono.

2. `app/[locale]/(agency)/usage/page.tsx` (252 lines) is the credit wallet/ledger. It renders: h1 "Usage & wallet", sub "1 credit = 1 fully-enriched lead · plan → rollover → purchased drawdown" (NOTE: contradicts prototype's "1 credit = 1 lead with contacts"); a 4-tile balance grid (Available/Plan/Rollover/Purchased) reading AgencyWallet; a held-credits note; a Plan-tier card (tier name + PLAN_CREDITS grant + renews date); and a Credit-history table (Type/Credits/Note/Date) reading CreditLedger (HOLD/SETTLE/REFUND/TOPUP/EXPIRE/ADJUST). Uses TAILWIND utility classes (rounded-xl, bg-white, text-slate-\*, bg-indigo-50) — a THIRD design system, neither prototype-warm nor the team/billing inline-token style. English-literal copy, no i18n. Read-only — "credit top-up is a Stripe payments surface wired separately" (NOT built). This page is NOT in AgencySidebar.

3. `components/agency/WalletPill.tsx` — topbar pill showing total wallet credits ("N credits" or "0 credits — add"), links to `/usage`. Roughly matches the prototype's topbar credit chip concept.

4. `modules/cost/pricing.ts` PLAN_CREDITS uses tier keys SOLO/GROWTH/AGENCY_PRO/BOUTIQUE → 600 / 1,600 / 5,000 / 12,000 credits, FREE_TIER_CREDITS=50, CREDIT_USD=$0.05. `modules/billing/plans.ts` PLANS = agency_solo/growth/pro/boutique at "$49/$99/$249/$499" (per its comment), price IDs env-driven. NEITHER matches the prototype, which has Free/Starter/Growth/Scale at $0/$19/$99/$299 with 150(one-time)/900/6,000/24,000 credits. The shipped sidebar nav item "team_billing" → /team/billing (the subscription page), so the credit-economy story (the prototype's whole point) is effectively unreachable from primary nav except via the WalletPill→/usage path.

**Gaps:**

- [critical] Plan tier names, prices, and credit grants are entirely divergent across THREE sources — Prototype: Free $0/150-one-time, Starter $19/900, Growth $99/6,000, Scale $299/24,000. Shipped pricing.ts PLAN_CREDITS: SOLO 600 / GROWTH 1,600 / AGENCY_PRO 5,000 / BOUTIQUE 12,000. Shipped plans.ts: agency_solo/growth/pro/boutique at $49/$99/$249/$499. Three incompatible models — must be reconciled to one before any UI is meaningful.
- [critical] Credit definition contradicts itself — Prototype: '1 credit = 1 lead with contacts; 3 credits = 1 fully-enriched lead'. Shipped usage/page.tsx + pricing.ts comment: '1 credit = 1 fully-enriched lead'. The core unit economics are stated differently on the live page vs the design.
- [critical] No unified 'Billing & credits' page — the prototype's entire screen is missing — Shipped splits into /team/billing (Stripe subscription+invoices) and /usage (wallet+ledger). The prototype is ONE page combining credit explainer + current-plan/wallet + plans grid + credit-buys + top-up + compare + ledger.
- [critical] Plans grid (4 plancards with dual-outcome yield, featured ribbon, plan-calc, CTAs) not built anywhere — No plancard / plan-yield / plan-rec / plan-calc UI exists in shipped agency code. This is the primary upgrade-conversion surface.
- [critical] Top-up pack picker (+1,000/$50, +5,000/$200) not built — Prototype calls this 'the only place real money is spent'. usage/page.tsx explicitly defers it ('wired separately'). No purchasedCredits top-up checkout surface exists in the UI.
- [major] Current-plan usage bar (cycle %, X of Y used, animated .bar) missing — Shipped team/billing shows a plain Plan/Status/Renews <dl>; usage page shows static balance tiles. Neither shows the prototype's '2,460 used / 3,540 of 6,000 left · 41%' progress bar.
- [major] 'What a credit buys' explainer rows missing — 4-row Discovery/Contacts(1)/Full-enrichment(3)/First-touch(10) table + 💡 worked example absent from shipped UI entirely.
- [major] Plan-balance vs Top-up-balance split tiles missing — Prototype shows two distinct balance tiles with yields ('≈1,180 fully enriched or 3,540 contacts' / 'never expires'). Shipped usage page shows Available/Plan/Rollover/Purchased — different decomposition and no yield translation.
- [minor] 'Why Mapsly is cheaper' competitor-compare block missing — 3-column .compare (Mapsly win vs per-seat vs per-action AI) not built. Sales/positioning content.
- [minor] Server-enforced no-surprise-charge 🔒 callout missing — Trust message 'A run your balance can't cover won't start — server-enforced' not surfaced in UI.
- [major] Design system mismatch (three different systems) — Prototype = warm cards, --indigo/--ink/--line tokens, gold radial-gradient .ic-coin, display-font big numbers. team/billing = inline --color-\* tokens. usage = raw Tailwind slate/indigo utilities + ◈ glyph for coin. No shared component or token alignment with the prototype.
- [minor] Credit ledger shape differs from prototype — Shipped: Type/Credits/Note/Date from CreditLedger enum. Prototype: When/What/Credits/running-Balance with human descriptions ('Fully enriched 38 leads · Med spas Miami', 'Failed run refund · upstream 503') and a running balance column the shipped ledger lacks.
- [major] Navigation / IA mismatch — Sidebar 'team_billing' points to the subscription page; /usage (the credits surface) is NOT in the sidebar (only reachable via WalletPill). Prototype has one 'Billing' destination covering everything.
- [minor] Gold coin glyph not implemented — Prototype .ic-coin is a 13px gold radial-gradient circle used throughout. Shipped usage uses a ◈ text glyph; team/billing has no coin glyph.

**Build spec:**

- STEP 0 — RECONCILE PRICING (blocking decision, human-required). Pick ONE canonical model. Prototype is the design source of truth: Free $0/150-one-time, Starter $19/900, Growth $99/6,000, Scale $299/24,000 credits; '1 credit = 1 lead-with-contacts, 3 = fully-enriched, 10 = 100 first-touch'. Decide whether to (a) adopt prototype names+prices+grants and migrate plans.ts/pricing.ts + Stripe price IDs + AgencyPlan enum, or (b) keep shipped tiers and update the prototype. This is tagged human-required (payments + schema). Document the decision before any UI work.
- STEP 1 — Define a single canonical credit/plan registry. Update modules/cost/pricing.ts PLAN_CREDITS and modules/billing/plans.ts PLANS to one agreed set of {tier key, displayName, priceUsd, monthlyCredits, oneTimeCredits, fullyEnrichedYield, withContactsYield, perEnrichedRate, features[], calcExample}. Add a CREDIT_MEANING constant ('1 credit = 1 lead with contacts; 3 = fully enriched; 10 per 100 first-touch') and a TOPUP_PACKS list ({credits, priceUsd, perCreditRate}). Fix the contradictory '1 credit = 1 fully-enriched lead' copy in usage/page.tsx + pricing.ts comment to match.
- STEP 2 — Build shared warm billing tokens/components matching the prototype. Add the .plancard/.plan-yield/.plan-rec/.plan-calc, .creditbuys, .packrow/.pack, .compare/.cmp, .bar progress, .stat, and .ic-coin gold-coin styles as React components (or a billing.module.css) using the agency indigo/ink/line tokens. Implement the gold radial-gradient coin glyph as a small <span> component reused everywhere.
- STEP 3 — Merge the two pages into ONE '/team/billing' (or rename to a single 'Billing & credits' route). Compose top-to-bottom: (1) header + credit explainer, (2) current-plan + wallet card with cycle usage bar + Plan-balance/Top-up-balance tiles + 🔒 callout, (3) 4-card plans grid (featured Growth, dual-outcome yield, plan-calc, CTAs that hit existing checkout.ts), (4) what-a-credit-buys card + 💡 example, (5) top-up pack picker wired to a NEW purchasedCredits Stripe checkout, (6) why-cheaper compare block, (7) credit ledger with running balance + human-readable descriptions.
- STEP 4 — Wire real data. Current-plan/wallet reads AgencyWallet (planCredits/purchasedCredits/rolloverCredits/heldCredits/cycleResetAt) + Agency.plan/currentPeriodEnd; compute cycle %, used, and yield translations (credits→fully-enriched / →contacts) from the canonical registry. Plans grid marks the active tier 'Current plan' (disabled) and others as upgrade CTAs. Keep Stripe invoices section (from getAgencyInvoices) as a sub-section or move to a secondary tab.
- STEP 5 — Implement top-up checkout (the missing money surface). Add a Stripe one-time-payment checkout for purchasedCredits packs in modules/billing/checkout.ts + a webhook handler that credits AgencyWallet.purchasedCredits on payment success (idempotent per .claude/rules/scalability.md). Tag human-required.
- STEP 6 — Upgrade the credit ledger query to return When (relative date)/What (human description)/Credits (signed, red/green)/running-Balance, matching the prototype table.
- STEP 7 — Fix IA: point the sidebar 'team_billing' item at the unified page; retire /usage (or 301 it to the merged route); keep WalletPill linking to the merged route's wallet anchor.
- STEP 8 — i18n all new copy into messages/_.json under agency.billing._ (the usage page is currently English-literal). Add ICU plurals for credit counts.
- STEP 9 — Validate: browser-test the merged page (anon redirect, agency member, staff vs owner CTA gating), mobile 380px (plans 4→1, packrow 2→1, compare 3→1), Lighthouse mobile + a11y, and a Stripe test-mode top-up purchase end-to-end.

**Files:**

- `app/[locale]/(agency)/team/billing/page.tsx`
- `app/[locale]/(agency)/usage/page.tsx`
- `components/agency/WalletPill.tsx`
- `components/agency/AgencySidebar.tsx`
- `modules/cost/pricing.ts`
- `modules/billing/plans.ts`
- `modules/billing/checkout.ts`
- `modules/billing/webhook.ts`
- `modules/billing/queries.ts`
- `messages/en.json`
- `messages/es.json`
- `messages/en-CA.json`
- `messages/fr.json`
- `components/agency/billing/PlansGrid.tsx`
- `components/agency/billing/CurrentPlanWalletCard.tsx`
- `components/agency/billing/CreditExplainer.tsx`
- `components/agency/billing/TopUpPacks.tsx`
- `components/agency/billing/WhyCheaper.tsx`
- `components/agency/billing/CreditLedgerTable.tsx`
- `components/agency/billing/CoinGlyph.tsx`

---
