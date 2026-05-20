"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask } from "./actions";

export default function AddTaskButton({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    id: "",
    title: "",
    description: "",
    effort: "M" as "S" | "M" | "L" | "XL",
    deps: "",
    tags: "",
  });

  const submit = () => {
    if (!form.id || !form.title) {
      alert("ID and title required");
      return;
    }
    startTransition(async () => {
      try {
        await createTask({ groupId, ...form });
        setOpen(false);
        setForm({
          id: "",
          title: "",
          description: "",
          effort: "M",
          deps: "",
          tags: "",
        });
        router.refresh();
      } catch (e) {
        alert(`Create failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="dev-mono"
        style={{
          fontSize: 11,
          padding: "6px 10px",
          background: "var(--dev-bg-3)",
          color: "var(--dev-text-2)",
          border: "1px dashed var(--dev-border)",
          borderRadius: 6,
          cursor: "pointer",
          marginTop: 8,
        }}
      >
        + add task
      </button>
    );
  }

  const inputStyle = {
    fontSize: 12,
    padding: "6px 8px",
    background: "var(--dev-bg-2)",
    color: "var(--dev-text)",
    border: "1px solid var(--dev-border)",
    borderRadius: 4,
    width: "100%",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "var(--dev-bg-2)",
        border: "1px solid var(--dev-border)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <input
          placeholder="ID (e.g. F.12)"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
          style={inputStyle as React.CSSProperties}
        />
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={inputStyle as React.CSSProperties}
        />
      </div>
      <textarea
        placeholder="Description / acceptance criteria"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={3}
        style={{ ...inputStyle, resize: "vertical" } as React.CSSProperties}
      />
      <div
        style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 8 }}
      >
        <select
          value={form.effort}
          onChange={(e) =>
            setForm({
              ...form,
              effort: e.target.value as "S" | "M" | "L" | "XL",
            })
          }
          style={inputStyle as React.CSSProperties}
        >
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
        </select>
        <input
          placeholder="Deps (e.g. A.2, B.1)"
          value={form.deps}
          onChange={(e) => setForm({ ...form, deps: e.target.value })}
          style={inputStyle as React.CSSProperties}
        />
        <input
          placeholder="Tags"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          style={inputStyle as React.CSSProperties}
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => setOpen(false)}
          disabled={pending}
          className="dev-mono"
          style={{
            fontSize: 11,
            padding: "6px 10px",
            background: "transparent",
            color: "var(--dev-text-3)",
            border: "1px solid var(--dev-border)",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="dev-mono"
          style={{
            fontSize: 11,
            padding: "6px 10px",
            background: "var(--dev-indigo)",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "creating…" : "create task"}
        </button>
      </div>
    </div>
  );
}
