/**
 * /admin/cron-runs · operational view of every cron + admin-job CronRun.
 *
 * Sections (top to bottom):
 *   - Category tabs (Scheduled · Manual · Worker · Pingbacks · Internal)
 *   - Per-category aggregate strip (last N days · only jobs in active tab)
 *   - Filter row (job · status · days)
 *   - Detail panel (?run={id})
 *       - Meta + status + cost
 *       - Trigger chain · what this run fired off
 *       - Raw meta JSON
 *   - Recent runs table (filtered to active category)
 *
 * Pattern 2 (sync shell + Suspense'd async body) + Pattern 3
 * (searchParams unwrapped inside the boundary).
 */

import { Suspense } from "react";
import { connection } from "next/server";

import {
  getCronRunsView,
  getCronRunDetail,
  getTriggerChain,
  CATEGORY_META,
  type CronRunCategory,
  type CronRunListFilters,
  type CategoryAggregate,
  type TriggerChain,
} from "./queries";

interface PageSearch {
  job?: string;
  category?: string;
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
          Every cron + admin-triggered job opens a CronRun row · audit trail for
          the whole system. Filter by category + job + status; click a row to
          see meta JSON + downstream trigger chain.
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
    category: parseCategory(sp.category),
    status: parseStatus(sp.status),
    sinceDays: sp.days ? Math.max(1, Math.min(90, Number(sp.days))) : 7,
    limit: 100,
  };

  const [view, detail, chain] = await Promise.all([
    getCronRunsView(filters),
    sp.run ? getCronRunDetail(sp.run) : Promise.resolve(null),
    sp.run ? getTriggerChain(sp.run) : Promise.resolve(null),
  ]);

  const activeCategory: CronRunCategory | "ALL" = filters.category ?? "ALL";

  return (
    <>
      {/* ─── Category tabs ────────────────────────────────────────── */}
      <CategoryTabs
        active={activeCategory}
        categories={view.categories}
        filters={filters}
      />

      {/* ─── Per-category aggregate strip ─────────────────────────── */}
      <CategoryAggregates
        active={activeCategory}
        categories={view.categories}
        sinceDays={filters.sinceDays ?? 7}
      />

      {/* ─── Filters ──────────────────────────────────────────────── */}
      <FilterRow
        filters={filters}
        jobNames={view.jobNames}
        activeCategory={activeCategory}
      />

      {/* ─── Detail panel ─────────────────────────────────────────── */}
      {detail ? <DetailPanel detail={detail} chain={chain} /> : null}

      {/* ─── Runs table ───────────────────────────────────────────── */}
      <div className="admin-table-wrapper" style={{ overflowX: "auto" }}>
        <table className="admin-table" style={{ width: "100%", minWidth: 960 }}>
          <thead>
            <tr>
              <Th>Started</Th>
              <Th>Category</Th>
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
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    padding: 32,
                    color: "var(--admin-text-2)",
                  }}
                >
                  No runs match the current filters.
                </td>
              </tr>
            ) : (
              view.rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <a
                      href={buildQuery({ ...sp, run: r.id })}
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
                    <CategoryBadge category={r.category} />
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

// ─── Category tabs ──────────────────────────────────────────────────

function CategoryTabs({
  active,
  categories,
  filters,
}: {
  active: CronRunCategory | "ALL";
  categories: CategoryAggregate[];
  filters: CronRunListFilters;
}) {
  // Always render all defined categories (stable layout). Empty ones
  // get muted styling.
  const counts = new Map(categories.map((c) => [c.category, c.totalRuns]));
  const allCats: (CronRunCategory | "ALL")[] = [
    "ALL",
    ...(Object.keys(CATEGORY_META) as CronRunCategory[]),
  ];
  const totalAll = categories.reduce((sum, c) => sum + c.totalRuns, 0);

  return (
    <nav
      aria-label="Filter by trigger source"
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      {allCats.map((cat) => {
        const isActive = active === cat;
        const isAll = cat === "ALL";
        const label = isAll ? "All" : CATEGORY_META[cat].label;
        const icon = isAll ? "•" : CATEGORY_META[cat].icon;
        const count = isAll ? totalAll : (counts.get(cat) ?? 0);
        const muted = !isAll && count === 0;
        const href = buildCategoryHref(filters, isAll ? null : cat);

        return (
          <a
            key={cat}
            href={href}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              textDecoration: "none",
              background: isActive ? "var(--admin-text)" : "var(--admin-bg-2)",
              color: isActive
                ? "var(--admin-bg)"
                : muted
                  ? "var(--admin-text-3)"
                  : "var(--admin-text)",
              border: `1px solid ${isActive ? "var(--admin-text)" : "var(--admin-border)"}`,
              fontWeight: isActive ? 600 : 500,
              opacity: muted ? 0.6 : 1,
            }}
          >
            <span aria-hidden style={{ fontSize: 12 }}>
              {icon}
            </span>
            {label}
            <span
              style={{
                fontSize: 10,
                padding: "0 6px",
                borderRadius: 999,
                background: isActive
                  ? "rgba(255,255,255,0.15)"
                  : "var(--admin-bg-3)",
                color: isActive ? "var(--admin-bg)" : "var(--admin-text-3)",
              }}
            >
              {count}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

// ─── Category aggregate strip ───────────────────────────────────────

function CategoryAggregates({
  active,
  categories,
  sinceDays,
}: {
  active: CronRunCategory | "ALL";
  categories: CategoryAggregate[];
  sinceDays: number;
}) {
  // If a category is selected, show jobs INSIDE it. Otherwise show
  // category headers as the top-level aggregates.
  const visible =
    active === "ALL"
      ? categories
      : categories.filter((c) => c.category === active);

  if (visible.length === 0) {
    return (
      <section
        style={{
          marginBottom: 20,
          padding: "16px 20px",
          background: "var(--admin-bg-2)",
          border: "1px solid var(--admin-border)",
          borderRadius: 12,
          fontSize: 12,
          color: "var(--admin-text-3)",
        }}
      >
        No runs in{" "}
        {active === "ALL"
          ? "the last"
          : `${CATEGORY_META[active].label} category in the last`}{" "}
        {sinceDays} days.
      </section>
    );
  }

  return (
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
        Last {sinceDays} days ·{" "}
        {active === "ALL"
          ? `${categories.length} categories`
          : CATEGORY_META[active].description}
      </h2>

      {/* Per-category headers — only in ALL view */}
      {active === "ALL" ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {visible.map((c) => (
            <a
              key={c.category}
              href={`?category=${c.category}`}
              style={{
                background: "var(--admin-bg-3)",
                border: "1px solid var(--admin-border)",
                borderRadius: 10,
                padding: 12,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--admin-text)",
                  fontWeight: 600,
                }}
              >
                <span aria-hidden>{CATEGORY_META[c.category].icon}</span>
                {CATEGORY_META[c.category].label}
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
                <span style={{ color: "var(--admin-ok)" }}>✓ {c.okCount}</span>
                {c.failedCount > 0 ? (
                  <span style={{ color: "var(--admin-err)" }}>
                    ✗ {c.failedCount}
                  </span>
                ) : null}
                {c.partialCount > 0 ? (
                  <span style={{ color: "var(--admin-warn)" }}>
                    ◐ {c.partialCount}
                  </span>
                ) : null}
                {c.runningCount > 0 ? (
                  <span style={{ color: "var(--admin-gold)" }}>
                    ⟳ {c.runningCount}
                  </span>
                ) : null}
                <span
                  style={{
                    color: "var(--admin-text-3)",
                    marginLeft: "auto",
                  }}
                >
                  ${c.totalCostUsd.toFixed(4)}
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
                {c.jobs.length} job{c.jobs.length === 1 ? "" : "s"} ·{" "}
                {c.totalRuns} runs
              </div>
            </a>
          ))}
        </div>
      ) : (
        // Per-job within the active category
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
          }}
        >
          {visible[0].jobs.map((j) => (
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
      )}
    </section>
  );
}

// ─── Detail panel ───────────────────────────────────────────────────

function DetailPanel({
  detail,
  chain,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCronRunDetail>>>;
  chain: TriggerChain | null;
}) {
  const hasChildren = chain && chain.children.length > 0;
  return (
    <section
      style={{
        marginBottom: 20,
        background: "var(--admin-bg-2)",
        border: "1px solid var(--admin-border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          className="admin-pill"
          data-status={mapStatusToPill(detail.status)}
        >
          {detail.status}
        </span>
        <CategoryBadge category={detail.category} />
        <code style={{ fontSize: 12 }}>{detail.job}</code>
        <span style={{ fontSize: 11, color: "var(--admin-text-3)" }}>
          {detail.durationSec != null ? `${detail.durationSec}s` : "running"}
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

      {/* ─── Trigger chain · NEW ─────────────────────────────── */}
      <TriggerChainView chain={chain} hasChildren={Boolean(hasChildren)} />

      {detail.meta ? (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--admin-text-3)",
              cursor: "pointer",
            }}
          >
            Meta JSON
          </summary>
          <pre
            style={{
              marginTop: 8,
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
        </details>
      ) : null}
    </section>
  );
}

function TriggerChainView({
  chain,
  hasChildren,
}: {
  chain: TriggerChain | null;
  hasChildren: boolean;
}) {
  if (!chain) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--admin-text-3)",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>Trigger chain · downstream runs</span>
        {hasChildren ? (
          <span style={{ color: "var(--admin-text)" }}>
            {chain.children.length} fired · $
            {chain.childrenTotalCostUsd.toFixed(4)} total
          </span>
        ) : null}
      </div>

      {hasChildren ? (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {chain.children.map((c) => (
            <li
              key={c.id}
              style={{
                display: "grid",
                gridTemplateColumns: "50px 90px 1fr 70px 80px 60px",
                gap: 10,
                alignItems: "center",
                padding: "6px 10px",
                background: "var(--admin-bg-3)",
                border: "1px solid var(--admin-border)",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            >
              <span
                style={{
                  color: "var(--admin-text-3)",
                  fontSize: 10,
                }}
                title={`${c.offsetSec}s after parent started`}
              >
                +{formatOffset(c.offsetSec)}
              </span>
              <CategoryBadge category={c.category} compact />
              <a
                href={`?run=${c.id}`}
                style={{
                  color: "var(--admin-text)",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <code style={{ fontSize: 10 }}>{c.job}</code>
                {c.businessId ? (
                  <span
                    style={{
                      color: "var(--admin-text-3)",
                      fontSize: 9,
                      marginLeft: 6,
                    }}
                  >
                    biz_{c.businessId.slice(-6)}
                  </span>
                ) : null}
              </a>
              <span
                className="admin-pill"
                data-status={mapStatusToPill(c.status)}
                style={{ fontSize: 9 }}
              >
                {c.status}
              </span>
              <span
                style={{
                  color: "var(--admin-text-3)",
                  textAlign: "right",
                }}
              >
                {c.itemsProcessed} items
              </span>
              <span
                style={{
                  color: "var(--admin-text-3)",
                  textAlign: "right",
                }}
              >
                {c.costUsd != null ? `$${c.costUsd.toFixed(4)}` : "—"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p
          style={{
            fontSize: 11,
            color: "var(--admin-text-3)",
            margin: 0,
            fontStyle: "italic",
          }}
        >
          No downstream runs detected. Either this is a leaf job, or the
          children haven&apos;t fired yet (e.g., DfS pingback still computing,
          can take 1–45 min).
        </p>
      )}
    </div>
  );
}

// ─── Filter row ─────────────────────────────────────────────────────

function FilterRow({
  filters,
  jobNames,
  activeCategory,
}: {
  filters: CronRunListFilters;
  jobNames: string[];
  activeCategory: CronRunCategory | "ALL";
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
      {/* Keep category in the form so submitting filter doesn't reset tabs */}
      {activeCategory !== "ALL" ? (
        <input type="hidden" name="category" value={activeCategory} />
      ) : null}
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

// ─── Small atoms ────────────────────────────────────────────────────

function CategoryBadge({
  category,
  compact,
}: {
  category: CronRunCategory;
  compact?: boolean;
}) {
  const meta = CATEGORY_META[category];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: compact ? "1px 6px" : "2px 8px",
        borderRadius: 999,
        background: "var(--admin-bg-3)",
        border: "1px solid var(--admin-border)",
        color: "var(--admin-text-2)",
        fontFamily: "var(--font-mono)",
        fontSize: compact ? 9 : 10,
      }}
      title={meta.description}
    >
      <span aria-hidden style={{ fontSize: compact ? 10 : 11 }}>
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

function formatOffset(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
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

function parseCategory(
  raw: string | undefined,
): CronRunCategory | "ALL" | undefined {
  if (!raw) return undefined;
  if (raw === "ALL") return "ALL";
  if (raw in CATEGORY_META) return raw as CronRunCategory;
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

function buildCategoryHref(
  filters: CronRunListFilters,
  cat: CronRunCategory | null,
): string {
  const params = new URLSearchParams();
  if (cat) params.set("category", cat);
  if (filters.status && filters.status !== "ALL")
    params.set("status", filters.status);
  if (filters.sinceDays && filters.sinceDays !== 7)
    params.set("days", String(filters.sinceDays));
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

function buildQuery(sp: PageSearch & { run?: string }): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v != null && v !== "" && v !== "ALL") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
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
