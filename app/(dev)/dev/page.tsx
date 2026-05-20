// Dev dashboard — fully wired data sources.
// Sections: hero KPIs · Blockers · Plan progress · Sessions · Service health
// · Recent commits · Open PRs.

import { Suspense } from "react";
import { version as pkgVersion } from "../../../package.json";
import Link from "next/link";
import AutoRefresh from "./AutoRefresh";
import RefreshButton from "./RefreshButton";
import {
  getRecentCommits,
  getOpenPrs,
  getRecentMerges,
} from "./queries/github";
import { getPlanSummary } from "./queries/plan";
import { getSessionsSummary } from "./queries/sessions";
import { getServiceHealth } from "./queries/services";
import { getBlockers } from "./queries/blockers";
import { getCronAggregate } from "./queries/cron";
import { getEnhanceSignals } from "./queries/enhance-signals";
import { getDoraMetrics } from "./queries/dora";
import { getCostBreakdown } from "./queries/cost";
import { getLoopState } from "./queries/loop";
import LoopControls from "./LoopControls";

export default function DevDashboard() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const version = pkgVersion;

  return (
    <div className="dev-wrap">
      <header className="dev-head">
        <div className="dev-head-left">
          <span className="dev-dot" aria-hidden />
          <div>
            <div className="dev-head-title">
              Mapsly · autonomous build status
            </div>
            <div className="dev-status">dev.mapsly.ai · phase 1</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="dev-pill">v{version}</span>
          <span className="dev-pill">{sha}</span>
          <Link
            href="/tasks"
            style={{
              fontSize: 11,
              padding: "5px 10px",
              background: "var(--dev-bg-3)",
              color: "var(--dev-text-2)",
              border: "1px solid var(--dev-border)",
              borderRadius: 6,
              textDecoration: "none",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            tasks →
          </Link>
          <RefreshButton />
        </div>
      </header>

      <section className="dev-hero">
        <Suspense fallback={<TileSkeleton label="open prs" />}>
          <OpenPrsTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="merges 7d" />}>
          <RecentMergesTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="avg score" />}>
          <AvgScoreTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="cost 7d" />}>
          <CostTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="plan progress" />}>
          <PlanTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="blockers" />}>
          <BlockersTile />
        </Suspense>
      </section>

      <div className="dev-card">
        <h2>Blockers · only items I cannot do programmatically</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <BlockersList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Loop control</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <LoopControlCard />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>DORA metrics</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <DoraCard />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Cost projection</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <CostCard />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Plan progress</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <PlanProgress />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Sessions · last 7 days</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <SessionsList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>External service health</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <ServicesGrid />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Cron + API health</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <CronList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Auto-enhance signals</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <EnhanceSignalsList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Recent commits</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <CommitsList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Open PRs</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <PrsList />
        </Suspense>
      </div>

      <AutoRefresh intervalMs={30000} />
      <footer
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          color: "var(--dev-text-3)",
          marginTop: 24,
          textAlign: "center",
        }}
      >
        mapsly · build status · internal · no index
      </footer>
    </div>
  );
}

// ---------- Hero tiles ----------

async function OpenPrsTile() {
  const prs = await getOpenPrs();
  const needsReview = prs.filter((p) =>
    p.labels.includes("needs-review"),
  ).length;
  return (
    <Tile
      label="open prs"
      value={String(prs.length)}
      sub={needsReview > 0 ? `${needsReview} need review` : "auto-merge queue"}
      tone={needsReview > 0 ? "amber" : undefined}
    />
  );
}

async function RecentMergesTile() {
  const merges = await getRecentMerges(20);
  return (
    <Tile
      label="merges 7d"
      value={String(merges.length)}
      sub="auto + manual"
      tone="green"
    />
  );
}

async function AvgScoreTile() {
  const s = await getSessionsSummary();
  return (
    <Tile
      label="avg score 7d"
      value={s.avgScore7d != null ? s.avgScore7d.toFixed(1) : "—"}
      sub={s.avgScore7d != null ? "threshold 9.0" : "no scored phases yet"}
      tone={s.avgScore7d != null && s.avgScore7d >= 9 ? "green" : "indigo"}
    />
  );
}

async function CostTile() {
  const cron = await getCronAggregate();
  return (
    <Tile
      label="api cost today"
      value={`$${cron.costToday.toFixed(2)}`}
      sub={`yesterday $${cron.costYesterday.toFixed(2)}`}
      tone={cron.costToday > 5 ? "amber" : undefined}
    />
  );
}

