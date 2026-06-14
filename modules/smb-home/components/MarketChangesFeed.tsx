"use client";

/**
 * SMB overview · "this week — what changed" market-events feed.
 *
 * Interactive: Maria filters by event type + by business, switches between
 * the whole market and just her own moves, and sorts by most-recent / type /
 * business. Each row reads as a plain-English line with a small delta chip.
 *
 * Client-rendered with in-memory filter + sort (the set is bounded server-side).
 * Relative timestamps are computed on the client (`new Date()` is fine here —
 * this is not a prerendered server component). Cream + coral tokens per
 * `.claude/rules/ui-ux-smb.md`.
 */

import * as React from "react";

import type { SmbEventType, SmbMarketChange } from "../types";

export interface MarketChangesFeedLabels {
  heading: string;
  subtitle: string;
  filterAllTypes: string;
  typeRating: string;
  typeReviews: string;
  typeAds: string;
  typeSearch: string;
  typePhotos: string;
  typeWebsite: string;
  typeServices: string;
  scopeAll: string;
  scopeMe: string;
  companyAll: string;
  sortLabel: string;
  sortRecent: string;
  sortType: string;
  sortCompany: string;
  empty: string;
  /** "{n}d ago" / "{n}h ago" / "just now" templates. */
  agoDays: string;
  agoHours: string;
  agoNow: string;
  /** Pagination (same pattern as the search table) — "Page {page} of {total}"
   * + the prev/next button text. */
  pageOfTotal: string;
  prev: string;
  next: string;
}

export interface MarketChangesFeedProps {
  events: readonly SmbMarketChange[];
  labels: MarketChangesFeedLabels;
}

type Scope = "all" | "me";
type SortMode = "recent" | "type" | "company";

const TYPE_ORDER: SmbEventType[] = [
  "rating",
  "reviews",
  "ads",
  "search",
  "photos",
  "website",
  "services",
];

/** Rows per page — matches the search KeywordVisibilityTable. */
const PAGE_SIZE = 10;

export function MarketChangesFeed({ events, labels }: MarketChangesFeedProps) {
  const [types, setTypes] = React.useState<Set<SmbEventType>>(new Set());
  const [scope, setScope] = React.useState<Scope>("all");
  const [company, setCompany] = React.useState<string>("all");
  const [sort, setSort] = React.useState<SortMode>("recent");
  const [page, setPage] = React.useState(1);

  const typeLabel = React.useCallback(
    (t: SmbEventType): string =>
      ({
        rating: labels.typeRating,
        reviews: labels.typeReviews,
        ads: labels.typeAds,
        search: labels.typeSearch,
        photos: labels.typePhotos,
        website: labels.typeWebsite,
        services: labels.typeServices,
      })[t],
    [labels],
  );

  // Distinct companies present in the feed (for the business filter).
  const companies = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events)
      if (!map.has(e.businessId)) map.set(e.businessId, e.businessName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const filtered = React.useMemo(() => {
    let list = events.filter((e) => {
      if (types.size > 0 && !types.has(e.type)) return false;
      if (scope === "me" && !e.isOwn) return false;
      if (company !== "all" && e.businessId !== company) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "company") {
        const c = a.businessName.localeCompare(b.businessName);
        if (c !== 0) return c;
      } else if (sort === "type") {
        const c = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
        if (c !== 0) return c;
      }
      return b.at.localeCompare(a.at); // recent first (ISO sorts lexically)
    });
    return list;
  }, [events, types, scope, company, sort]);

  // Reset to page 1 whenever the filter/scope/company/sort changes — adjusted
  // during render (not in an effect) so we never land on an empty page. Same
  // pattern as the search KeywordVisibilityTable.
  const filterKey = `${[...types].sort().join(",")}|${scope}|${company}|${sort}`;
  const [prevFilterKey, setPrevFilterKey] = React.useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = React.useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const toggleType = (t: SmbEventType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <section aria-labelledby="market-feed-heading" style={shellStyle}>
      <header style={{ padding: "0 4px 12px" }}>
        <h2 id="market-feed-heading" style={headingStyle}>
          {labels.heading}
        </h2>
        <p style={subtitleStyle}>{labels.subtitle}</p>
      </header>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "0 4px 12px",
          alignItems: "center",
        }}
      >
        <Chip
          active={types.size === 0}
          onClick={() => setTypes(new Set())}
          label={labels.filterAllTypes}
        />
        {TYPE_ORDER.map((t) => (
          <Chip
            key={t}
            active={types.has(t)}
            onClick={() => toggleType(t)}
            label={typeLabel(t)}
          />
        ))}
        <span style={{ flex: 1 }} />
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            { value: "all", label: labels.scopeAll },
            { value: "me", label: labels.scopeMe },
          ]}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          padding: "0 4px 12px",
          alignItems: "center",
        }}
      >
        <select
          aria-label={labels.companyAll}
          value={company}
          onChange={(e) => setCompany(e.currentTarget.value)}
          style={selectStyle}
        >
          <option value="all">{labels.companyAll}</option>
          {companies.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-text-3)",
            }}
          >
            {labels.sortLabel}
          </span>
          <select
            aria-label={labels.sortLabel}
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value as SortMode)}
            style={selectStyle}
          >
            <option value="recent">{labels.sortRecent}</option>
            <option value="type">{labels.sortType}</option>
            <option value="company">{labels.sortCompany}</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p style={mutedParagraph}>{labels.empty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {visible.map((e, idx) => (
            <li
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 14px",
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                background: e.isOwn
                  ? "rgba(195,85,58,0.05)"
                  : "var(--color-bg-2)",
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--color-bg-3)",
                  color: "var(--color-text-2)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 700,
                  minWidth: 60,
                  textAlign: "center",
                }}
              >
                {typeLabel(e.type)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "var(--color-text)",
                  fontSize: 13.5,
                  lineHeight: 1.45,
                }}
              >
                {e.body}
              </span>
              {e.delta ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    fontWeight: 700,
                    color:
                      e.tone === "good"
                        ? "var(--color-success, #2d8659)"
                        : e.tone === "bad"
                          ? "var(--color-coral)"
                          : "var(--color-text-2)",
                  }}
                >
                  {e.delta}
                </span>
              ) : null}
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--color-text-3)",
                  whiteSpace: "nowrap",
                  minWidth: 52,
                  textAlign: "right",
                }}
              >
                {relativeAgo(e.at, labels)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "12px 4px 2px",
          }}
        >
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
            labels={labels}
          />
        </footer>
      ) : null}
    </section>
  );
}

