/**
 * /admin/cron-runs · operational view of every cron + admin-job CronRun.
 *
 * Top: per-job aggregate strip (last 7d).
 * Below: recent runs table with status pills.
 * Drilldown: ?run={id} expands meta JSON inline.
 *
 * Pattern 2 (sync shell + Suspense'd async body) + Pattern 3
 * (searchParams unwrapped inside the boundary).
 */

import { Suspense } from "react";
import { connection } from "next/server";

import {
  getCronRunsView,
  getCronRunDetail,
  type CronRunListFilters,
} from "./queries";

interface PageSearch {
  job?: string;
  status?: string;
  days?: string;
  run?: string;
}

export default function CronRunsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 className="admin-h1">Cron runs</h1>
        <p className="admin-sub">
          Every cron + admin-triggered job opens a CronRun row · this is the
          audit trail. Filter by job + status; click a row to see the meta JSON.
        </p>
      </header>
      <Suspense fallback={<LoadingPanel />}>
        <CronRunsBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CronRunsBody({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  await connection();
  const sp = await searchParams;

  const filters: CronRunListFilters = {
    job: sp.job,
    status: parseStatus(sp.status),
    sinceDays: sp.days ? Math.max(1, Math.min(90, Number(sp.days))) : 7,
    limit: 100,
  };

  const view = await getCronRunsView(filters);
  const detail = sp.run ? await getCronRunDetail(sp.run) : null;

  return (
    <>
      {/* Per-job aggregates */}
      <section
        style={{
          marginBottom: 20,
          background: "var(--admin-bg-2)",
          border: "1px solid var(--admin-border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--admin-text-3)",
            fontWeight: 600,
          }}
        >
          Last {filters.sinceDays} days · {view.jobs.length} jobs
        </h2>
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
          }}
        >
          {view.jobs.map((j) => (
            <div
              key={j.job}
              style={{
                background: "var(--admin-bg-3)",
                border: "1px solid var(--admin-border)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--admin-text)",
                  fontWeight: 600,
                }}
              >
                {j.job}
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                }}
              >
                <span style={{ color: "var(--admin-ok)" }}>✓ {j.okCount}</span>
                {j.failedCount > 0 ? (
                  <span style={{ color: "var(--admin-err)" }}>
                    ✗ {j.failedCount}
                  </span>
                ) : null}
                {j.partialCount > 0 ? (
                  <span style={{ color: "var(--admin-warn)" }}>
                    ◐ {j.partialCount}
                  </span>
                ) : null}
                {j.runningCount > 0 ? (
                  <span style={{ color: "var(--admin-gold)" }}>
                    ⟳ {j.runningCount}
                  </span>
                ) : null}
                <span
                  style={{ color: "var(--admin-text-3)", marginLeft: "auto" }}
                >
                  ${j.totalCostUsd.toFixed(4)}
                </span>
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--admin-text-3)",
                }}
              >
                Last: {j.lastRunAt ? relativeAgo(j.lastRunAt) : "never"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Filter row */}
      <FilterRow filters={filters} jobNames={view.jobNames} />

      {/* Detail panel (if a run is selected) */}
      {detail ? (
        <section
          style={{
            marginBottom: 20,
            background: "var(--admin-bg-2)",
            border: "1px solid var(--admin-border)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="admin-pill"
              data-status={mapStatusToPill(detail.status)}
            >
              {detail.status}
            </span>
            <code style={{ fontSize: 12 }}>{detail.job}</code>
            <span style={{ fontSize: 11, color: "var(--admin-text-3)" }}>
              {detail.durationSec != null
                ? `${detail.durationSec}s`
                : "running"}
              {detail.costUsd != null ? ` · $${detail.costUsd.toFixed(4)}` : ""}
              {` · ${detail.itemsProcessed} items`}
            </span>
            <a
              href="?"
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--admin-text-3)",
              }}
            >
              close ×
            </a>
          </div>
          {detail.errorMessage ? (
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "rgba(255,80,80,0.08)",
                color: "var(--admin-err)",
                borderRadius: 8,
                fontSize: 11,
                whiteSpace: "pre-wrap",
              }}
            >
              {detail.errorMessage}
            </pre>
          ) : null}
          {detail.meta ? (
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: "var(--admin-bg-3)",
                color: "var(--admin-text)",
                borderRadius: 8,
                fontSize: 11,
                whiteSpace: "pre-wrap",
                maxHeight: 320,
                overflow: "auto",
              }}
            >
              {JSON.stringify(detail.meta, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}

      {/* Runs table */}
      <div className="admin-table-wrapper" style={{ overflowX: "auto" }}>
        <table className="admin-table" style={{ width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <Th>Started</Th>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th align="right">Items</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Duration</Th>
              <Th>Error</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--admin-text-2)",
                  }}
                >
                  No runs in the selected window.
                </td>
              </tr>
            ) : (
              view.rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <a
                      href={`?run=${r.id}`}
                      style={{
                        color: "var(--admin-text)",
                        textDecoration: "none",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                      }}
                    >
                      {new Date(r.startedAt).toLocaleString()}
                    </a>
                  </Td>
                  <Td>
                    <code style={{ fontSize: 11 }}>{r.job}</code>
                  </Td>
                  <Td>
                    <span
                      className="admin-pill"
                      data-status={mapStatusToPill(r.status)}
                    >
                      {r.status}
                    </span>
                  </Td>
                  <Td align="right">{r.itemsProcessed}</Td>
                  <Td align="right">
                    {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "—"}
                  </Td>
                  <Td align="right">
                    {r.durationSec != null ? `${r.durationSec}s` : "—"}
                  </Td>
                  <Td>
                    {r.errorMessage ? (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--admin-err)",
                          maxWidth: 240,
                          display: "inline-block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={r.errorMessage}
                      >
                        {r.errorMessage}
                      </span>
                    ) : (
                      <span style={{ color: "var(--admin-text-3)" }}>—</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {view.total > view.rows.length ? (
        <p
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "var(--admin-text-3)",
            textAlign: "center",
          }}
        >
          Showing {view.rows.length} of {view.total}. Use filters to narrow.
        </p>
      ) : null}
    </>
  );
}

