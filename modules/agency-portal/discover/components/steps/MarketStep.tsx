"use client";

// MarketStep · "Where should we look?" — step 2 of the Get-leads flow. Two
// entry modes via a .seg2 tablist: "Target markets" (city + category combobox →
// Add market → curated "Your markets" list, cap 3) and "Search everywhere".
// RIGHT: a read-only "Your goal" rail showing the active signals + Edit signals
// (jumps back to Goal). Continue advances to Preview.
//
// Free-lock soften (2026-07-09, docs/free-target-lock-options — hybrid OA+OC):
// free agencies EXPLORE Target mode with the full picker — the tab carries a
// "Preview" chip instead of 🔒, and the footer swaps Continue for a dual CTA:
// "Upgrade to map [their markets] →" (primary) + "Search all mapped markets
// with these signals — free" (redirects the blocked intent onto the free path).
// The read-only Target preview (real counts) is phase 2. Mapping stays gated
// server-side (runDiscoveryAction market_locked).
//
// Uses the prototype's ported classes (.seg2/.mkt-add/.combo/.cells/.cellrow/
// .freshdot/.bgr-chip …). English-only for now.

import { useMemo, useState } from "react";

import { Link } from "@/i18n/navigation";

import { SIG_META } from "../../goal-templates";
import { type GoalState, type MarketCell } from "../../flow-types";
import { MarketCombobox, type ComboOption } from "../MarketCombobox";
import { requestCategoryAction } from "@/modules/discovery/category-request-actions";

export interface MetroOption {
  slug: string;
  name: string;
  country: "US" | "CA" | "PL";
}

const COUNTRY_LABEL: Record<MetroOption["country"], string> = {
  US: "USA",
  CA: "Canada",
  PL: "Poland",
};
export interface CategoryOption {
  id: string;
  slug: string;
  label: string;
  /** Meta-group for display context in the dropdown (e.g. "Home services"). */
  groupLabel?: string;
}

const MAX_MARKETS = 3;
/** Per-call safety ceiling (mirrors the server Input cap). The slider's real
 *  max is the wallet balance — credits ARE the cap (owner decision Q3). */
const SEARCH_MAX_PER_CALL = 1000;

