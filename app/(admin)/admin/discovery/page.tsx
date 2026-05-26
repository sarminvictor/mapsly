import { Suspense } from "react";
import { connection } from "next/server";

import { KNOWN_CATEGORIES } from "@/modules/business-discovery";

import {
  getDiscoveryRegistry,
  getDiscoveryStats,
  getRecentDiscoveryRuns,
  getRegisteredCategoryIds,
  type AdminCategoryGroup,
  type AdminLocationRow,
  type DiscoveryStats,
  type RecentRunRow,
} from "./queries";

import { AddCategoryToggle } from "./components/AddCategoryToggle";
import { AddLocationToggle } from "./components/AddLocationToggle";
import { ApiReference } from "./components/ApiReference";
import { DeleteCategoryButton } from "./components/DeleteCategoryButton";
import { DeleteLocationButton } from "./components/DeleteLocationButton";
import { QualifyCellButton } from "./components/QualifyCellButton";
import { RunDiscoveryButton } from "./components/RunDiscoveryButton";
import { ToggleLocationButton } from "./components/ToggleLocationButton";

/**
 * /admin/discovery · the manual-trigger discovery panel.
 *
 * Layout (top to bottom):
 *   - Header (title + add-category CTA)
 *   - Last-30-day stats row
 *   - Categories grouped, each with locations underneath + "Add
 *     location" toggle inline
 *   - Recent runs table (last 20)
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — default export
 * is sync, async body lives inside Suspense. The admin gate at the
 * layout already short-circuited non-admins so we can safely fetch.
 */
export default function DiscoveryPage() {
  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 className="admin-h1">Discovery</h1>
        <p className="admin-sub">
          Manual-trigger business discovery. Admin curates a registry of
          verified (category × location) cells, then runs DataForSEO Maps
          searches against each on demand. Every run is audited and
          cost-tracked.
        </p>
      </header>
      <Suspense fallback={<LoadingPanel />}>
        <DiscoveryBody />
      </Suspense>
    </>
  );
}

