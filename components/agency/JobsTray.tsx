"use client";

// JobsTray · the topbar HUD background-jobs indicator (Phase 9). Polls
// `GET /api/agency/jobs` every 4s and shows running Discovery / EnrichmentRun
// jobs with an X-of-Y progress line. When nothing is running the tray collapses
// to nothing (no chrome), so the topbar stays clean.
//
// Polling (not SSE) is deliberate here: jobs change on the order of seconds, the
// payload is tiny + indexed, and a 4s poll is far simpler than a streaming
// endpoint for a glance widget. Cleanup clears the interval on unmount.

import { useEffect, useRef, useState } from "react";

interface AgencyJob {
  id: string;
  kind: "discovery" | "enrichment";
  label: string;
  status: string;
  done: number;
  total: number;
  running: boolean;
  startedAt: string;
}

const POLL_MS = 4000;

export function JobsTray() {
  const [jobs, setJobs] = useState<AgencyJob[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/agency/jobs", {
          signal: ctrl.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const data: { jobs?: AgencyJob[] } = await res.json();
        if (!cancelled && Array.isArray(data.jobs)) setJobs(data.jobs);
      } catch {
        // Network blip or abort — keep the last known state; next tick retries.
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, []);

  const running = jobs.filter((j) => j.running);

  // Nothing running and nothing recent → render nothing.
  if (jobs.length === 0) return null;

  const summary =
    running.length > 0 ? `${running.length} running` : `${jobs.length} recent`;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Background jobs · ${summary}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid var(--color-border)",
          color: "var(--color-text-2)",
          background: "var(--color-bg)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background:
              running.length > 0
                ? "var(--color-agency-indigo, #5b3df5)"
                : "#10b981",
          }}
        />
        {summary}
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Background jobs"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 30,
            width: 280,
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-2)",
            boxShadow: "0 12px 32px rgba(15,23,42,0.16)",
            padding: 8,
          }}
        >
          {jobs.map((job) => {
            const pct =
              job.total > 0
                ? Math.min(100, Math.round((job.done / job.total) * 100))
                : 0;
            return (
              <div
                key={`${job.kind}-${job.id}`}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  marginBottom: 4,
                  background: "var(--color-bg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                    {job.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: job.running ? "var(--color-text-2)" : "#10b981",
                    }}
                  >
                    {job.running
                      ? job.total > 0
                        ? `${job.done} / ${job.total}`
                        : job.status.toLowerCase()
                      : "done"}
                  </span>
                </div>
                {job.running && job.total > 0 ? (
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${job.label} ${pct}% complete`}
                    style={{
                      marginTop: 6,
                      height: 4,
                      borderRadius: 999,
                      background: "var(--color-border)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "var(--color-agency-indigo, #5b3df5)",
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
