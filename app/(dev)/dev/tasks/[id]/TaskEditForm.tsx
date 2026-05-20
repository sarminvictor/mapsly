"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTask } from "../actions";

const STATUSES = [
  { db: "PENDING", label: "queued" },
  { db: "IN_PROGRESS", label: "running" },
  { db: "DONE", label: "done" },
  { db: "BLOCKED", label: "blocked" },
  { db: "HUMAN_REQUIRED", label: "your turn" },
  { db: "SKIPPED", label: "skipped" },
  { db: "FAILED", label: "failed" },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function TaskEditForm({ task }: { task: any }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    title: task.title ?? "",
    description: task.description ?? "",
    effort: task.effort ?? "M",
    status: task.status,
    deps: task.deps ?? "",
    tags: task.tags ?? "",
    priority: task.priority,
    notes: task.notes ?? "",
  });

  const save = () => {
    setSaved(false);
    startTransition(async () => {
      try {
        await updateTask({ id: task.id, ...form });
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 2500);
      } catch (e) {
        alert(`Update failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    });
  };

  const input = {
    fontSize: 13,
    padding: "8px 10px",
    background: "var(--dev-bg-3)",
    color: "var(--dev-text)",
    border: "1px solid var(--dev-border)",
    borderRadius: 6,
    fontFamily: "inherit",
    width: "100%",
  } as React.CSSProperties;

  const label = {
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 10,
    color: "var(--dev-text-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
    display: "block",
  } as React.CSSProperties;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={label}>Title</label>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={input}
        />
      </div>
      <div>
        <label style={label}>Description / acceptance criteria</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={5}
          style={{ ...input, resize: "vertical" }}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <div>
          <label style={label}>Status</label>
          <select
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as typeof form.status })
            }
            style={input}
          >
            {STATUSES.map((s) => (
              <option key={s.db} value={s.db}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Effort</label>
          <select
            value={form.effort}
            onChange={(e) =>
              setForm({
                ...form,
                effort: e.target.value as "S" | "M" | "L" | "XL",
              })
            }
            style={input}
          >
            <option value="S">S</option>
            <option value="M">M</option>
            <option value="L">L</option>
            <option value="XL">XL</option>
          </select>
        </div>
        <div>
          <label style={label}>Priority (0-100)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={(e) =>
              setForm({ ...form, priority: Number(e.target.value) })
            }
            style={input}
          />
        </div>
        <div>
          <label style={label}>Tags (comma)</label>
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            style={input}
          />
        </div>
      </div>
      <div>
        <label style={label}>Dependencies (comma-separated IDs)</label>
        <input
          value={form.deps}
          onChange={(e) => setForm({ ...form, deps: e.target.value })}
          style={input}
        />
      </div>
      <div>
        <label style={label}>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3}
          style={{ ...input, resize: "vertical" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={save}
          disabled={pending}
          className="dev-mono"
          style={{
            fontSize: 12,
            padding: "8px 16px",
            background: "var(--dev-indigo)",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "saving…" : "save"}
        </button>
        {saved && (
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-green)" }}
          >
            ✓ saved
          </span>
        )}
      </div>
    </div>
  );
}
