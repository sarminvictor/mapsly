"use client";

// EnrichingStep · "Enriching N leads…" (step 5). The reassurance moment after a
// run is authorized: hero count + "you can close this page, we'll email you" +
// an editorial progress card (gradient bar + % + ETA + a six-stage checklist) +
// two CTAs ("See the leads workbench →" / "Close — notify me"). Polls the real
// /api/agency/jobs feed for THIS run's overall progress (the feed reports run-
// level done/total, not per-stage — see the backend note in the build summary;
// the six stages are derived from overall pct).
//
// Uses ported classes (.editorial/.bar/.joblist/.job/.check/.spin). English-only.

import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import type { AgencyJob } from "@/app/api/agency/jobs/route";

const STAGES = [
  "Mapped market & applied filters",
  "Contacts extracted",
  "Website & tech signals + Lighthouse",
  "Reviews & reputation signals",
  "Expert layer (playbook)",
  "Draft first touches",
];

interface JobsResponse {
  jobs: AgencyJob[];
}

export function EnrichingStep({
  runId,
  discoveryId,
  leadCount,
}: {
  runId: string;
  discoveryId: string;
  leadCount: number;
}) {
  const router = useRouter();
  const [pct, setPct] = useState(2);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(leadCount);
  const [finished, setFinished] = useState(false);
  const [etaMin, setEtaMin] = useState(Math.max(1, Math.round(leadCount / 70)));

  // Poll the jobs feed every 4s for this run's overall progress. ETA is derived
  // here (in the effect, never during render) from elapsed × remaining/done.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch("/api/agency/jobs", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data: JobsResponse = await res.json();
        const job = data.jobs.find((j) => j.id === runId);
        if (!cancelled && job) {
          const t = job.total > 0 ? job.total : leadCount;
          const d = Math.min(job.done, t);
          setTotal(t);
          setDone(d);
          setPct(t > 0 ? Math.round((d / t) * 100) : 2);
          const elapsedMin = (Date.now() - startedAt) / 60000;
          if (!job.running) {
            setPct(100);
            setDone(t);
            setFinished(true);
            setEtaMin(0);
            return; // stop polling
          }
          setEtaMin(
            d > 0
              ? Math.max(1, Math.round(elapsedMin * ((t - d) / d)))
              : Math.max(1, Math.round(t / 70)),
          );
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 4000);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, leadCount]);

  // Derive the six stage states from overall pct (no per-stage feed).
  function stageState(i: number): "done" | "running" | "pending" {
    const threshold = ((i + 1) / STAGES.length) * 100;
    const prev = (i / STAGES.length) * 100;
    if (pct >= threshold) return "done";
    if (pct >= prev) return "running";
    return "pending";
  }

  return (
    <section style={{ paddingBottom: 40 }}>
      <h1>
        Enriching <span className="hl">{total.toLocaleString()} leads</span>…
      </h1>
      <p className="sub">
        You can <b>close this page</b> — work continues on our servers and
        we&apos;ll email you when it&apos;s done (~{etaMin || 1} min). Track it
        anytime from the Jobs tray.
      </p>

      <div className="editorial">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          <b>{pct}%</b>
          <span className="note">
            {done.toLocaleString()} of {total.toLocaleString()} leads
            {finished ? " · done" : ` · ~${etaMin} min left`}
          </span>
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${pct}%` }} />
        </div>

        <div className="joblist">
          {STAGES.map((label, i) => {
            const state = stageState(i);
            return (
              <div
                className="job"
                key={label}
                style={state === "pending" ? { opacity: 0.5 } : undefined}
              >
                {state === "done" ? (
                  <span className="check" aria-hidden="true">
                    ✓
                  </span>
                ) : state === "running" ? (
                  <span className="spin" aria-hidden="true" />
                ) : (
                  <span style={{ width: 16 }} aria-hidden="true" />
                )}
                {label}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            router.push({
              pathname: "/discover/[discoveryId]",
              params: { discoveryId },
            })
          }
        >
          See the leads workbench →
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => router.push("/discover")}
        >
          Close — notify me
        </button>
      </div>
    </section>
  );
}
