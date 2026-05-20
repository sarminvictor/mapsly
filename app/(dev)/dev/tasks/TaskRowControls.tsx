"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setStatus, deleteTask } from "./actions";

const STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "HUMAN_REQUIRED",
  "SKIPPED",
  "FAILED",
] as const;

const LABELS: Record<(typeof STATUSES)[number], string> = {
  PENDING: "queued",
  IN_PROGRESS: "running",
  DONE: "done",
  BLOCKED: "blocked",
  HUMAN_REQUIRED: "your turn",
  SKIPPED: "skipped",
  FAILED: "failed",
};

export default function TaskRowControls({
  taskId,
  current,
}: {
  taskId: string;
  current: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const change = (next: (typeof STATUSES)[number]) => {
    setOpen(false);
    startTransition(async () => {
      try {
        await setStatus(taskId, next);
        router.refresh();
      } catch (e) {
        alert(`Update failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    });
  };

  const remove = () => {
    if (
      !confirm(
        `Skip task ${taskId}? It stays in DB but moves out of the queue.`,
      )
    )
      return;
    startTransition(async () => {
      try {
        await deleteTask(taskId);
        router.refresh();
      } catch (e) {
        alert(`Delete failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    });
  };

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        gap: 4,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="dev-mono"
        style={{
          fontSize: 10,
          padding: "2px 6px",
          background: "var(--dev-bg-2)",
          color: "var(--dev-text-3)",
          border: "1px solid var(--dev-border)",
          borderRadius: 4,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.5 : 1,
        }}
        title="Change status"
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "var(--dev-bg-2)",
            border: "1px solid var(--dev-border-strong, var(--dev-border))",
            borderRadius: 6,
            padding: 4,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            minWidth: 120,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => change(s)}
              disabled={s === current}
              className="dev-mono"
              style={{
                fontSize: 11,
                padding: "5px 8px",
                background: s === current ? "var(--dev-bg-3)" : "transparent",
                color: s === current ? "var(--dev-text-3)" : "var(--dev-text)",
                border: "none",
                textAlign: "left",
                cursor: s === current ? "default" : "pointer",
              }}
            >
              → {LABELS[s]}
            </button>
          ))}
          <div
            style={{
              height: 1,
              background: "var(--dev-border)",
              margin: "4px 0",
            }}
          />
          <button
            onClick={remove}
            className="dev-mono"
            style={{
              fontSize: 11,
              padding: "5px 8px",
              background: "transparent",
              color: "var(--dev-red)",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            ✕ skip task
          </button>
        </div>
      )}
    </span>
  );
}
