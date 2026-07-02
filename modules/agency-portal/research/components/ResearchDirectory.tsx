"use client";

/**
 * Agency · My research · client directory (filter toolbar + pinned/recent lists
 * + expandable research cards). Owns the filter + per-card expand state because
 * filtering and expansion share the loaded set; the server passes plain
 * `ResearchCard[]` data only (no function props — cache-components.md Pattern 4).
 *
 * Markup mirrors the prototype (docs/portal-prototype.html id="view-research" +
 * researchRowHtml ~line 14089) so the ported `.agency-portal` CSS (.rfbar,
 * .rlist, .rgroup, .rrow, .rcell, .freshdot, .ic-coin, .cr) styles it. Pure
 * client filtering — counts are small per agency, no server round-trip needed.
 *
 * `'use client'` justification: in-dropdown multiselect filters, search, and
 * per-card expand/collapse all need local state + event handlers.
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import { useMemo, useState, useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { Icon } from "@/components/agency/Icon";
import type { ResearchCard, ResearchStatus } from "../queries";

type FilterDim = "loc" | "cat";

/** Status → pill colour + label + the "Open" button's verb. The CTA verb
 *  matches where the card routes (see buildResearchHref): resume the flow, or
 *  open the workbench when enriched. */
const RESEARCH_STATUS_META: Record<
  ResearchStatus,
  { label: string; pill: string; cta: string }
> = {
  draft: { label: "Draft", pill: "", cta: "Resume →" },
  discovered: { label: "Discovered", pill: "indigo", cta: "Enrich →" },
  enriching: { label: "Enriching", pill: "amber", cta: "View progress →" },
  // WP4-2 · a PARTIAL enrichment: amber pill (some leads couldn't finish), but
  // still opens the workbench — there ARE leads to work.
  partial: { label: "Partial", pill: "amber", cta: "Open →" },
  enriched: { label: "Enriched", pill: "green", cta: "Open →" },
};

interface Props {
  pinned: ResearchCard[];
  recent: ResearchCard[];
}

