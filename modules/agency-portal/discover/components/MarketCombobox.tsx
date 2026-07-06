"use client";

// MarketCombobox · a filter-as-you-type combobox over metros or categories,
// styled with the prototype's .combo/.opts classes. Used by the Market step's
// add-market builder (city + category typeaheads). Pure data in/out — the
// caller owns the selection. English-only for now.

import { useMemo, useState } from "react";

export interface ComboOption {
  /** Value passed back on select. */
  value: string;
  /** Primary label shown in the input + dropdown. */
  label: string;
  /** Right-aligned grey sub-label ("metro · ~30km"). */
  meta?: string;
}

/** How many rows to show — a larger default list (no query yet) so the first
 *  screenful is genuinely useful over hundreds of options; a tighter cap once
 *  the user is filtering (a typed query already narrows the field for you). */
const MAX_DEFAULT_OPTIONS = 12;
const MAX_FILTERED_OPTIONS = 20;

export function MarketCombobox({
  id,
  label,
  placeholder,
  options,
  note,
  onPick,
  onRequestMissing,
  emptyLabel,
}: {
  id: string;
  label: string;
  placeholder: string;
  /** Pre-sorted best-first (e.g. most prospected / largest first) — both the
   *  no-query default list and filtered matches preserve this order. */
  options: ComboOption[];
  note?: string;
  /** Called with the picked option (fills the input only). */
  onPick: (opt: ComboOption) => void;
  /**
   * WP7-13 · taxonomy-miss. When set, a typed query with NO exact match renders
   * a "no match — did you mean {closest}? · request this category" empty state
   * instead of a silent blank dropdown. Called with the raw typed query when the
   * user asks for a category we don't carry. Both are client components, so this
   * callback never crosses a server boundary. Omitted for the city field (its
   * gazetteer is authoritative — a missing city is genuinely out of coverage).
   */
  onRequestMissing?: (query: string) => void;
  /**
   * R2-1 · for a field WITHOUT `onRequestMissing` (the city field, whose
   * gazetteer is authoritative), a no-match query would otherwise show a silent
   * blank dropdown. When set, show this honest coverage message (+ the closest
   * covered option) instead — e.g. "We cover 300+ US & Canada metros — that one
   * isn't yet."
   */
  emptyLabel?: string;
}) {
  // Fully self-contained — no controlled `value` prop. A parent that needs to
  // clear this field (e.g. after "Add market") does so by changing this
  // component's `key`, which remounts it with a fresh, empty `query`. (A
  // controlled `value` that the parent only updates on pick/reset — never on
  // keystroke — caused every render to look like "the parent cleared the
  // field", wiping each character the instant it was typed.)
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_DEFAULT_OPTIONS);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.meta ?? "").toLowerCase().includes(q),
      )
      .slice(0, MAX_FILTERED_OPTIONS);
  }, [query, options]);

  // WP7-13 · taxonomy-miss. When the user has typed something with NO exact
  // match, find the closest option by shared-word / prefix overlap so we can
  // offer "did you mean {closest}?" instead of a silent blank. Cheap heuristic
  // (no fuzzy lib): score by longest shared token prefix, then substring.
  const q = query.trim().toLowerCase();
  const noMatch = q.length >= 2 && filtered.length === 0;
  const closest = useMemo<ComboOption | null>(() => {
    if (!noMatch) return null;
    const qTokens = q.split(/\s+/).filter(Boolean);
    let best: ComboOption | null = null;
    let bestScore = 0;
    for (const o of options) {
      const label = o.label.toLowerCase();
      let score = 0;
      for (const t of qTokens) {
        // Any option word that starts with a query word → strong partial hit.
        if (
          label.split(/\s+/).some((w) => w.startsWith(t) || t.startsWith(w))
        ) {
          score += t.length;
        } else if (label.includes(t.slice(0, 3))) {
          score += 1; // weak 3-char overlap
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return bestScore > 0 ? best : null;
  }, [q, noMatch, options]);

  return (
    <div className="field" style={{ margin: 0 }}>
      <label htmlFor={id}>{label}</label>
      <div className="combo">
        <input
          id={id}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-opts`}
        />
        {open && filtered.length > 0 ? (
          <div className="opts" id={`${id}-opts`} role="listbox">
            {filtered.map((o) => (
              <div
                key={o.value}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  // mousedown fires before blur so the pick lands
                  e.preventDefault();
                  setQuery(o.label);
                  setOpen(false);
                  onPick(o);
                }}
              >
                <span className="opt-label" data-tip={o.label}>
                  {o.label}
                </span>
                {o.meta ? <span className="meta">{o.meta}</span> : null}
              </div>
            ))}
          </div>
        ) : open && noMatch && onRequestMissing ? (
          /* WP7-13 · taxonomy-miss empty state — closest suggestion + a
             "request this category" capture, never a silent blank result. */
          <div className="opts" id={`${id}-opts`} role="listbox">
            {closest ? (
              <div
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(closest.label);
                  setOpen(false);
                  onPick(closest);
                }}
              >
                <span className="opt-label" data-tip={closest.label}>
                  Did you mean <b>{closest.label}</b>?
                </span>
                {closest.meta ? (
                  <span className="meta">{closest.meta}</span>
                ) : null}
              </div>
            ) : (
              <div className="combo-empty" aria-disabled="true">
                <span className="opt-label">
                  No match for &ldquo;{query.trim()}&rdquo;
                </span>
              </div>
            )}
            <button
              type="button"
              className="combo-request"
              onMouseDown={(e) => {
                e.preventDefault();
                onRequestMissing(query.trim());
                setOpen(false);
              }}
            >
              ＋ Request &ldquo;{query.trim()}&rdquo; as a category
            </button>
          </div>
        ) : open && noMatch ? (
          /* R2-1 · no-match on an authoritative field (city) — instead of a
             silent blank, say what we cover + offer the closest covered option. */
          <div className="opts" id={`${id}-opts`} role="listbox">
            {closest ? (
              <div
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(closest.label);
                  setOpen(false);
                  onPick(closest);
                }}
              >
                <span className="opt-label" data-tip={closest.label}>
                  Not covered yet — nearest is <b>{closest.label}</b>
                </span>
                {closest.meta ? (
                  <span className="meta">{closest.meta}</span>
                ) : null}
              </div>
            ) : null}
            <div className="combo-empty" aria-disabled="true">
              <span className="opt-label">
                {emptyLabel ??
                  "That isn't a metro we cover yet — try the nearest large metro."}
              </span>
            </div>
          </div>
        ) : null}
      </div>
      {note ? (
        <div className="note" style={{ marginTop: 5 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
