"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshDashboard } from "./actions";

export default function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      onClick={() => {
        startTransition(async () => {
          await refreshDashboard();
          router.refresh();
        });
      }}
      disabled={pending}
      className="dev-mono"
      style={{
        fontSize: 11,
        padding: "5px 10px",
        background: "var(--dev-bg-3)",
        color: pending ? "var(--dev-text-3)" : "var(--dev-text-2)",
        border: "1px solid var(--dev-border)",
        borderRadius: 6,
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.5 : 1,
      }}
    >
      {pending ? "refreshing…" : "↻ refresh"}
    </button>
  );
}
