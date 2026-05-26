/**
 * /admin/businesses · filtered + paginated business list with bulk actions.
 *
 * Default view: qualified businesses across all locations.
 * URL-driven filters (state-as-URL pattern) → bookmarkable.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — default export is
 * sync, async body lives inside Suspense. Pattern 3 — searchParams
 * Promise unwrapped inside the boundary.
 */

import { Suspense } from "react";
import { connection } from "next/server";

import { BusinessTable } from "./components/BusinessTable";
import { FilterBar } from "./components/FilterBar";
import {
  getBusinessList,
  getFilterFacets,
  type BusinessListFilters,
  type ReviewFreshnessFilter,
  type StatusFilter,
} from "./queries";

interface PageSearch {
  status?: string;
  freshness?: string;
  city?: string;
  country?: string;
  category?: string;
  hasEmail?: string;
  q?: string;
  cursor?: string;
}

export default function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 className="admin-h1">Businesses</h1>
        <p className="admin-sub">
          Operational view of every business in the index. Default filter is
          QUALIFIED. Use bulk actions to trigger review pulls or re-qualify
          rows.
        </p>
      </header>
      <Suspense fallback={<LoadingPanel />}>
        <BusinessesBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function BusinessesBody({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  await connection();
  const sp = await searchParams;

  const filters: BusinessListFilters = {
    status: parseStatus(sp.status),
    reviewFreshness: parseFreshness(sp.freshness),
    city: sp.city || undefined,
    country: sp.country || undefined,
    category: sp.category || undefined,
    hasEmail:
      sp.hasEmail === "true"
        ? true
        : sp.hasEmail === "false"
          ? false
          : undefined,
    q: sp.q || undefined,
    cursor: sp.cursor || undefined,
    limit: 50,
  };

  const [list, facets] = await Promise.all([
    getBusinessList(filters),
    getFilterFacets(),
  ]);

  return (
    <>
      <div
        className="admin-stat-row"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Stat
          label="Showing"
          value={list.rows.length}
          sub={`of ${list.total}`}
        />
        <Stat label="Qualified" value={list.stats.qualified} tone="ok" />
        <Stat label="With email" value={list.stats.withEmail} />
        <Stat label="With reviews" value={list.stats.withReviews} />
        <Stat label="In flight" value={list.stats.inFlight} tone="warn" />
        <Stat
          label="Disqualified"
          value={list.stats.disqualified}
          tone="warn"
        />
        <Stat label="Failed" value={list.stats.failed} tone="err" />
      </div>

      <FilterBar
        cities={facets.cities}
        countries={facets.countries}
        categories={facets.categories}
      />

      <BusinessTable rows={list.rows} />

      {list.nextCursor ? (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <NextPageLink cursor={list.nextCursor} searchParams={sp} />
        </div>
      ) : null}
    </>
  );
}

function NextPageLink({
  cursor,
  searchParams,
}: {
  cursor: string;
  searchParams: PageSearch;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== "cursor") params.set(k, v);
  }
  params.set("cursor", cursor);
  return (
    <a
      href={`?${params.toString()}`}
      className="admin-btn"
      data-variant="ghost"
      style={{ padding: "6px 14px", fontSize: 12 }}
    >
      Next page →
    </a>
  );
}

function parseStatus(raw: string | undefined): StatusFilter {
  switch (raw) {
    case "DISQUALIFIED":
    case "UNREACHABLE":
    case "FAILED":
    case "NOT_QUALIFIED":
    case "ALL":
      return raw;
    default:
      return "QUALIFIED";
  }
}

function parseFreshness(raw: string | undefined): ReviewFreshnessFilter {
  switch (raw) {
    case "NEVER":
    case "STALE_7D":
    case "STALE_30D":
    case "IN_FLIGHT":
    case "FRESH":
      return raw;
    default:
      return "ALL";
  }
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "ok" | "warn" | "err";
}) {
  const color =
    tone === "ok"
      ? "var(--admin-ok)"
      : tone === "warn"
        ? "var(--admin-warn)"
        : tone === "err"
          ? "var(--admin-err)"
          : "var(--admin-text)";
  return (
    <div className="admin-stat">
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--admin-text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 20,
          fontWeight: 700,
          color,
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--admin-text-3)",
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function LoadingPanel() {
  return (
    <div
      style={{
        height: 480,
        background: "var(--admin-bg-2)",
        borderRadius: 14,
        opacity: 0.5,
      }}
      aria-hidden
    />
  );
}