/* ---- pagination (same pattern as the search KeywordVisibilityTable) ------- */

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
  labels,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  labels: MarketChangesFeedLabels;
}) {
  return (
    <nav
      aria-label="pagination"
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <PageBtn disabled={page <= 1} onClick={onPrev} label={labels.prev} />
      <span
        style={{
          fontSize: 11.5,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-2)",
          whiteSpace: "nowrap",
        }}
      >
        {labels.pageOfTotal
          .replace("{page}", String(page))
          .replace("{total}", String(totalPages))}
      </span>
      <PageBtn
        disabled={page >= totalPages}
        onClick={onNext}
        label={labels.next}
      />
    </nav>
  );
}

function PageBtn({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--color-text-3)" : "var(--color-text)",
        background: disabled ? "var(--color-bg-3)" : "var(--color-bg-2)",
      }}
    >
      {label}
    </button>
  );
}

/* ---- controls ------------------------------------------------------------ */

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "4px 11px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--color-coral)" : "var(--color-border)"}`,
        background: active ? "rgba(195,85,58,0.10)" : "var(--color-bg-2)",
        color: active ? "var(--color-coral)" : "var(--color-text-2)",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: 999,
        border: "1px solid var(--color-border)",
        overflow: "hidden",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            style={{
              padding: "4px 12px",
              border: "none",
              background: active ? "var(--color-coral)" : "var(--color-bg-2)",
              color: active ? "#fff" : "var(--color-text-2)",
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function relativeAgo(iso: string, labels: MarketChangesFeedLabels): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days >= 1) return labels.agoDays.replace("{n}", String(days));
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours >= 1) return labels.agoHours.replace("{n}", String(hours));
  return labels.agoNow;
}

const shellStyle: React.CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: "16px 16px 14px",
  marginBottom: 20,
  boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
};
const headingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-serif)",
  fontSize: 18,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
};
const subtitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12.5,
  color: "var(--color-text-2)",
};
const mutedParagraph: React.CSSProperties = {
  margin: "8px 4px",
  color: "var(--color-text-2)",
  fontSize: 13,
  lineHeight: 1.5,
};
const selectStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-2)",
  color: "var(--color-text)",
  fontSize: 12.5,
  fontFamily: "inherit",
  cursor: "pointer",
};
