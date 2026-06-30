"use client";

// MarketStep · "Where should we look?" — step 2 of the Get-leads flow. Two
// entry modes via a .seg2 tablist: "Target markets" (city + category combobox →
// Add market → curated "Your markets" list, cap 9) and "Search everywhere".
// RIGHT: a read-only "Your goal" rail showing the active signals + Edit signals
// (jumps back to Goal). Continue advances to Preview.
//
// Uses the prototype's ported classes (.seg2/.mkt-add/.combo/.cells/.cellrow/
// .freshdot/.bgr-chip …). English-only for now.

import { useMemo, useState } from "react";

import { SIG_META } from "../../goal-templates";
import {
  estBizCount,
  estFreshness,
  type GoalState,
  type MarketCell,
} from "../../flow-types";
import { MarketCombobox, type ComboOption } from "../MarketCombobox";

export interface MetroOption {
  slug: string;
  name: string;
}
export interface CategoryOption {
  id: string;
  slug: string;
  label: string;
}

const MAX_MARKETS = 9;
const LEAD_PRESETS = [25, 50, 100, 250, 500, 1000];

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
  onEditSignals,
  onBack,
  onContinue,
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
  onEditSignals: () => void;
  onBack: () => void;
  onContinue: () => void;
  onToast: (msg: string) => void;
}) {
  const [cityInput, setCityInput] = useState("");
  const [catInput, setCatInput] = useState("");
  const [pickedMetro, setPickedMetro] = useState<MetroOption | null>(null);
  const [pickedCat, setPickedCat] = useState<CategoryOption | null>(null);

  const cityOpts: ComboOption[] = useMemo(
    () =>
      metros.map((m) => ({
        value: m.slug,
        label: m.name,
        meta: "metro",
      })),
    [metros],
  );
  const catOpts: ComboOption[] = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.label,
      })),
    [categories],
  );

  function addMarket() {
    if (!pickedMetro || !pickedCat) {
      onToast("Pick a city and a category");
      return;
    }
    if (cells.length >= MAX_MARKETS) {
      onToast("Up to 9 markets — keeps your spend predictable");
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
      },
    ]);
    onToast(`Added · ${pickedCat.label} · ${pickedMetro.name.split(",")[0]}`);
    setCityInput("");
    setCatInput("");
    setPickedMetro(null);
    setPickedCat(null);
  }

  function removeMarket(i: number) {
    if (cells.length <= 1) {
      onToast("Keep at least one market");
      return;
    }
    onCellsChange(cells.filter((_, idx) => idx !== i));
  }

  const activeFilters = goal.filters.filter((f) => f.on);
  const continueLabel =
    mode === "target" ? "Preview & credits →" : "Preview & cost →";
  const canContinue = mode === "target" ? cells.length > 0 : true;

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
              onClick={() => onModeChange("target")}
            >
              🎯 Target markets
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

          {mode === "target" ? (
            <div>
              <p className="note" style={{ margin: "0 0 14px" }}>
                Know your market? <b>Pick a city and a category, then add it</b>{" "}
                — repeat for each market you want. You choose exactly which
                pairings to map.
              </p>

              <div className="mkt-add">
                <MarketCombobox
                  id="mktCityInput"
                  label="City"
                  placeholder="City or metro"
                  options={cityOpts}
                  value={cityInput}
                  onPick={(o) => {
                    setCityInput(o.label);
                    setPickedMetro({ slug: o.value, name: o.label });
                  }}
                />
                <MarketCombobox
                  id="mktCatInput"
                  label="Category"
                  placeholder="Category of local business"
                  options={catOpts}
                  value={catInput}
                  onPick={(o) => {
                    setCatInput(o.label);
                    const found = categories.find((c) => c.id === o.value);
                    if (found) setPickedCat(found);
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
                      <span
                        className={`freshdot ${estFreshness(i)}`}
                        aria-hidden="true"
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {c.category} · {c.city.split(",")[0]}
                        </div>
                        <div className="note">
                          ~{estBizCount(i)} local businesses
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
                Each market = one city × one category. Add up to 9 — keeps your
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
                  Not sure where to start? Search Mapsly&apos;s existing index —
                  businesses already discovered and enriched by us. No
                  discovery, no waiting. You only pay for the leads you take.
                </p>
              </div>

              <div className="field">
                <label htmlFor="searchLeads">How many leads do you want?</label>
                <div className="chipset" id="mktLeadChips">
                  {LEAD_PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`ch ${leadCount === n ? "on" : ""}`}
                      onClick={() => onLeadCountChange(n)}
                    >
                      {n.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="note" style={{ marginTop: 12 }}>
                These match your goal&apos;s signals and are pre-enriched —
                contacts, reviews and signals already in. Pay only for the ones
                you keep.
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

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
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
      </div>
    </>
  );
}
