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

export function MarketCombobox({
  id,
  label,
  placeholder,
  options,
  note,
  value,
  onPick,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: ComboOption[];
  note?: string;
  /** The currently-typed text. */
  value: string;
  /** Called with the picked option (fills the input only). */
  onPick: (opt: ComboOption) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // Keep local text in sync when the parent resets it (e.g. after Add market).
  if (value !== query && value === "") {
    // parent cleared the field
    setQuery("");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.meta ?? "").toLowerCase().includes(q),
        )
      : options;
    return base.slice(0, 8);
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
                {o.label}
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
