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
import type React from "react";

import { useRouter } from "next/navigation";

import { Icon } from "@/components/agency/Icon";
import { showToast } from "@/components/agency/Toast";
import { renameResearchAction, setResearchPinnedAction } from "../actions";
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
  // FT-2 · a "Search everywhere" that already delivered its leads — opens them.
  delivered: { label: "Delivered", pill: "green", cta: "Open →" },
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
  // Local mirror of the server data so pin/rename reflect INSTANTLY (no refresh):
  // the action persists + revalidates the tag for durability, but the card moves
  // section / re-titles from this optimistic state the moment the user clicks.
  // Re-syncs when the server sends new props (real navigation / new research).
  const [items, setItems] = useState<ResearchCard[]>(() => [
    ...pinned,
    ...recent,
  ]);
  // Re-sync the optimistic mirror when the SERVER sends new data (new prop refs
  // on navigation / a fresh research) — NOT on our own optimistic updates. This
  // "adjust state during render" pattern (React docs) avoids a setState-in-effect
  // cascade: a client-only re-render keeps the same prop refs, so `items`
  // (with its optimistic pin/rename) survives until real server data arrives.
  const [srcRefs, setSrcRefs] = useState<{
    pinned: ResearchCard[];
    recent: ResearchCard[];
  }>({ pinned, recent });
  if (srcRefs.pinned !== pinned || srcRefs.recent !== recent) {
    setSrcRefs({ pinned, recent });
    setItems([...pinned, ...recent]);
  }

  const pinnedItems = useMemo(() => items.filter((c) => c.isPinned), [items]);
  const recentItems = useMemo(() => items.filter((c) => !c.isPinned), [items]);
  const all = items;

  const [query, setQuery] = useState("");
  const [locs, setLocs] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [open, setOpenDim] = useState<FilterDim | null>(null);
  // Pinned cards start expanded (per the prototype's RESEARCH_OPEN seed).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(pinned.map((r) => r.id)),
  );

  // Optimistic pin: move the card between sections immediately, then persist.
  async function handlePin(card: ResearchCard, next: boolean) {
    setItems((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, isPinned: next } : c)),
    );
    const res = await setResearchPinnedAction({
      discoveryId: card.id,
      pinned: next,
    });
    if (res.ok) {
      showToast(next ? "Pinned to top" : "Unpinned", "info");
    } else {
      setItems((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, isPinned: !next } : c)),
      );
      showToast("Couldn't update pin. Try again.", "error");
    }
  }

  // Optimistic rename: swap the title immediately, then persist.
  async function handleRename(card: ResearchCard, name: string) {
    const prevTitle = card.title;
    if (!name || name === prevTitle) return;
    setItems((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, title: name } : c)),
    );
    const res = await renameResearchAction({ discoveryId: card.id, name });
    if (res.ok) {
      showToast("Renamed", "info");
    } else {
      setItems((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, title: prevTitle } : c)),
      );
      showToast(
        res.error === "invalid_input"
          ? "Name must be 1–120 characters."
          : "Couldn't rename. Try again.",
        "error",
      );
    }
  }

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

  const visiblePinned = pinnedItems.filter(matches);
  const visibleRecent = recentItems.filter(matches);
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
                  onPin={(next) => handlePin(r, next)}
                  onRename={(name) => handleRename(r, name)}
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
                  onPin={(next) => handlePin(r, next)}
                  onRename={(name) => handleRename(r, name)}
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
  onPin,
  onRename,
}: {
  card: ResearchCard;
  open: boolean;
  onToggle: () => void;
  /** Persist + optimistically move the card (owned by the parent directory). */
  onPin: (next: boolean) => void;
  /** Persist + optimistically re-title the card (owned by the parent). */
  onRename: (name: string) => void;
}) {
  // next/navigation router (not next-intl's typed Link) so a status-specific
  // string href with query params (the resume deep-link) navigates client-side.
  // The app is English-only, so no locale prefix is needed on the path.
  const router = useRouter();

  // Only the inline-edit input state lives here; the persist + optimistic list
  // update are the parent's job (so pin/rename reflect instantly, no refresh).
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(card.title);

  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    setNameDraft(card.title);
    setRenaming(true);
  }
  function commitRename() {
    setRenaming(false);
    onRename(nameDraft.trim());
  }

  const nCells = card.cells.length;
  const meta = [
    card.goal ? `${card.goal} goal` : null,
    // FT-2 · add an absolute map date so the directory is scannable by when.
    `${card.freshness} · mapped ${card.mappedDate}`,
    // Delivered search → what we actually delivered (+ touches); mapped-only
    // Target research → the available market size.
    card.delivered
      ? `${card.totalLeads.toLocaleString("en-US")} delivered`
      : `${card.totalLeads.toLocaleString("en-US")} in market`,
    card.delivered && card.touchedLeads > 0
      ? `${card.touchedLeads.toLocaleString("en-US")} with touches`
      : null,
    `${nCells} market${nCells === 1 ? "" : "s"}`,
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm">
            {renaming ? (
              <input
                autoFocus
                value={nameDraft}
                maxLength={120}
                aria-label="Research name"
                onChange={(e) => setNameDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setNameDraft(card.title);
                    setRenaming(false);
                  }
                }}
                onBlur={commitRename}
                style={{
                  font: "inherit",
                  fontWeight: 600,
                  width: "100%",
                  maxWidth: 440,
                  padding: "4px 10px",
                  border: "1.5px solid var(--indigo, #5b3df5)",
                  borderRadius: 8,
                  background: "var(--surface, #fff)",
                  color: "inherit",
                  outline: "none",
                  boxShadow: "0 1px 3px rgba(91,61,245,0.14)",
                }}
              />
            ) : (
              <>
                {card.title}
                <span
                  className={`pill ${RESEARCH_STATUS_META[card.status].pill}`}
                  style={{ marginLeft: 8, verticalAlign: "middle" }}
                >
                  {RESEARCH_STATUS_META[card.status].label}
                </span>
              </>
            )}
          </div>
          <div className="mk">
            {renaming ? "Enter to save · Esc to cancel" : meta}
          </div>
        </div>
        <div className="sp">
          <b className="cr">
            <span className="ic-coin sm" aria-hidden="true" />
            {card.credits.toLocaleString("en-US")}
          </b>
          credits to date
        </div>
        <div className="sp">opened {card.opened}</div>
        <button
          type="button"
          className="btn sm"
          aria-pressed={card.isPinned}
          title={card.isPinned ? "Unpin from top" : "Pin to top"}
          onClick={(e) => {
            e.stopPropagation();
            onPin(!card.isPinned);
          }}
          style={
            card.isPinned
              ? {
                  color: "var(--indigo, #5b3df5)",
                  borderColor: "var(--indigo, #5b3df5)",
                }
              : undefined
          }
        >
          <Icon name="pin" size={13} /> {card.isPinned ? "Pinned" : "Pin"}
        </button>
        <button
          type="button"
          className="btn sm"
          title="Rename this research"
          onClick={startRename}
        >
          Rename
        </button>
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
                {/* A cell is category × metro — show both so a cross-category
                    search's rows are distinct (was metro-only → two "Kelowna"). */}
                <span className="cnm">
                  {c.categoryLabel && c.metroLabel !== "—"
                    ? `${c.categoryLabel} · ${c.metroLabel}`
                    : c.categoryLabel || c.metroLabel}
                </span>
              </div>
              {/* Delivered search → leads we delivered in this cell; mapped-only
                  Target research → the available market size ("in market"). */}
              <span className="ccount">
                {c.leadCount.toLocaleString("en-US")}
                {card.delivered ? " delivered" : " in market"}
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