export function ResearchDirectory({ pinned, recent }: Props) {
  const all = useMemo(() => [...pinned, ...recent], [pinned, recent]);

  const [query, setQuery] = useState("");
  const [locs, setLocs] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [open, setOpenDim] = useState<FilterDim | null>(null);
  // Pinned cards start expanded (per the prototype's RESEARCH_OPEN seed).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(pinned.map((r) => r.id)),
  );

  const barRef = useRef<HTMLDivElement>(null);

  // Outside-click closes any open filter popover.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenDim(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  // Distinct metros / categories across the loaded set, with counts.
  const allMetros = useMemo(
    () => distinctSorted(all.flatMap((r) => r.metros)),
    [all],
  );
  const allCats = useMemo(
    () => distinctSorted(all.flatMap((r) => r.categories)),
    [all],
  );
  const metroCounts = useMemo(() => countBy(all, (r) => r.metros), [all]);
  const catCounts = useMemo(() => countBy(all, (r) => r.categories), [all]);

  const matches = (r: ResearchCard) => {
    if (query) {
      const hay = (
        r.title +
        " " +
        r.metros.join(" ") +
        " " +
        r.categories.join(" ")
      ).toLowerCase();
      if (!hay.includes(query.toLowerCase().trim())) return false;
    }
    if (locs.size && !r.metros.some((m) => locs.has(m))) return false;
    if (cats.size && !r.categories.some((c) => cats.has(c))) return false;
    return true;
  };

  const visiblePinned = pinned.filter(matches);
  const visibleRecent = recent.filter(matches);
  const noneMatch = visiblePinned.length === 0 && visibleRecent.length === 0;
  const filterActive = query !== "" || locs.size > 0 || cats.size > 0;

  function toggleFilter(dim: FilterDim, value: string) {
    const setter = dim === "loc" ? setLocs : setCats;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setLocs(new Set());
    setCats(new Set());
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Filter toolbar — search + Location/Category multiselects (scales). */}
      <div
        className="rfbar"
        role="group"
        aria-label="Filter research"
        ref={barRef}
      >
        <div className="wb-search rfsearch-main">
          <Icon name="search" className="si" size={14} />
          <input
            placeholder="Search research or location…"
            aria-label="Search research"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <FilterMenu
          dim="loc"
          label="Location"
          options={allMetros}
          counts={metroCounts}
          selected={locs}
          isOpen={open === "loc"}
          onToggleOpen={() => setOpenDim(open === "loc" ? null : "loc")}
          onToggleValue={(v) => toggleFilter("loc", v)}
          onClearDim={() => setLocs(new Set())}
        />
        <FilterMenu
          dim="cat"
          label="Category"
          options={allCats}
          counts={catCounts}
          selected={cats}
          isOpen={open === "cat"}
          onToggleOpen={() => setOpenDim(open === "cat" ? null : "cat")}
          onToggleValue={(v) => toggleFilter("cat", v)}
          onClearDim={() => setCats(new Set())}
        />

        {filterActive ? (
          <button type="button" className="rfclear" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {noneMatch ? (
        <div className="rfempty">
          No research matches these filters ·{" "}
          <button type="button" className="rflink" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <h2
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Icon name="pin" size={16} /> Pinned
          </h2>
          <div className="rlist">
            {visiblePinned.length ? (
              visiblePinned.map((r) => (
                <ResearchRow
                  key={r.id}
                  card={r}
                  open={expanded.has(r.id)}
                  onToggle={() => toggleExpand(r.id)}
                />
              ))
            ) : (
              <div className="note">No pinned research.</div>
            )}
          </div>

          <h2
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Icon name="clock" size={16} /> Recent
          </h2>
          <div className="rlist">
            {visibleRecent.length ? (
              visibleRecent.map((r) => (
                <ResearchRow
                  key={r.id}
                  card={r}
                  open={expanded.has(r.id)}
                  onToggle={() => toggleExpand(r.id)}
                />
              ))
            ) : (
              <div className="note">No other research.</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** One expandable research card (research → informational cell sub-rows). */
function ResearchRow({
  card,
  open,
  onToggle,
}: {
  card: ResearchCard;
  open: boolean;
  onToggle: () => void;
}) {
  // next/navigation router (not next-intl's typed Link) so a status-specific
  // string href with query params (the resume deep-link) navigates client-side.
  // The app is English-only, so no locale prefix is needed on the path.
  const router = useRouter();
  const nCells = card.cells.length;
  const meta = [
    card.goal ? `${card.goal} goal` : null,
    `${card.freshness} (mapped ${card.mapped})`,
    `${card.totalLeads.toLocaleString("en-US")} leads`,
    `${nCells} cell${nCells === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`rgroup${open ? " open" : ""}`}>
      <div
        className="rrow"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`freshdot ${card.freshness}`} aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <div className="nm">
            {card.title}
            <span
              className={`pill ${RESEARCH_STATUS_META[card.status].pill}`}
              style={{ marginLeft: 8, verticalAlign: "middle" }}
            >
              {RESEARCH_STATUS_META[card.status].label}
            </span>
          </div>
          <div className="mk">{meta}</div>
        </div>
        <div className="sp">
          <b className="cr">
            <span className="ic-coin sm" aria-hidden="true" />
            {card.credits.toLocaleString("en-US")}
          </b>
          credits to date
        </div>
        <div className="sp">opened {card.opened}</div>
        <a
          href={card.href}
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            // Preserve cmd/ctrl/middle-click "open in new tab"; otherwise
            // navigate client-side.
            if (e.metaKey || e.ctrlKey || e.button === 1) return;
            e.preventDefault();
            router.push(card.href);
          }}
        >
          {RESEARCH_STATUS_META[card.status].cta}
        </a>
        <span className="rchev" aria-hidden="true">
          ▶
        </span>
      </div>
      {open ? (
        <div className="rcells">
          {card.cells.map((c) => (
            <div className="rcell" key={c.cellKey}>
              <span className="cdot" aria-hidden="true" />
              <div style={{ flex: 1 }}>
                <span className="cnm">{c.metroLabel}</span>
              </div>
              <span className="ccount">
                {c.leadCount.toLocaleString("en-US")} leads
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A Location/Category multiselect: button + count badge + searchable dropdown. */
function FilterMenu({
  dim,
  label,
  options,
  counts,
  selected,
  isOpen,
  onToggleOpen,
  onToggleValue,
  onClearDim,
}: {
  dim: FilterDim;
  label: string;
  options: string[];
  counts: Map<string, number>;
  selected: Set<string>;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleValue: (value: string) => void;
  onClearDim: () => void;
}) {
  const [popQuery, setPopQuery] = useState("");
  const shown = popQuery
    ? options.filter((o) => o.toLowerCase().includes(popQuery.toLowerCase()))
    : options;

  return (
    <div className="rfwrap">
      <button
        type="button"
        className="rfbtn"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
        }}
      >
        {label}{" "}
        {selected.size > 0 ? (
          <span className="rfcount">{selected.size}</span>
        ) : null}
        <span className="rfchev" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen ? (
        <div className="rfdrop" onClick={(e) => e.stopPropagation()}>
          <input
            className="rfsearch"
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
            value={popQuery}
            onChange={(e) => setPopQuery(e.target.value)}
          />
          <div className="rflist">
            {shown.length ? (
              shown.map((o) => (
                <label className="rfopt" key={`${dim}-${o}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(o)}
                    onChange={() => onToggleValue(o)}
                  />
                  <span className="rfoptn">{o}</span>
                  <span className="rfoptc">{counts.get(o) ?? 0}</span>
                </label>
              ))
            ) : (
              <div className="rfnone">No matches.</div>
            )}
          </div>
          {selected.size > 0 ? (
            <div className="rffoot">
              <button type="button" className="rflink" onClick={onClearDim}>
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── pure helpers ─────────────────────────────────────────────────────────────

function distinctSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/** For each distinct value, how many research cards carry it. */
function countBy(
  cards: ResearchCard[],
  pick: (c: ResearchCard) => string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const v of new Set(pick(c))) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}
