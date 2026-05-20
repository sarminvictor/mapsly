// /dev/tasks · full task tracker view.
// Phase 1 (this version): read-only list grouped by phase. Pulls directly
// from PLAN.md via the same parser the main dashboard uses.
// Phase 1.11.3+: filter chips, click-into-detail, edit-in-place — those land
// once the DB-backed Task table ships.

import Link from "next/link";
import { Suspense } from "react";
import AutoRefresh from "../AutoRefresh";
import RefreshButton from "../RefreshButton";
import { getPlanSummary, type PhaseRow } from "../queries/plan";

export const metadata = {
  title: "Mapsly · tasks",
  robots: { index: false, follow: false },
};

export default function TasksPage() {
  return (
    <div className="dev-wrap">
      <header className="dev-head">
        <div className="dev-head-left">
          <span className="dev-dot" aria-hidden />
          <div>
            <div className="dev-head-title">Mapsly · tasks</div>
            <div className="dev-status">all phases · all statuses</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/"
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
            ← dashboard
          </Link>
          <RefreshButton />
        </div>
      </header>

      <Suspense fallback={<div className="dev-empty">loading plan…</div>}>
        <TasksContent />
      </Suspense>

      <AutoRefresh intervalMs={60000} />
    </div>
  );
}

async function TasksContent() {
  const plan = await getPlanSummary();
  if (plan.total === 0) {
    return <div className="dev-empty">PLAN.md unreadable.</div>;
  }

  // Group by major phase (first segment of ID).
  const groups = new Map<string, PhaseRow[]>();
  for (const row of plan.rows) {
    const phase = row.id.split(".")[0];
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(row);
  }
  const orderedPhases = [...groups.keys()].sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SummaryBar plan={plan} />
      {orderedPhases.map((phase) => {
        const rows = groups.get(phase)!;
        const doneCt = rows.filter((r) => r.status === "done").length;
        return (
          <div key={phase} className="dev-card">
            <h2>
              Phase {phase} · {doneCt}/{rows.length} done
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rows.map((row) => (
                <TaskRow key={row.id} row={row} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryBar({
  plan,
}: {
  plan: Awaited<ReturnType<typeof getPlanSummary>>;
}) {
  return (
    <div
      className="dev-card"
      style={{
        display: "flex",
        gap: 24,
        alignItems: "center",
        fontSize: 13,
        color: "var(--dev-text-2)",
      }}
    >
      <div>
        <strong style={{ color: "var(--dev-green)", fontSize: 22 }}>
          {plan.done}
        </strong>{" "}
        done
      </div>
      <div>
        <strong style={{ color: "var(--dev-amber)", fontSize: 22 }}>
          {plan.inProgress}
        </strong>{" "}
        in progress
      </div>
      <div>
        <strong style={{ fontSize: 22 }}>{plan.pending}</strong> pending
      </div>
      {plan.blocked > 0 && (
        <div>
          <strong style={{ color: "var(--dev-red)", fontSize: 22 }}>
            {plan.blocked}
          </strong>{" "}
          blocked
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div
          style={{
            height: 8,
            background: "var(--dev-bg-3)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${plan.percent}%`,
              height: "100%",
              background: "var(--dev-indigo)",
            }}
          />
        </div>
      </div>
      <div className="dev-mono" style={{ fontSize: 12 }}>
        {plan.percent}% · {plan.done}/{plan.total}
      </div>
    </div>
  );
}

function TaskRow({ row }: { row: PhaseRow }) {
  const statusConfig: Record<
    string,
    { bg: string; color: string; label: string }
  > = {
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
      label: "queued",
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
  const cfg = statusConfig[row.status] ?? statusConfig.pending;

  return (
    <div
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
        className="dev-mono"
        style={{
          fontSize: 10,
          padding: "2px 6px",
          borderRadius: 4,
          background: cfg.bg,
          color: cfg.color,
          minWidth: 60,
          textAlign: "center",
        }}
      >
        {cfg.label}
      </span>
      <span
        className="dev-mono"
        style={{
          fontSize: 11,
          color: "var(--dev-text-3)",
          minWidth: 56,
        }}
      >
        {row.id}
      </span>
      <span style={{ flex: 1, color: "var(--dev-text)" }}>
        {row.description}
      </span>
      {row.tags && (
        <span
          className="dev-mono"
          style={{
            fontSize: 10,
            color: "var(--dev-text-3)",
            opacity: 0.7,
          }}
        >
          {row.tags}
        </span>
      )}
      <span
        className="dev-mono"
        style={{
          fontSize: 10,
          color: "var(--dev-text-3)",
          minWidth: 20,
          textAlign: "center",
        }}
      >
        {row.effort}
      </span>
    </div>
  );
}