function FilterRow({
  filters,
  jobNames,
}: {
  filters: CronRunListFilters;
  jobNames: string[];
}) {
  return (
    <form
      method="get"
      style={{
        marginBottom: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8,
      }}
    >
      <FilterField label="Job">
        <select
          name="job"
          defaultValue={filters.job ?? ""}
          className="admin-input"
          style={{ padding: "5px 8px", fontSize: 12 }}
        >
          <option value="">All jobs</option>
          {jobNames.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Status">
        <select
          name="status"
          defaultValue={filters.status ?? "ALL"}
          className="admin-input"
          style={{ padding: "5px 8px", fontSize: 12 }}
        >
          <option value="ALL">All</option>
          <option value="OK">OK</option>
          <option value="FAILED">Failed</option>
          <option value="PARTIAL">Partial</option>
          <option value="RUNNING">Running</option>
        </select>
      </FilterField>
      <FilterField label="Last N days">
        <select
          name="days"
          defaultValue={String(filters.sinceDays ?? 7)}
          className="admin-input"
          style={{ padding: "5px 8px", fontSize: 12 }}
        >
          <option value="1">1</option>
          <option value="7">7</option>
          <option value="14">14</option>
          <option value="30">30</option>
          <option value="90">90</option>
        </select>
      </FilterField>
      <button
        type="submit"
        className="admin-btn"
        data-variant="primary"
        style={{ alignSelf: "end", padding: "6px 14px", fontSize: 12 }}
      >
        Apply
      </button>
    </form>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--admin-text-3)",
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function parseStatus(
  raw: string | undefined,
): "OK" | "PARTIAL" | "FAILED" | "RUNNING" | "ALL" | undefined {
  if (!raw) return undefined;
  if (
    raw === "OK" ||
    raw === "PARTIAL" ||
    raw === "FAILED" ||
    raw === "RUNNING" ||
    raw === "ALL"
  ) {
    return raw;
  }
  return undefined;
}

function mapStatusToPill(status: string): string {
  switch (status) {
    case "OK":
      return "OK";
    case "PARTIAL":
      return "WARN";
    case "FAILED":
      return "FAILED";
    case "RUNNING":
      return "PENDING";
    default:
      return "PENDING";
  }
}

function relativeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--admin-text-3)",
        fontWeight: 600,
        borderBottom: "1px solid var(--admin-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "10px",
        textAlign: align ?? "left",
        verticalAlign: "middle",
        borderBottom: "1px solid var(--admin-border)",
        fontSize: 12,
        color: "var(--admin-text-2)",
      }}
    >
      {children}
    </td>
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