async function FailuresTile() {
  const cron = await getCronAggregate();
  return (
    <Tile
      label="failures 24h"
      value={String(cron.failures24h)}
      sub={`${cron.totalRuns24h} runs total`}
      tone={
        cron.failures24h === 0
          ? "green"
          : cron.failures24h < 3
            ? "amber"
            : "amber"
      }
    />
  );
}

async function PlanTile() {
  const p = await getPlanSummary();
  return (
    <Tile
      label="plan progress"
      value={`${p.percent}%`}
      sub={`${p.done} / ${p.total} done`}
      tone="indigo"
    />
  );
}

async function BlockersTile() {
  const b = await getBlockers();
  return (
    <Tile
      label="blockers"
      value={String(b.length)}
      sub={b.length === 0 ? "nothing waiting on you" : "your action needed"}
      tone={b.length === 0 ? "green" : "amber"}
    />
  );
}

// ---------- Loop control ----------

async function LoopControlCard() {
  const lock = await getLoopState();
  if (!lock) {
    return (
      <div className="dev-empty">
        loop-lock.json not found · loop hasn't run yet.
      </div>
    );
  }
  const stateColor = {
    idle: "var(--dev-green)",
    running: "var(--dev-amber)",
    cooldown: "var(--dev-text-3)",
    paused: "var(--dev-red)",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: stateColor[lock.state],
          }}
        />
        <span
          className="dev-mono"
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: stateColor[lock.state],
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {lock.state}
        </span>
        <span
          className="dev-mono"
          style={{ fontSize: 11, color: "var(--dev-text-3)", marginLeft: 8 }}
        >
          last tick {lock.lastTickAt}
        </span>
        {lock.cooldownUntil && (
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            cooldown until {lock.cooldownUntil}
          </span>
        )}
      </div>
      {lock.note && (
        <div
          style={{
            fontSize: 12,
            color: "var(--dev-text-2)",
            fontStyle: "italic",
          }}
        >
          {lock.note}
        </div>
      )}
      <LoopControls state={lock.state} cooldownUntil={lock.cooldownUntil} />
    </div>
  );
}

// ---------- Blockers ----------

