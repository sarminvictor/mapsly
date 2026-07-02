"use client";

// PreEnrichFilters · WP5-4 · the FREE pre-enrich filter card on the Preview
// step's post-mapping state. Tom narrows the mapped market (min reviews /
// rating / has-website / reachability — exactly what `rawListWhere` supports)
// BEFORE committing credits, and the surviving count is live-counted
// server-side so "enrich 180 of 412" is the real set the preflight will price.
//
// Controlled + stateless: the filter object lives in PreviewStep (it threads
// into preflight/runEnrichAction), this card only renders chips and reports
// changes. Resurrects the chip vocabulary from the dead raw-list-filter.ts.
// Per .claude/rules/ui-ux-agency.md: dense, numbers over adjectives.
// English-only.

import { marketFiltersActive, type MarketFilters } from "../../flow-types";

const RATING_STOPS = [3.5, 4, 4.5] as const;
const REVIEW_STOPS = [10, 25, 50, 100] as const;

// NOTE: no Reachability filter here (removed) — reachability is the OUTPUT of
// the contact scan and is `UNKNOWN` for every business until it's enriched, so
// filtering the pre-enrich market by it would exclude the entire market. It
// belongs on the workbench (post-enrichment), never on this pre-spend screen.

export function PreEnrichFilters({
  filters,
  onChange,
  total,
  matching,
  enrichable,
  hideWebsite = false,
}: {
  filters: MarketFilters;
  onChange: (next: MarketFilters) => void;
  /** The whole mapped market (unfiltered, default-excluded view). */
  total: number;
  /** Businesses passing the filters — null while the server count is in
   *  flight (renders a counting state, never a guessed number). */
  matching: number | null;
  /** The subset the run would actually enrich (website gate applied). */
  enrichable: number | null;
  /** Hide the Website chip when the goal already REQUIRES a website (site-based
   *  research): the enrich scope excludes website-less businesses anyway, so the
   *  chip would be a redundant no-op. Only shown for non-site goals. */
  hideWebsite?: boolean;
}) {
  const active = marketFiltersActive(filters);

  function patch(p: Partial<MarketFilters>) {
    const next = { ...filters, ...p };
    // Drop cleared keys so "no filters" is an EMPTY object (marketFiltersActive).
    if (next.hasWebsite !== true) delete next.hasWebsite;
    if (!next.minRating) delete next.minRating;
    if (!next.minReviewCount) delete next.minReviewCount;
    if (!next.reachability || next.reachability.length === 0) {
      delete next.reachability;
    }
    onChange(next);
  }

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      className={`ch ${on ? "on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="card section">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0 }}>Filter before you enrich — free</h2>
        <span className="note">
          {active
            ? matching == null
              ? "counting…"
              : `${matching.toLocaleString()} of ${total.toLocaleString()} match`
            : `all ${total.toLocaleString()} in scope`}
          {active &&
          enrichable != null &&
          matching != null &&
          enrichable < matching
            ? ` · ${enrichable.toLocaleString()} enrichable (have a website)`
            : ""}
        </span>
        {active ? (
          <button
            type="button"
            className="btn sm"
            style={{ marginLeft: "auto" }}
            onClick={() => onChange({})}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {hideWebsite ? null : (
        <div className="setrow" style={{ marginTop: 10 }}>
          <span className="setl">Website</span>
          <div className="chipset">
            {chip(!filters.hasWebsite, "Any", () =>
              patch({ hasWebsite: undefined }),
            )}
            {chip(filters.hasWebsite === true, "Has a website", () =>
              patch({
                hasWebsite: filters.hasWebsite === true ? undefined : true,
              }),
            )}
          </div>
        </div>
      )}

      <div
        className="setrow"
        style={hideWebsite ? { marginTop: 10 } : undefined}
      >
        <span className="setl">Rating</span>
        <div className="chipset">
          {chip(!filters.minRating, "Any", () =>
            patch({ minRating: undefined }),
          )}
          {RATING_STOPS.map((r) =>
            chip(filters.minRating === r, `${r.toFixed(1)}★+`, () =>
              patch({ minRating: filters.minRating === r ? undefined : r }),
            ),
          )}
        </div>
      </div>

      <div className="setrow">
        <span className="setl">Reviews</span>
        <div className="chipset">
          {chip(!filters.minReviewCount, "Any", () =>
            patch({ minReviewCount: undefined }),
          )}
          {REVIEW_STOPS.map((n) =>
            chip(filters.minReviewCount === n, `${n}+`, () =>
              patch({
                minReviewCount: filters.minReviewCount === n ? undefined : n,
              }),
            ),
          )}
        </div>
      </div>

      <p className="note" style={{ margin: "8px 0 0" }}>
        Filters are free — they narrow which leads the enrich run prices and
        queues. The best-N cap below applies within the filtered set.
      </p>
    </div>
  );
}