async function DiscoveryBody() {
  // Mark this body dynamic — queries use `Date.now()` for the 30-day window
  // and `noStore()` for freshness. Per `.claude/rules/cache-components.md`
  // Pattern 5, the route needs a request-time source touched before any
  // `Date.now()` call so PPR knows to skip prerender for this segment.
  await connection();

  const [stats, registry, recentRuns, registeredIds] = await Promise.all([
    getDiscoveryStats(),
    getDiscoveryRegistry(),
    getRecentDiscoveryRuns(),
    getRegisteredCategoryIds(),
  ]);

  const available = KNOWN_CATEGORIES.filter(
    (c) => !registeredIds.has(c.dataforseoId),
  ).map((c) => ({
    dataforseoId: c.dataforseoId,
    label: c.label,
    groupKey: c.groupKey,
    phase: c.phase,
    score: c.score,
  }));

  return (
    <>
      <StatsRow stats={stats} />

      <section style={{ margin: "28px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Tracked markets
          </h2>
          <AddCategoryToggle available={available} />
        </div>

        {registry.length === 0 ? (
          <div className="admin-card admin-empty">
            No categories yet. Click <strong>+ Add category</strong> to start
            with one of the curated verticals from the launch plan (Phase 1 =
            Med Spa, per{" "}
            <code className="admin-mono">_design/local-intel-preplan.md</code>).
          </div>
        ) : (
          registry.map((group) => (
            <CategoryGroup key={group.id} group={group} />
          ))
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 600 }}>
          Recent runs
        </h2>
        <RecentRunsTable rows={recentRuns} />
      </section>

      <ApiReference />
    </>
  );
}

/* ------------------------------------------------------------- stats row */

function StatsRow({ stats }: { stats: DiscoveryStats }) {
  return (
    <div
      className="admin-card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 24,
      }}
    >
      <Stat
        value={stats.totalNewBusinesses.toLocaleString()}
        label="New businesses"
      />
      <Stat
        value={`${stats.successRuns} / ${stats.totalRuns}`}
        label="Successful runs"
      />
      <Stat value={stats.activeCells.toLocaleString()} label="Active cells" />
      <Stat value={`$${stats.totalCostUsd.toFixed(3)}`} label="Spent (USD)" />
      <Stat value={`${stats.windowDays}d`} label="Window" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

/* --------------------------------------------------------- category group */

function CategoryGroup({ group }: { group: AdminCategoryGroup }) {
  // Category is "empty" when it has no locations at all — no audit
  // history to lose, safe to delete.
  const canDelete = group.locationCount === 0;
  return (
    <div className="admin-group">
      <div className="admin-group-header">
        <div className="admin-group-title">
          <span>{group.label}</span>
          <span
            className="admin-pill"
            data-status={group.isActive ? "OK" : "FAILED"}
          >
            {group.isActive ? "active" : "paused"}
          </span>
          <span
            className="admin-mono admin-muted"
            style={{ fontSize: 11, fontWeight: 400 }}
          >
            {group.dataforseoId}
          </span>
        </div>
        <div
          className="admin-group-meta"
          style={{ display: "flex", alignItems: "center", gap: 14 }}
        >
          <span>
            {group.locationCount} location{group.locationCount === 1 ? "" : "s"}
          </span>
          <span>{group.totalBusinesses.toLocaleString()} businesses</span>
          <span>${group.totalCostUsd.toFixed(3)} spent</span>
          {canDelete ? (
            <DeleteCategoryButton categoryId={group.id} label={group.label} />
          ) : null}
        </div>
      </div>
      <div className="admin-group-rows">
        {group.locations.length === 0 ? (
          <div className="admin-empty">
            No locations tracked for {group.label} yet. Add the first one below.
          </div>
        ) : (
          group.locations.map((loc) => <LocationRow key={loc.id} loc={loc} />)
        )}
        <div
          style={{ padding: 14, borderTop: "1px solid var(--admin-border)" }}
        >
          <AddLocationToggle
            categoryId={group.id}
            categoryLabel={group.label}
          />
        </div>
      </div>
    </div>
  );
}

function LocationRow({ loc }: { loc: AdminLocationRow }) {
  const canDelete = loc.businessCount === 0;
  return (
    <div className="admin-row">
      <div className="admin-row-loc">
        <span className="admin-row-loc-name">
          {loc.city}
          {loc.province ? `, ${loc.province}` : ""}{" "}
          <span className="admin-muted" style={{ fontWeight: 400 }}>
            · {loc.country}
          </span>
        </span>
        <span className="admin-row-loc-meta">
          ({loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}) · {loc.radiusKm}km
          {loc.isActive ? "" : " · paused"}
        </span>
      </div>
      <span className="admin-row-num">
        {loc.businessCount.toLocaleString()} biz
      </span>
      <span
        className="admin-row-num admin-muted"
        title="Qualified / disqualified / unreachable"
      >
        <span style={{ color: "var(--admin-ok)" }}>{loc.qualifiedCount}</span>
        {" / "}
        <span style={{ color: "var(--admin-warn)" }}>
          {loc.disqualifiedCount}
        </span>
        {" / "}
        <span style={{ color: "var(--admin-err)" }}>
          {loc.unreachableCount}
        </span>
      </span>
      <span className="admin-row-num admin-muted">
        +{loc.totalNewFound} found
      </span>
      <span className="admin-row-num admin-muted">
        ${loc.totalCostUsd.toFixed(3)}
      </span>
      <span className="admin-row-num admin-muted">
        {loc.lastRunAt ? formatRel(loc.lastRunAt) : "never"}
      </span>
      <div className="admin-row-actions">
        <ToggleLocationButton
          trackedLocationId={loc.id}
          isActive={loc.isActive}
        />
        <RunDiscoveryButton
          trackedLocationId={loc.id}
          isActive={loc.isActive}
          defaultLimit={100}
        />
        <QualifyCellButton
          trackedLocationId={loc.id}
          pendingCount={loc.businessCount}
        />
        {canDelete ? (
          <DeleteLocationButton trackedLocationId={loc.id} city={loc.city} />
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- recent runs */

function RecentRunsTable({ rows }: { rows: RecentRunRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="admin-card admin-empty">
        No runs yet. Add a location and click <strong>Run</strong> to index your
        first batch.
      </div>
    );
  }
  return (
    <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Category</th>
            <th>City</th>
            <th>Status</th>
            <th>Returned</th>
            <th>New</th>
            <th>Duplicates</th>
            <th>Errors</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="admin-mono" style={{ fontSize: 11 }}>
                {formatAbs(r.startedAt)}
              </td>
              <td>{r.categoryLabel}</td>
              <td>
                {r.city} · {r.country}{" "}
                <span className="admin-muted">{r.radiusKm}km</span>
              </td>
              <td>
                <span className="admin-pill" data-status={r.status}>
                  {r.status.toLowerCase()}
                </span>
              </td>
              <td className="admin-mono">{r.totalReturned}</td>
              <td className="admin-mono">+{r.newBusinesses}</td>
              <td className="admin-mono admin-muted">{r.duplicates}</td>
              <td className="admin-mono admin-muted">{r.errors}</td>
              <td className="admin-mono">${r.costUsd.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- format */

function formatAbs(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatRel(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatAbs(d);
}

function LoadingPanel() {
  return (
    <div className="admin-card admin-empty admin-mono" style={{ fontSize: 12 }}>
      loading discovery registry…
    </div>
  );
}