async function BlockersList() {
  const blockers = await getBlockers();
  if (blockers.length === 0) {
    return (
      <div className="dev-empty">
        ✓ nothing waiting on you · every other open item is something I can do
        myself.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {blockers.map((b) => (
        <div
          key={b.id}
          style={{
            padding: "12px 14px",
            background: "var(--dev-bg-3)",
            border: "1px solid var(--dev-border)",
            borderLeft: `3px solid ${
              b.priority === "critical"
                ? "var(--dev-red)"
                : b.priority === "warn"
                  ? "var(--dev-amber)"
                  : "var(--dev-text-3)"
            }`,
            borderRadius: 8,
          }}
        >
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--dev-text)" }}
          >
            {b.title}
          </div>
          <div
            className="dev-mono"
            style={{
              fontSize: 11,
              color: "var(--dev-text-3)",
              marginTop: 4,
            }}
          >
            why: {b.reason}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--dev-text-2)",
              marginTop: 6,
            }}
          >
            → {b.action}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- DORA ----------

async function DoraCard() {
  const m = await getDoraMetrics();
  const cell = {
    padding: "10px 12px",
    background: "var(--dev-bg-3)",
    border: "1px solid var(--dev-border)",
    borderRadius: 6,
    flex: 1,
    minWidth: 140,
  } as const;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <div style={cell}>
        <div className="dev-tile-label">deploy freq · 7d</div>
        <div className="dev-tile-num">{m.deployFrequency.last7d}</div>
        <div className="dev-tile-sub">{m.deployFrequency.last30d} in 30d</div>
      </div>
      <div style={cell}>
        <div className="dev-tile-label">lead time p50</div>
        <div className="dev-tile-num">
          {m.leadTimeP50Hours != null ? `${m.leadTimeP50Hours}h` : "—"}
        </div>
        <div className="dev-tile-sub">
          p95 {m.leadTimeP95Hours != null ? `${m.leadTimeP95Hours}h` : "—"}
        </div>
      </div>
      <div style={cell}>
        <div className="dev-tile-label">change failure rate</div>
        <div
          className={`dev-tile-num${m.changeFailureRate.last7d > 15 ? " amber" : m.changeFailureRate.last7d > 30 ? " amber" : ""}`}
        >
          {m.changeFailureRate.last7d}%
        </div>
        <div className="dev-tile-sub">7d · target ≤ 15%</div>
      </div>
      <div style={cell}>
        <div className="dev-tile-label">mttr</div>
        <div className="dev-tile-num">
          {m.mttrHours != null ? `${m.mttrHours}h` : "—"}
        </div>
        <div className="dev-tile-sub">
          {m.mttrHours == null ? "no incidents to measure" : "target ≤ 1h"}
        </div>
      </div>
    </div>
  );
}

// ---------- Cost projection ----------

async function CostCard() {
  const c = await getCostBreakdown();
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const statusColor = {
    ok: "var(--dev-green)",
    warn: "var(--dev-amber)",
    halt: "var(--dev-red)",
  }[c.budget.status];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="dev-tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="dev-tile-label">today</div>
          <div className="dev-tile-num" style={{ color: statusColor }}>
            {usd(c.totalToday)}
          </div>
          <div className="dev-tile-sub">
            of {usd(c.budget.dailyUsd)} · {c.budget.status}
          </div>
        </div>
        <div className="dev-tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="dev-tile-label">this week</div>
          <div className="dev-tile-num">{usd(c.totalThisWeek)}</div>
          <div className="dev-tile-sub">7d rolling</div>
        </div>
        <div className="dev-tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="dev-tile-label">this month</div>
          <div className="dev-tile-num">{usd(c.totalThisMonth)}</div>
          <div className="dev-tile-sub">to date</div>
        </div>
        <div className="dev-tile" style={{ flex: 1, minWidth: 140 }}>
          <div className="dev-tile-label">projected month-end</div>
          <div
            className="dev-tile-num"
            style={{
              color: c.projectedMonthEnd > 150 ? "var(--dev-amber)" : undefined,
            }}
          >
            {usd(c.projectedMonthEnd)}
          </div>
          <div className="dev-tile-sub">linear projection</div>
        </div>
      </div>
      {c.byVendor.length > 0 && (
        <div>
          <div
            className="dev-mono"
            style={{
              fontSize: 10,
              color: "var(--dev-text-3)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            by vendor · 7d
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {c.byVendor.slice(0, 8).map((v) => (
              <div
                key={v.vendor}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 12,
                  padding: "6px 10px",
                  background: "var(--dev-bg-3)",
                  border: "1px solid var(--dev-border)",
                  borderRadius: 6,
                }}
              >
                <span className="dev-mono" style={{ minWidth: 120 }}>
                  {v.vendor}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: "var(--dev-bg-2)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (v.usd / Math.max(...c.byVendor.map((x) => x.usd))) * 100)}%`,
                      height: "100%",
                      background: "var(--dev-indigo)",
                    }}
                  />
                </div>
                <span
                  className="dev-mono"
                  style={{ minWidth: 60, textAlign: "right" }}
                >
                  {usd(v.usd)}
                </span>
                <span
                  className="dev-mono"
                  style={{
                    minWidth: 60,
                    textAlign: "right",
                    color: "var(--dev-text-3)",
                  }}
                >
                  {v.calls} calls
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {c.byVendor.length === 0 && (
        <div className="dev-empty">
          no API spend yet · cron handlers haven&apos;t run.
        </div>
      )}
    </div>
  );
}

// ---------- Plan progress ----------

async function PlanProgress() {
  const p = await getPlanSummary();
  if (p.total === 0) {
    return <div className="dev-empty">PLAN.md not found or empty.</div>;
  }
  const recent = p.rows.filter(
    (r) => r.status === "in_progress" || r.status === "pending",
  );
  // Show the next 12 actionable rows
  const next = recent.slice(0, 12);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 14,
          fontSize: 12,
          color: "var(--dev-text-2)",
        }}
      >
        <span>
          <strong style={{ color: "var(--dev-green)" }}>{p.done}</strong> done
        </span>
        <span>
          <strong style={{ color: "var(--dev-amber)" }}>{p.inProgress}</strong>{" "}
          in progress
        </span>
        <span>
          <strong>{p.pending}</strong> pending
        </span>
        {p.blocked > 0 && (
          <span>
            <strong style={{ color: "var(--dev-red)" }}>{p.blocked}</strong>{" "}
            blocked
          </span>
        )}
      </div>
      <div
        style={{
          height: 8,
          background: "var(--dev-bg-3)",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: `${p.percent}%`,
            height: "100%",
            background:
              p.percent === 100 ? "var(--dev-green)" : "var(--dev-indigo)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {next.map((row) => (
          <div
            key={row.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 12px",
              fontSize: 12,
              background: "var(--dev-bg-3)",
              border: "1px solid var(--dev-border)",
              borderRadius: 6,
            }}
          >
            <StatusPill status={row.status} />
            <span
              className="dev-mono"
              style={{ color: "var(--dev-text-3)", fontSize: 11 }}
            >
              {row.id}
            </span>
            <span style={{ flex: 1, color: "var(--dev-text)" }}>
              {row.description}
            </span>
            <span
              className="dev-mono"
              style={{ fontSize: 10, color: "var(--dev-text-3)" }}
            >
              {row.effort}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    done: {
      bg: "rgba(34,197,94,.15)",
      color: "var(--dev-green)",
      label: "done",
    },
    in_progress: {
      bg: "rgba(245,158,11,.15)",
      color: "var(--dev-amber)",
      label: "running",
    },
    pending: {
      bg: "var(--dev-bg-2)",
      color: "var(--dev-text-2)",
      label: "next",
    },
    blocked: {
      bg: "rgba(239,68,68,.15)",
      color: "var(--dev-red)",
      label: "blocked",
    },
    "human-required": {
      bg: "rgba(245,158,11,.15)",
      color: "var(--dev-amber)",
      label: "your turn",
    },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <span
      className="dev-mono"
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: cfg.bg,
        color: cfg.color,
        minWidth: 56,
        textAlign: "center",
      }}
    >
      {cfg.label}
    </span>
  );
}

