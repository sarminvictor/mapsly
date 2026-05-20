"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { pauseLoop, resumeLoop, clearCooldown } from "./loop-actions";

export default function LoopControls({
  state,
  cooldownUntil,
}: {
  state: "idle" | "running" | "cooldown" | "paused";
  cooldownUntil: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const wrap = (fn: () => Promise<void>, label: string) => () => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(
          `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  };

  const btn = {
    fontSize: 11,
    padding: "6px 12px",
    background: "var(--dev-bg-3)",
    color: "var(--dev-text)",
    border: "1px solid var(--dev-border)",
    borderRadius: 6,
    cursor: pending ? "wait" : "pointer",
    opacity: pending ? 0.5 : 1,
    fontFamily: "JetBrains Mono, monospace",
  } as const;

  const danger = {
    ...btn,
    background: "rgba(245,158,11,.15)",
    color: "var(--dev-amber)",
    borderColor: "var(--dev-amber)",
  };

  const accent = {
    ...btn,
    background: "rgba(34,197,94,.15)",
    color: "var(--dev-green)",
    borderColor: "var(--dev-green)",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {state === "paused" || state === "cooldown" ? (
          <button
            disabled={pending}
            onClick={wrap(resumeLoop, "Resume")}
            style={accent}
          >
            ▶ resume loop
          </button>
        ) : (
          <button
            disabled={pending}
            onClick={wrap(pauseLoop, "Pause")}
            style={danger}
          >
            ⏸ pause loop
          </button>
        )}
        {state === "cooldown" && cooldownUntil && (
          <button
            disabled={pending}
            onClick={wrap(clearCooldown, "Clear cooldown")}
            style={btn}
          >
            ⏭ clear cooldown
          </button>
        )}
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 10,
            color: "var(--dev-text-3)",
            alignSelf: "center",
            marginLeft: 8,
          }}
        >
          start loop (in Claude Code session):
          <code
            style={{
              marginLeft: 6,
              padding: "2px 6px",
              background: "var(--dev-bg-3)",
              border: "1px solid var(--dev-border)",
              borderRadius: 4,
            }}
          >
            /loop 5m
          </code>
        </span>
      </div>
      {error && (
        <div
          className="dev-mono"
          style={{
            fontSize: 11,
            color: "var(--dev-red)",
            marginTop: 8,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