export function MarketStep({
  goal,
  metros,
  categories,
  cells,
  onCellsChange,
  mode,
  onModeChange,
  leadCount,
  onLeadCountChange,
  walletCredits,
  onEditSignals,
  onBack,
  onContinue,
  paid = true,
  onToast,
}: {
  goal: GoalState;
  metros: MetroOption[];
  categories: CategoryOption[];
  cells: MarketCell[];
  onCellsChange: (next: MarketCell[]) => void;
  mode: "target" | "search";
  onModeChange: (mode: "target" | "search") => void;
  leadCount: number;
  onLeadCountChange: (n: number) => void;
  /** FT-2 · the wallet balance — the search slider's hard ceiling (1cr/lead). */
  walletCredits: number;
  onEditSignals: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** FT-2 · false for the free tier → Target markets is a paid-only lock. */
  paid?: boolean;
  onToast: (msg: string) => void;
}) {
  const [pickedMetro, setPickedMetro] = useState<MetroOption | null>(null);
  const [pickedCat, setPickedCat] = useState<CategoryOption | null>(null);
  // Bumped after every "Add market" to remount both comboboxes (clears their
  // typed text + picked highlight) without fighting a controlled-value prop.
  const [comboResetKey, setComboResetKey] = useState(0);

  const cityOpts: ComboOption[] = useMemo(
    () =>
      metros.map((m) => ({
        value: m.slug,
        label: m.name,
        meta: COUNTRY_LABEL[m.country],
      })),
    [metros],
  );
  const catOpts: ComboOption[] = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.label,
        meta: c.groupLabel,
      })),
    [categories],
  );

  function addMarket() {
    if (!pickedMetro || !pickedCat) {
      onToast("Pick a city and a category");
      return;
    }
    if (cells.length >= MAX_MARKETS) {
      onToast("Up to 3 markets — keeps your spend predictable");
      return;
    }
    const dupe = cells.some(
      (c) => c.metroSlug === pickedMetro.slug && c.categoryId === pickedCat.id,
    );
    if (dupe) {
      onToast("That market is already added");
      return;
    }
    onCellsChange([
      ...cells,
      {
        city: pickedMetro.name,
        metroSlug: pickedMetro.slug,
        category: pickedCat.label,
        categoryId: pickedCat.id,
        categorySlug: pickedCat.slug,
        country: pickedMetro.country,
      },
    ]);
    onToast(`Added · ${pickedCat.label} · ${pickedMetro.name.split(",")[0]}`);
    setPickedMetro(null);
    setPickedCat(null);
    setComboResetKey((k) => k + 1);
  }

  function removeMarket(i: number) {
    if (cells.length <= 1) {
      onToast("Keep at least one market");
      return;
    }
    onCellsChange(cells.filter((_, idx) => idx !== i));
  }

  const activeFilters = goal.filters.filter((f) => f.on);
  const continueLabel = "Preview & cost →";
  const canContinue = mode === "target" ? cells.length > 0 : true;

  // Search slider (Q3): credits are the cap — the slider maxes at the wallet
  // balance (bounded by the per-call safety ceiling). `shownLeadCount` clamps a
  // stale/over-cap selection so the thumb + number never exceed what's buyable.
  const sliderCap = Math.max(1, Math.min(walletCredits, SEARCH_MAX_PER_CALL));
  const shownLeadCount = Math.min(Math.max(1, leadCount), sliderCap);

  return (
    <>
      <div
        className="grid"
        style={{ gridTemplateColumns: "1.05fr 0.95fr", alignItems: "start" }}
      >
        {/* LEFT · market selector (two modes) */}
        <div className="card">
          <div
            className="seg2"
            role="tablist"
            aria-label="How to choose a market"
            style={{ marginBottom: 14 }}
          >
            <button
              role="tab"
              aria-selected={mode === "target"}
              className={mode === "target" ? "on" : ""}
              title={
                paid
                  ? undefined
                  : "Explore Target markets — mapping a market needs a plan"
              }
              onClick={() => onModeChange("target")}
            >
              🎯 Target markets
              {!paid ? (
                <>
                  {/* explicit space so screen readers don't announce
                      "marketsPREVIEW" (JSX strips the newline whitespace) */}{" "}
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      borderRadius: 10,
                      padding: "1px 6px",
                      verticalAlign: "1px",
                      background:
                        mode === "target"
                          ? "rgba(255,255,255,0.92)"
                          : "var(--indigo-50, #eeebff)",
                      color: "var(--agency-indigo, #5b3df5)",
                    }}
                  >
                    PREVIEW
                  </span>
                </>
              ) : null}
            </button>
            <button
              role="tab"
              aria-selected={mode === "search"}
              className={mode === "search" ? "on" : ""}
              onClick={() => onModeChange("search")}
            >
              🔎 Search everywhere
            </button>
          </div>

          {!paid && mode === "target" ? (
            <div
              className="note"
              style={{
                margin: "0 0 14px",
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--amber-50, #fdf4e3)",
                border: "1px solid var(--amber, #b7791f)",
                // .note's --faint on amber-50 is ~4.36:1 (below AA) — pin an
                // ink color so the banner + its link clear 4.5:1.
                color: "var(--ink-2, #3a4660)",
              }}
            >
              <b>You&apos;re previewing a paid feature.</b> Build your market
              list below — mapping it needs a plan. On Free, Search everywhere
              pulls up to 50 leads to start from markets we&apos;ve already
              mapped.{" "}
              <Link
                href={{
                  pathname: "/team/billing",
                  query: { from: "target-preview" },
                }}
                style={{
                  fontWeight: 700,
                  color: "var(--agency-indigo, #5b3df5)",
                }}
              >
                See plans →
              </Link>
            </div>
          ) : null}

          {mode === "target" ? (
            <div>
              <p className="note" style={{ margin: "0 0 14px" }}>
                Know your market? <b>Pick a city and a category, then add it</b>{" "}
                — repeat for each market you want. You choose exactly which
                pairings to map.
              </p>

              <div className="mkt-add">
                <MarketCombobox
                  key={`city-${comboResetKey}`}
                  id="mktCityInput"
                  label="City"
                  placeholder="Type any US, Canada, or Poland city…"
                  options={cityOpts}
                  onPick={(o) => {
                    const found = metros.find((m) => m.slug === o.value);
                    if (found) setPickedMetro(found);
                  }}
                  // R2-1 · the city gazetteer is authoritative — no request
                  // capture — but say what we cover instead of a silent blank.
                  emptyLabel="We cover 300+ US, Canada & Poland metros — that city isn't one yet. Try the nearest large metro."
                />
                <MarketCombobox
                  key={`cat-${comboResetKey}`}
                  id="mktCatInput"
                  label="Category"
                  placeholder="Type a business category…"
                  options={catOpts}
                  onPick={(o) => {
                    const found = categories.find((c) => c.id === o.value);
                    if (found) setPickedCat(found);
                  }}
                  // WP7-13 · taxonomy-miss — the closest-match suggestion +
                  // "request this category" capture live in the combobox; here we
                  // just record the request (fire-and-forget) + acknowledge it.
                  onRequestMissing={(q) => {
                    void requestCategoryAction({ query: q });
                    onToast(`Thanks — we'll look at adding "${q}"`);
                  }}
                />
                <button
                  type="button"
                  className="btn primary"
                  onClick={addMarket}
                >
                  ＋ Add market
                </button>
              </div>

              <div className="eyebrow" style={{ margin: "20px 0 8px" }}>
                Your markets · {cells.length}
              </div>
              <div className="cells">
                {cells.length === 0 ? (
                  <div className="note">
                    No markets yet — add a city × category above.
                  </div>
                ) : (
                  cells.map((c, i) => (
                    <div
                      className="cellrow"
                      key={`${c.metroSlug}-${c.categoryId}`}
                    >
                      <span className="freshdot new" aria-hidden="true" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {c.category} · {c.city.split(",")[0]}
                        </div>
                        <div className="note">
                          Counts &amp; freshness on the next step
                        </div>
                      </div>
                      <button
                        type="button"
                        className="x"
                        aria-label={`Remove ${c.category} · ${c.city.split(",")[0]}`}
                        onClick={() => removeMarket(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="note" style={{ marginTop: 8 }}>
                Each market = one city × one category. Add up to 3 — keeps your
                spend predictable.
              </div>
            </div>
          ) : (
            <div>
              <div
                className="callout"
                style={{
                  background: "var(--mint-50)",
                  border: "1px solid var(--mint)",
                  color: "var(--mint-ink)",
                  margin: "0 0 16px",
                }}
              >
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  Pick your signals — we&apos;ll pull leads from every market
                  we&apos;ve already mapped that match them and have contacts.
                  You&apos;re charged 1 credit per lead — only for the leads we
                  deliver.
                </p>
              </div>

              <div className="field">
                <label htmlFor="searchLeads">How many leads do you want?</label>
                {walletCredits < 1 ? (
                  <div
                    className="note"
                    style={{
                      margin: "6px 0 0",
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--amber-50, #fbf3e2)",
                      border: "1px solid var(--amber, #b7791f)",
                    }}
                  >
                    You have <b>no credits</b>. Search charges 1 credit per lead
                    — add credits on the next step to pull leads.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        marginTop: 8,
                      }}
                    >
                      <input
                        id="searchLeads"
                        type="range"
                        min={1}
                        max={sliderCap}
                        step={1}
                        value={shownLeadCount}
                        onChange={(e) =>
                          onLeadCountChange(Number(e.target.value))
                        }
                        aria-label={`Number of leads, 1 to ${sliderCap}`}
                        style={{
                          flex: 1,
                          accentColor: "var(--agency-indigo, #5b3df5)",
                        }}
                      />
                      {/* Editable number mirrors the slider — drag OR type an
                          exact count (both clamp to 1…cap). */}
                      <input
                        type="number"
                        min={1}
                        max={sliderCap}
                        value={shownLeadCount}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n))
                            onLeadCountChange(
                              Math.min(Math.max(1, Math.round(n)), sliderCap),
                            );
                        }}
                        aria-label="Number of leads"
                        style={{
                          width: 92,
                          fontWeight: 750,
                          fontSize: 22,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          border: "1px solid var(--line, #e5e7f0)",
                          borderRadius: 8,
                          padding: "4px 8px",
                        }}
                      />
                    </div>
                    <div className="note" style={{ marginTop: 8 }}>
                      You have <b>{walletCredits.toLocaleString("en-US")}</b>{" "}
                      credit{walletCredits === 1 ? "" : "s"} · 1 credit per lead
                      {walletCredits > SEARCH_MAX_PER_CALL
                        ? ` · max ${SEARCH_MAX_PER_CALL.toLocaleString("en-US")} per search`
                        : ""}
                      .
                    </div>
                  </>
                )}
              </div>

              <div className="note" style={{ marginTop: 12 }}>
                A target, not a guarantee — you get up to this many leads that
                fully match your signals and have contacts. Add reviews, ads or
                site data on any lead later for a credit or two more.
              </div>
            </div>
          )}
        </div>

        {/* RIGHT · read-only goal summary rail */}
        <div className="card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 0 }}>
              Your goal
            </div>
            <button type="button" className="btn sm" onClick={onEditSignals}>
              Edit signals
            </button>
          </div>
          <p className="note" style={{ margin: "8px 0 14px" }}>
            These <b>expert signals</b> were set on the previous step — same
            set, every market you add. Edit them anytime.
          </p>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {goal.name}
              {goal.customized ? (
                <span className="gd-custom" style={{ marginLeft: 8 }}>
                  Customized
                </span>
              ) : null}
            </div>
            <div className="note" style={{ marginBottom: 10 }}>
              {activeFilters.length} active signal
              {activeFilters.length === 1 ? "" : "s"}
            </div>
            <div>
              {activeFilters.map((f) => {
                const meta = SIG_META[f.key];
                if (!meta) return null;
                return (
                  <span className="bgr-chip" key={f.key}>
                    {meta.title}
                    <span
                      className={
                        meta.kind === "signal" ? "badge-sig" : "badge-data"
                      }
                    >
                      {meta.kind === "signal" ? "SIGNAL" : "DATA"}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        {!paid && mode === "target" ? (
          // Free tier explored Target mode — no Preview yet (phase 2). Dual
          // CTA: upgrade at the moment of intent (named with their own picks),
          // or redirect the intent onto the free Search path (same signals;
          // search sweeps ALL mapped markets — it has no category filter, so
          // the copy stays honest and doesn't promise their picked market).
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={() => onModeChange("search")}
            >
              Search all mapped markets with these signals — no plan needed
            </button>
            <Link
              href={{
                pathname: "/team/billing",
                query: { from: "target-preview" },
              }}
              className="btn primary"
            >
              {upgradeCtaLabel(cells)}
            </Link>
          </div>
        ) : (
          <div style={{ marginLeft: "auto" }}>
            <button
              type="button"
              className="btn primary"
              disabled={!canContinue}
              onClick={onContinue}
            >
              {continueLabel}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** "Upgrade to map Kelowna + Victoria →" — names the user's own picks (first
 *  city word each, max 2 + "+N more"); generic before any market is added. */
function upgradeCtaLabel(cells: MarketCell[]): string {
  if (cells.length === 0) return "Upgrade to open any market →";
  const cities = [...new Set(cells.map((c) => c.city.split(",")[0]))];
  const shown = cities.slice(0, 2).join(" + ");
  const more = cities.length - 2;
  return `Upgrade to map ${shown}${more > 0 ? ` +${more} more` : ""} →`;
}
