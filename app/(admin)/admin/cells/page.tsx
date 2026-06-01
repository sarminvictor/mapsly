/**
 * /admin/cells · the market-reference panel.
 *
 * Lists every CellMetric — the per (category × city × country) signal
 * DISTRIBUTIONS that make Mapsly Score market-relative ("top 15% of Brickell
 * med-spas" instead of a made-up "150 reviews = good"). Built from existing
 * BusinessSnapshot rows (zero external-API cost) by the weekly:cell-aggregate
 * cron or the "Recompute references" button here. Pillar scoring then grades
 * each business against these.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — default export is sync,
 * async body inside Suspense. The admin gate at the layout already
 * short-circuited non-admins.
 */

import { Suspense } from "react";
import { connection } from "next/server";

import { RunCellAggregateButton } from "./components/RunCellAggregateButton";
import {
  getCellList,
  getCellStats,
  type CellRow,
  type CellStats,
} from "./queries";

export default function CellsPage() {
  return (
    <>
      <header
        style={{
          marginBottom: 22,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <h1 className="admin-h1">Cells</h1>
          <p className="admin-sub">
            Market references — the per (category × city × country) signal
            distributions that make Mapsly Score market-relative. Built from
            snapshots (zero API cost). Recompute after a fresh snapshot run;
            pillar scoring then grades each business against these medians.
          </p>
        </div>
        <RunCellAggregateButton />
      </header>
      <Suspense fallback={<LoadingPanel />}>
        <CellsBody />
      </Suspense>
    </>
  );
}

async function CellsBody() {
  await connection();
  const [stats, cells] = await Promise.all([getCellStats(), getCellList()]);
  return (
    <>
      <StatsRow stats={stats} />
      <section style={{ marginTop: 28 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 600 }}>
          Cell references
        </h2>
        <CellsTable rows={cells} />
      </section>
    </>
  );
}

/* ------------------------------------------------------------- stats row */

function StatsRow({ stats }: { stats: CellStats }) {
  return (
    <div
      className="admin-card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 24,
      }}
    >
      <Stat value={stats.totalCells.toLocaleString()} label="Cells" />
      <Stat
        value={stats.highConfidence.toLocaleString()}
        label="High confidence (≥8)"
      />
      <Stat
        value={stats.businessesCovered.toLocaleString()}
        label="Businesses covered"
      />
      <Stat
        value={stats.lastComputedAt ? formatRel(stats.lastComputedAt) : "never"}
        label="Last recompute"
      />
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

/* ----------------------------------------------------------------- table */

function CellsTable({ rows }: { rows: CellRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="admin-card admin-empty">
        No cell references yet. Click <strong>Recompute references</strong> to
        build them from the latest snapshots. (Run the weekly snapshot first if
        the index is empty.)
      </div>
    );
  }
  return (
    <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Cell</th>
            <th>Sample</th>
            <th>Confidence</th>
            <th>Rating p50</th>
            <th>Reviews p50 / p90</th>
            <th>Photos p50</th>
            <th>Reply p50</th>
            <th>Speed p50</th>
            <th>SoV p50</th>
            <th>Ads</th>
            <th>Computed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cellKey}>
              <td>
                <span style={{ fontWeight: 600 }}>{r.category}</span>{" "}
                <span className="admin-muted">
                  · {r.city} · {r.country}
                </span>
              </td>
              <td className="admin-mono">{r.sampleSize.toLocaleString()}</td>
              <td>
                <span
                  className="admin-pill"
                  data-status={r.confidence === "high" ? "OK" : "PARTIAL"}
                >
                  {r.confidence}
                </span>
              </td>
              <td className="admin-mono">{fixed(r.ratingP50, 1)}</td>
              <td className="admin-mono">
                {intOr(r.reviewCountP50)}{" "}
                <span className="admin-muted">/ {intOr(r.reviewCountP90)}</span>
              </td>
              <td className="admin-mono">{intOr(r.photoCountP50)}</td>
              <td className="admin-mono">{pct(r.replyRateP50)}</td>
              <td className="admin-mono">{intOr(r.lighthousePerfP50)}</td>
              <td className="admin-mono">{pctRaw(r.shareOfVoiceP50)}</td>
              <td className="admin-mono">{pct(r.adPrevalence)}</td>
              <td className="admin-mono admin-muted" style={{ fontSize: 11 }}>
                {formatRel(r.computedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- format */

function fixed(v: number | null, digits: number): string {
  return v == null ? "—" : v.toFixed(digits);
}
function intOr(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString();
}
/** Fraction 0–1 → "NN%". */
function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
/** Already-percent 0–100 → "NN%". */
function pctRaw(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

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
      loading cell references…
    </div>
  );
}
