// /dev/tasks · domain-grouped task tracker with inline controls.

import Link from "next/link";
import { Suspense } from "react";
import AutoRefresh from "../AutoRefresh";
import RefreshButton from "../RefreshButton";
import { getPlanSummary, type PhaseRow } from "../queries/plan";
import TaskRowControls from "./TaskRowControls";
import AddTaskButton from "./AddTaskButton";

export const metadata = {
  title: "Mapsly · tasks",
  robots: { index: false, follow: false },
};

const DOMAIN_LABELS: Record<string, string> = {
  FOUNDATION: "Foundation",
  MARKETING: "Marketing",
  DATA: "Data collection",
  COMPUTE: "Compute",
  SMB_PORTAL: "SMB portal",
  AGENCY_PORTAL: "Agency portal",
  BILLING: "Billing",
  OPS: "Ops",
  I18N: "i18n",
};

export default function TasksPage() {
  return (
    <div className="dev-wrap">
      <header className="dev-head">
        <div className="dev-head-left">
          <span className="dev-dot" aria-hidden />
          <div>
            <div className="dev-head-title">Mapsly · tasks</div>
            <div className="dev-status">
              9 groups · domain-organized · DB-backed
            </div>
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
  if (plan.error) {
    return (
      <div className="dev-empty" style={{ color: "var(--dev-warn, #d97706)" }}>
        <strong>tasks query failed</strong> — {plan.error}
        <br />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Likely a schema drift (Prisma client expects a column Neon
          doesn&apos;t have). See INC-23 / INC-37 in{" "}
          <code>.claude/memory/incidents.md</code>.
        </span>
      </div>
    );
  }
  if (plan.total === 0) {
    return (
      <div className="dev-empty">
        no tasks in DB · run <code>pnpm seed:plan</code>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        className="dev-card"
        style={{
          display: "flex",
          gap: 24,
          alignItems: "center",
          fontSize: 13,
          color: "var(--dev-text-2)",
          flexWrap: "wrap",
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
          running
        </div>
        <div>
          <strong style={{ fontSize: 22 }}>{plan.pending}</strong> queued
        </div>
        {plan.blocked > 0 && (
          <div>
            <strong style={{ color: "var(--dev-red)", fontSize: 22 }}>
              {plan.blocked}
            </strong>{" "}
            blocked
          </div>
        )}
        {plan.humanRequired > 0 && (
          <div>
            <strong style={{ color: "var(--dev-amber)", fontSize: 22 }}>
              {plan.humanRequired}
            </strong>{" "}
            need you
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
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
                background:
                  plan.percent === 100
                    ? "var(--dev-green)"
                    : "var(--dev-indigo)",
              }}
            />
          </div>
        </div>
        <div className="dev-mono" style={{ fontSize: 12 }}>
          {plan.percent}% · {plan.done}/{plan.total}
        </div>
      </div>

      {plan.groups.map((g) => (
        <div key={g.id} className="dev-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ display: "inline", marginRight: 8 }}>
                {g.id} · {g.name}
              </h2>
              <span
                className="dev-mono"
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "var(--dev-bg-3)",
                  color: "var(--dev-text-3)",
                }}
              >
                {DOMAIN_LABELS[g.domain] ?? g.domain}
              </span>
            </div>
            <div
              className="dev-mono"
              style={{ fontSize: 11, color: "var(--dev-text-3)" }}
            >
              {g.done}/{g.total} · {g.percent}%
            </div>
          </div>
          {g.description && (
            <div
              style={{
                fontSize: 12,
                color: "var(--dev-text-2)",
                fontStyle: "italic",
                marginBottom: 12,
              }}
            >
              {g.description}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {g.rows.map((row) => (
              <TaskRow key={row.id} row={row} />
            ))}
          </div>
          <AddTaskButton groupId={g.id} />
        </div>
      ))}
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
    failed: {
      bg: "rgba(239,68,68,.15)",
      color: "var(--dev-red)",
      label: "failed",
    },
    skipped: {
      bg: "var(--dev-bg-2)",
      color: "var(--dev-text-3)",
      label: "skipped",
    },
    "human-required": {
      bg: "rgba(245,158,11,.15)",
      color: "var(--dev-amber)",
      label: "your turn",
    },
  };
  const cfg = statusConfig[row.status] ?? statusConfig.pending;
  const dbStatusMap: Record<string, string> = {
    pending: "PENDING",
    in_progress: "IN_PROGRESS",
    done: "DONE",
    blocked: "BLOCKED",
    failed: "FAILED",
    skipped: "SKIPPED",
    "human-required": "HUMAN_REQUIRED",
  };

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
      <Link
        href={`/tasks/${row.id}`}
        className="dev-mono"
        style={{
          fontSize: 11,
          color: "var(--dev-text-3)",
          minWidth: 56,
          textDecoration: "none",
        }}
      >
        {row.id}
      </Link>
      <Link
        href={`/tasks/${row.id}`}
        style={{
          flex: 1,
          color: "var(--dev-text)",
          textDecoration: "none",
        }}
      >
        {row.description}
      </Link>
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
      <TaskRowControls
        taskId={row.id}
        current={dbStatusMap[row.status] ?? "PENDING"}
      />
    </div>
  );
}