// ---------- Sessions ----------

async function SessionsList() {
  const s = await getSessionsSummary();
  if (s.total === 0) {
    return (
      <div className="dev-empty">
        no autonomous sessions recorded yet · first scheduled run pending.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {s.last7d.slice(0, 7).map((rec) => (
        <div
          key={rec.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            background: "var(--dev-bg-3)",
            border: "1px solid var(--dev-border)",
            borderRadius: 8,
          }}
        >
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {rec.id}
          </span>
          <span style={{ fontSize: 12, flex: 1 }}>
            shipped {rec.tasksShipped?.length ?? 0} · merged{" "}
            {rec.prsAutoMerged?.length ?? 0} · avg score{" "}
            {rec.scoreAvg?.toFixed(1) ?? "—"}
          </span>
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            ${(rec.costUsd ?? 0).toFixed(2)} · {rec.exit ?? "running"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Service health ----------

async function ServicesGrid() {
  const services = await getServiceHealth();
  const whereMap = {
    "vercel-env": "set in Vercel → Settings → Environment Variables",
    "vercel-storage":
      "create at Vercel → Storage (env vars auto-inject after provision)",
    "third-party-account": "sign up at provider, paste key in Vercel env",
  } as const;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 8,
      }}
    >
      {services.map((svc) => {
        const state: "ok" | "missing" | "down" | "optional" = !svc.configured
          ? svc.optional
            ? "optional"
            : "missing"
          : svc.reachable === false
            ? "down"
            : "ok";
        const colorMap: Record<typeof state, string> = {
          ok: "var(--dev-green)",
          missing: "var(--dev-amber)",
          down: "var(--dev-red)",
          optional: "var(--dev-text-3)",
        };
        return (
          <div
            key={svc.name}
            style={{
              padding: "10px 12px",
              background: "var(--dev-bg-3)",
              border: "1px solid var(--dev-border)",
              borderLeft: `3px solid ${colorMap[state]}`,
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: colorMap[state],
                }}
              />
              <span style={{ fontWeight: 600 }}>{svc.name}</span>
              <span
                className="dev-mono"
                style={{
                  fontSize: 9,
                  color: "var(--dev-text-3)",
                  marginLeft: "auto",
                }}
              >
                {state}
              </span>
            </div>
            <div
              className="dev-mono"
              style={{
                fontSize: 10,
                color: "var(--dev-text-2)",
                marginTop: 4,
              }}
            >
              {svc.detail}
            </div>
            <div
              className="dev-mono"
              style={{
                fontSize: 10,
                color: "var(--dev-text-3)",
                marginTop: 4,
              }}
            >
              env: {svc.expects}
            </div>
            {state === "missing" && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--dev-text-2)",
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: "1px solid var(--dev-border)",
                }}
              >
                → {whereMap[svc.where]}
              </div>
            )}
            {state === "optional" && svc.optional && (
              <div
                className="dev-mono"
                style={{
                  fontSize: 10,
                  color: "var(--dev-text-3)",
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: "1px solid var(--dev-border)",
                  fontStyle: "italic",
                }}
              >
                optional · defer to {svc.optional.phase}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Commits + PRs (unchanged from earlier wiring) ----------

async function CommitsList() {
  const commits = await getRecentCommits(8);
  if (commits.length === 0) {
    return (
      <div className="dev-empty">
        no commits visible · check GITHUB_TOKEN in Vercel env.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {commits.map((c) => (
        <a
          key={c.sha}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--dev-bg-3)",
            color: "var(--dev-text)",
            textDecoration: "none",
            border: "1px solid var(--dev-border)",
          }}
        >
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {c.short}
          </span>
          <span style={{ fontSize: 13, flex: 1 }}>{c.message}</span>
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {c.author}
          </span>
        </a>
      ))}
    </div>
  );
}

async function PrsList() {
  const prs = await getOpenPrs();
  if (prs.length === 0) {
    return <div className="dev-empty">no open PRs · queue is clean.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {prs.slice(0, 10).map((pr) => (
        <a
          key={pr.number}
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--dev-bg-3)",
            color: "var(--dev-text)",
            textDecoration: "none",
            border: "1px solid var(--dev-border)",
          }}
        >
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            #{pr.number}
          </span>
          <span style={{ fontSize: 13, flex: 1 }}>{pr.title}</span>
          {pr.labels.length > 0 && (
            <span style={{ display: "flex", gap: 4 }}>
              {pr.labels.slice(0, 3).map((l) => (
                <span
                  key={l}
                  className="dev-mono"
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: l.includes("ready")
                      ? "rgba(34,197,94,.15)"
                      : l.includes("review")
                        ? "rgba(245,158,11,.15)"
                        : "var(--dev-bg-2)",
                    color: "var(--dev-text-2)",
                  }}
                >
                  {l}
                </span>
              ))}
            </span>
          )}
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {pr.author}
          </span>
        </a>
      ))}
    </div>
  );
}

