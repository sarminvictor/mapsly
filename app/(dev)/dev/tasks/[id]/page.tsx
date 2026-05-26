import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AutoRefresh from "../../AutoRefresh";
import RefreshButton from "../../RefreshButton";
import { getTaskDetail } from "../../queries/plan";
import { getAgentInvocations } from "../../queries/agents";
import TaskEditForm from "./TaskEditForm";

export const metadata = {
  title: "Mapsly · task",
  robots: { index: false, follow: false },
};

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="dev-wrap">
      <header className="dev-head">
        <div className="dev-head-left">
          <span className="dev-dot" aria-hidden />
          <div>
            <div className="dev-head-title">task detail</div>
            <div className="dev-status">live · DB-backed</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
            ← all tasks
          </Link>
          <RefreshButton />
        </div>
      </header>

      <Suspense fallback={<div className="dev-empty">loading task…</div>}>
        <TaskBody params={params} />
      </Suspense>

      <AutoRefresh intervalMs={30000} />
    </div>
  );
}

async function TaskBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskDetail(id);
  if (!task) notFound();

  return (
    <>
      <div className="dev-card">
        <div
          style={{
            fontSize: 12,
            color: "var(--dev-text-3)",
            marginBottom: 12,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {task.group.id} · {task.group.name} · {task.group.domain}
        </div>
        <TaskEditForm task={JSON.parse(JSON.stringify(task))} />
      </div>

      <div className="dev-card">
        <h2>Run history · {task.runs.length} runs</h2>
        {task.runs.length === 0 ? (
          <div className="dev-empty">
            no runs yet · the loop hasn&apos;t picked this task up.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {task.runs.map((r) => (
              <RunRow key={r.id} run={JSON.parse(JSON.stringify(r))} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RunRow({ run }: { run: any }) {
  const outcomeColor: Record<string, string> = {
    SUCCESS: "var(--dev-green)",
    PARTIAL: "var(--dev-amber)",
    FAILED: "var(--dev-red)",
    ABORTED: "var(--dev-red)",
    SKIPPED: "var(--dev-text-3)",
    IN_PROGRESS: "var(--dev-amber)",
  };
  const duration = run.finishedAt
    ? Math.round(
        (new Date(run.finishedAt).getTime() -
          new Date(run.startedAt).getTime()) /
          1000,
      )
    : null;
  const agents = run.agentsUsed ? safeParse(run.agentsUsed) : [];
  const skills = run.skillsUsed ? safeParse(run.skillsUsed) : [];
  const rules = run.rulesConsulted ? safeParse(run.rulesConsulted) : [];
  const incidents = run.incidentsLogged ? safeParse(run.incidentsLogged) : [];
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--dev-bg-3)",
        border: "1px solid var(--dev-border)",
        borderLeft: `3px solid ${outcomeColor[run.outcome] ?? "var(--dev-text-3)"}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "baseline",
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        <span
          className="dev-mono"
          style={{ fontWeight: 700, color: outcomeColor[run.outcome] }}
        >
          {run.outcome}
        </span>
        <span
          className="dev-mono"
          style={{ fontSize: 11, color: "var(--dev-text-3)" }}
        >
          {run.sessionId}
        </span>
        <span
          className="dev-mono"
          style={{ fontSize: 11, color: "var(--dev-text-3)" }}
        >
          {String(run.startedAt).slice(0, 16).replace("T", " ")}
        </span>
        {duration != null && (
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {duration}s
          </span>
        )}
        {run.costUsd != null && (
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            ${run.costUsd.toFixed(3)}
          </span>
        )}
        {run.scoreAggregate != null && (
          <span
            className="dev-mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color:
                run.scoreAggregate >= 9
                  ? "var(--dev-green)"
                  : run.scoreAggregate >= 7
                    ? "var(--dev-amber)"
                    : "var(--dev-red)",
            }}
          >
            score {run.scoreAggregate.toFixed(1)}/10
          </span>
        )}
      </div>

      {(run.scoreCompletion != null ||
        run.scoreQuality != null ||
        run.scoreAudience != null ||
        run.scoreRelevance != null ||
        run.scorePerformance != null) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 4,
            marginTop: 10,
          }}
        >
          <Cell label="completion" value={run.scoreCompletion} />
          <Cell label="quality" value={run.scoreQuality} />
          <Cell label="audience" value={run.scoreAudience} />
          <Cell label="relevance" value={run.scoreRelevance} />
          <Cell label="perf" value={run.scorePerformance} />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
          marginTop: 10,
          fontSize: 11,
          color: "var(--dev-text-2)",
        }}
      >
        {run.prUrl && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>pr:</span>
            <a
              href={run.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--dev-indigo)" }}
            >
              #{run.prNumber} →
            </a>
          </>
        )}
        {run.commitSha && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>commit:</span>
            <span className="dev-mono">{run.commitSha.slice(0, 8)}</span>
          </>
        )}
        {agents.length > 0 && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>agents:</span>
            <span className="dev-mono">{agents.join(", ")}</span>
          </>
        )}
        {skills.length > 0 && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>skills:</span>
            <span className="dev-mono">{skills.join(", ")}</span>
          </>
        )}
        {rules.length > 0 && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>rules:</span>
            <span className="dev-mono">{rules.join(", ")}</span>
          </>
        )}
        {incidents.length > 0 && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>incidents:</span>
            <span className="dev-mono" style={{ color: "var(--dev-red)" }}>
              {incidents.join(", ")}
            </span>
          </>
        )}
        {run.testsAdded > 0 && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>tests added:</span>
            <span className="dev-mono">+{run.testsAdded}</span>
          </>
        )}
        {(run.ciPassed != null ||
          run.deployPassed != null ||
          run.lighthousePassed != null) && (
          <>
            <span style={{ color: "var(--dev-text-3)" }}>gates:</span>
            <span style={{ display: "flex", gap: 8 }}>
              <Gate label="CI" passed={run.ciPassed} />
              <Gate label="deploy" passed={run.deployPassed} />
              <Gate label="LH" passed={run.lighthousePassed} />
            </span>
          </>
        )}
      </div>

      {(run.validationStrategy ||
        run.validationOutcomes ||
        run.validationNotes) && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--dev-border)",
          }}
        >
          <div
            className="dev-mono"
            style={{
              fontSize: 10,
              color: "var(--dev-text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            Validation
          </div>
          {run.validationStrategy &&
            renderValidationChecklist(safeJson(run.validationStrategy))}
          {run.validationOutcomes &&
            renderValidationOutcomes(safeJson(run.validationOutcomes))}
          {run.validationNotes && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                background: "var(--dev-bg-2)",
                borderRadius: 4,
                fontSize: 11,
                color: "var(--dev-text-2)",
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
              }}
            >
              {run.validationNotes}
            </div>
          )}
        </div>
      )}

      {run.errorMessage && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.3)",
            borderRadius: 4,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 10,
            color: "var(--dev-red)",
            whiteSpace: "pre-wrap",
          }}
        >
          {run.errorMessage}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "var(--dev-bg-2)",
        borderRadius: 4,
        textAlign: "center",
      }}
    >
      <div
        className="dev-mono"
        style={{
          fontSize: 9,
          color: "var(--dev-text-3)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color:
            value >= 8
              ? "var(--dev-green)"
              : value >= 6
                ? "var(--dev-amber)"
                : "var(--dev-red)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Gate({ label, passed }: { label: string; passed: boolean | null }) {
  if (passed == null)
    return (
      <span
        className="dev-mono"
        style={{ fontSize: 10, color: "var(--dev-text-3)" }}
      >
        {label}:—
      </span>
    );
  return (
    <span
      className="dev-mono"
      style={{
        fontSize: 10,
        color: passed ? "var(--dev-green)" : "var(--dev-red)",
      }}
    >
      {label}:{passed ? "✓" : "✗"}
    </span>
  );
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function renderValidationChecklist(strategy: Record<string, unknown>) {
  const modes = [
    "unit",
    "integration",
    "browser",
    "db",
    "email",
    "performance",
    "a11y",
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginBottom: 6,
      }}
    >
      {modes.map((m) => {
        const v = strategy[m];
        const on = v === true || (typeof v === "object" && v !== null);
        return (
          <span
            key={m}
            className="dev-mono"
            style={{
              fontSize: 10,
              padding: "3px 6px",
              borderRadius: 4,
              background: on ? "rgba(34,197,94,.15)" : "var(--dev-bg-2)",
              color: on ? "var(--dev-green)" : "var(--dev-text-3)",
              border: "1px solid var(--dev-border)",
            }}
          >
            {on ? "✓" : "○"} {m}
          </span>
        );
      })}
    </div>
  );
}

function renderValidationOutcomes(outcomes: Record<string, unknown>) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "3px 12px",
        fontSize: 11,
        color: "var(--dev-text-2)",
      }}
    >
      {Object.entries(outcomes).map(([mode, result]) => (
        <>
          <span
            key={mode + "-k"}
            className="dev-mono"
            style={{ color: "var(--dev-text-3)" }}
          >
            {mode}:
          </span>
          <span key={mode + "-v"} className="dev-mono" style={{ fontSize: 10 }}>
            {typeof result === "string" ? result : JSON.stringify(result)}
          </span>
        </>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future agent-trace UI re-enable
async function AgentSpanTree({ taskRunId }: { taskRunId: string }) {
  const spans = await getAgentInvocations(taskRunId);
  if (spans.length === 0) return null;
  const max =
    spans.reduce(
      (mx, s) =>
        Math.max(
          mx,
          s.finishedAt
            ? new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()
            : 0,
        ),
      0,
    ) || 1;
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--dev-border)",
      }}
    >
      <div
        className="dev-mono"
        style={{
          fontSize: 10,
          color: "var(--dev-text-3)",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Agents · {spans.length}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {spans.map((s) => {
          const dur = s.finishedAt
            ? new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()
            : 0;
          const widthPct = Math.max(2, (dur / max) * 100);
          const color =
            s.verdict === "PASS"
              ? "var(--dev-green)"
              : s.verdict === "WARN"
                ? "var(--dev-amber)"
                : s.verdict === "FAIL"
                  ? "var(--dev-red)"
                  : "var(--dev-indigo)";
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
              }}
            >
              <span
                className="dev-mono"
                style={{ minWidth: 140, color: "var(--dev-text)" }}
              >
                {s.agentName}
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
                    width: `${widthPct}%`,
                    height: "100%",
                    background: color,
                  }}
                />
              </div>
              <span
                className="dev-mono"
                style={{
                  minWidth: 50,
                  color: "var(--dev-text-3)",
                  textAlign: "right",
                }}
              >
                {dur}ms
              </span>
              {s.verdict && (
                <span
                  className="dev-mono"
                  style={{ minWidth: 40, color, textAlign: "right" }}
                >
                  {s.verdict}
                </span>
              )}
              {s.tokensInput != null && (
                <span
                  className="dev-mono"
                  style={{
                    minWidth: 60,
                    color: "var(--dev-text-3)",
                    textAlign: "right",
                  }}
                >
                  {s.tokensInput}↓ {s.tokensOutput ?? 0}↑
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
