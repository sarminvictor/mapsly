"use client";

// Client component · search-with-autosuggest over Maria's full 200
// tracked keywords. Uses the native HTML5 <datalist> element so the
// dropdown is OS-rendered (mobile-friendly, accessible, zero deps).
//
// On selection, scrolls to the matching row in the expandable
// "Show all tracked keywords" disclosure below and opens it. Light
// state, no DB writes — this is a "find-in-page" affordance, not a
// pinning/favorites feature (that's deferred per the PO review).

import * as React from "react";

export interface KeywordFinderLabels {
  /** "Find one of your tracked keywords…" placeholder */
  placeholder: string;
  /** "Find a keyword" aria-label on the input */
  ariaLabel: string;
  /** "Open all keywords" small button next to the input */
  expandAll: string;
}

export interface KeywordFinderOption {
  /** Stable id · matches the `<details>` row id in the expandable list. */
  id: string;
  /** Display value · the keyword text the user types/picks. */
  keyword: string;
}

export interface KeywordFinderProps {
  options: readonly KeywordFinderOption[];
  /** DOM id of the `<details>` element to open when a row is selected. */
  detailsId: string;
  /** DOM id prefix on each expandable-list row · final selector is
   *  `${rowIdPrefix}${optionId}`. */
  rowIdPrefix: string;
  labels: KeywordFinderLabels;
}

export function KeywordFinder({
  options,
  detailsId,
  rowIdPrefix,
  labels,
}: KeywordFinderProps) {
  const datalistId = React.useId();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const scrollToKeyword = React.useCallback(
    (keyword: string) => {
      const match = options.find(
        (o) => o.keyword.toLowerCase() === keyword.trim().toLowerCase(),
      );
      if (!match) return;
      const details = document.getElementById(detailsId);
      if (details && details instanceof HTMLDetailsElement) {
        details.open = true;
      }
      // Defer the scroll one frame so the disclosure has reflowed first.
      requestAnimationFrame(() => {
        const target = document.getElementById(`${rowIdPrefix}${match.id}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          // Brief highlight pulse so the row is easy to spot post-scroll.
          target.classList.add("smb-search-row-pulse");
          window.setTimeout(() => {
            target.classList.remove("smb-search-row-pulse");
          }, 1600);
        }
      });
    },
    [options, detailsId, rowIdPrefix],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Datalist selection fires both `input` (typing) and `change`
    // (final value). We act on `change` so we only scroll once the user
    // commits a pick, not on every keystroke.
    scrollToKeyword(e.currentTarget.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      scrollToKeyword(e.currentTarget.value);
    }
  };

  const handleExpandAll = () => {
    const details = document.getElementById(detailsId);
    if (details && details instanceof HTMLDetailsElement) {
      details.open = true;
      details.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    inputRef.current?.focus();
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
        <input
          ref={inputRef}
          type="search"
          list={datalistId}
          placeholder={labels.placeholder}
          aria-label={labels.ariaLabel}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{
            width: "100%",
            padding: "10px 14px",
            background: "var(--color-bg-1, #faf6f1)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            fontSize: 14,
            fontFamily: "var(--font-sans, inherit)",
            color: "var(--color-text)",
            outline: "none",
          }}
        />
        <datalist id={datalistId}>
          {options.map((o) => (
            <option key={o.id} value={o.keyword} />
          ))}
        </datalist>
      </div>
      <button
        type="button"
        onClick={handleExpandAll}
        style={{
          padding: "10px 14px",
          background: "transparent",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          fontSize: 13,
          color: "var(--color-text-2)",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        {labels.expandAll}
      </button>
    </div>
  );
}