// ---------- Cron list ----------

async function CronList() {
  const cron = await getCronAggregate();
  if (cron.recentJobs.length === 0) {
    return (
      <div className="dev-empty">
        no cron runs in last 24h · first scheduled cron lands in phase 3.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {cron.recentJobs.map((j, idx) => (
        <div
          key={`${j.job}-${idx}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 12px",
            fontSize: 12,
            background: "var(--dev-bg-3)",
            border: "1px solid var(--dev-border)",
            borderRadius: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background:
                j.status === "FAILED"
                  ? "var(--dev-red)"
                  : j.status === "PARTIAL"
                    ? "var(--dev-amber)"
                    : "var(--dev-green)",
            }}
          />
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {j.startedAt.slice(11, 16)}
          </span>
          <span style={{ flex: 1 }}>{j.job}</span>
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            ${j.costUsd.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Enhance signals ----------

async function EnhanceSignalsList() {
  const signals = await getEnhanceSignals();
  if (signals.length === 0) {
    return (
      <div className="dev-empty">
        no patterns detected · process-enhancer runs at end of every session.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {signals.map((s) => (
        <div
          key={s.id}
          style={{
            padding: "10px 12px",
            background: "var(--dev-bg-3)",
            border: "1px solid var(--dev-border)",
            borderLeft: `3px solid ${
              s.severity === "error"
                ? "var(--dev-red)"
                : s.severity === "warn"
                  ? "var(--dev-amber)"
                  : "var(--dev-text-3)"
            }`,
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
            <span
              className="dev-mono"
              style={{ fontSize: 11, color: "var(--dev-text-3)" }}
            >
              {s.category}
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>{s.headline}</span>
            {s.prUrl && (
              <a
                href={s.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dev-mono"
                style={{ fontSize: 11, color: "var(--dev-indigo)" }}
              >
                PR →
              </a>
            )}
          </div>
          <div
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)", marginTop: 4 }}
          >
            {s.evidence}
          </div>
          <div
            style={{ fontSize: 12, color: "var(--dev-text-2)", marginTop: 6 }}
          >
            → {s.action}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Reusable ----------

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "green" | "indigo" | "amber";
}) {
  return (
    <div className="dev-tile">
      <div className="dev-tile-label">{label}</div>
      <div className={`dev-tile-num${tone ? " " + tone : ""}`}>{value}</div>
      <div className="dev-tile-sub">{sub}</div>
    </div>
  );
}

function TileSkeleton({ label }: { label: string }) {
  return (
    <div className="dev-tile">
      <div className="dev-tile-label">{label}</div>
      <div className="dev-tile-num" style={{ opacity: 0.3 }}>
        …
      </div>
      <div className="dev-tile-sub">loading</div>
    </div>
  );
}
