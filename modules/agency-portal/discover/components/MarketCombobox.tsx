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
                <span className="opt-label" title={o.label}>
                  {o.label}
                </span>
                {o.meta ? <span className="meta">{o.meta}</span> : null}
              </div>
            ))}
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
