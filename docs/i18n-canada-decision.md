# Geographic coverage & i18n — the decision (WP7-9)

> **Corrected 2026-07 (Viktor):** an earlier draft of this doc wrongly proposed "US-English only." That was based on a misread of the code. **Reality: US + Canada market selection is already live, and the roadmap is to extend worldwide.** Do NOT limit to the US. This doc records the actual conception and the follow-ups it implies.

## What's already implemented (verified in code)

- **Market selection covers US + Canada today.** The geo gazetteer (`lib/geo/us-metros.ts` — a misleading name; it is US+Canada) holds **220 US + 71 Canadian metros**: `CURATED_METROS` + `GENERATED_CITIES` ("US + Canada cities ≥100k population"), typed `country?: "US" | "CA"`. `places.generated.ts` includes Toronto, Montréal, Calgary, Ottawa, Vancouver, etc. The market picker (`app/[locale]/(agency)/discover/page.tsx:120`) surfaces the WHOLE gazetteer with **no US filter** — Canadian markets are selectable now.
- **Discovery works for Canada by construction.** The core `business_listings/search` call geolocates by **`location_coordinate` = `"lat,lng,radiusKm"`** (`services/dataforseo/maps-search.ts:38`), from each metro's lat/lng (`run-discovery.ts:296`). Coordinates are global, so a Canadian metro maps + enriches exactly like a US one. `country` flows through the cell key + display (`run-discovery.ts:47,152,295`).
- Credits are a country-neutral internal price unit ($0.05); enrichment cost is the same regardless of country.

## The decision

**Ship US + Canada now; keep the architecture country-agnostic so worldwide extension is additive.** Concretely:

1. **Do not gate the market picker by country.** It correctly serves US + CA; adding more countries = adding rows to the gazetteer (the file's own note: "adding a city here makes it selectable AND discoverable with no other wiring").
2. **UI language = English for the MVP, in every market including Canada.** English is acceptable for launch across the US and most of Canada. **fr-CA (Québec) is a real follow-up, not a launch blocker** — a Canadian agency can use the English UI today. (17 of 90 agency-portal files use next-intl; the `[locale]` route segment already exists, so a fr-CA pass later is additive.)
3. **Billing = USD via Stripe for now, for all countries.** CAD (and other) display is a follow-up; USD billing for Canadian SaaS customers is common and not a blocker.
4. **Worldwide-ready invariants** (enforce as the gazetteer grows): geolocate by coordinate (already done — no per-country location-code hardcoding on the discovery path); carry `country` on every cell; never assume `"US"` beyond a sensible default.

## The follow-up this ELEVATES (not defers): outbound compliance for Canada

Because Canadian markets are **live and enrichable today**, the outbound-compliance work (WP7-4) must cover **CASL now**, not "someday":

- Cold email to a Canadian lead is a different legal act than US (CASL is consent-based, penalties to $10M) — WP7-4's generated-touch compliance co-pilot must apply a **CASL path when the research's market country is CA** (consent framing + the mailing-address/unsubscribe footer), alongside CAN-SPAM for US markets.
- This is the one place "Canada is live" changes a compliance requirement from optional to required at launch. Tracked in WP7-4.

## Follow-ups that stay deferred (with reason)

- **fr-CA translation pass** — English UI is acceptable for Canadian launch; do the full extraction→next-intl→fr-CA pass as one epic when Québec volume justifies it.
- **CAD / multi-currency display** — USD billing is fine interim.
- **French review-theme extraction** (Québec) — the AI-research prompts are English; add fr variants with the fr-CA epic.
- **Worldwide beyond North America** — additive gazetteer growth + per-country compliance/locale as each region is turned on; keep the coordinate-based, country-tagged design so no re-architecture is needed.

## Anti-patterns (corrected)

- ❌ Limiting the market picker to the US (the earlier wrong call — reversed).
- ❌ Hardcoding a US DataForSEO location code on the discovery path (it's coordinate-based; keep it that way).
- ❌ Sending Canadian cold email under CAN-SPAM-only assumptions (must branch to CASL — WP7-4).
- ❌ Blocking Canadian market launch on a complete fr-CA translation (English UI is acceptable interim).
