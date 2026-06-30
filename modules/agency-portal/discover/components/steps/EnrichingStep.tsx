"use client";

// EnrichingStep · "Enriching N leads…" (step 5). The reassurance moment after a
// run is authorized: hero count + "you can close this page, we'll email you" +
// an editorial progress card (gradient bar + % + ETA + a six-stage checklist) +
// two CTAs ("See the leads workbench →" / "Close — notify me"). Polls the real
// /api/agency/jobs?runId= feed for THIS run's overall progress AND its per-stage
// rollup (real done/total per stage grouped from the run's EnrichmentJob rows;
// inline/post-close stages gate on the run lifecycle — see the route).
//
// Uses ported classes (.editorial/.bar/.joblist/.job/.check/.spin). English-only.

import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import type { AgencyJob, EnrichStage } from "@/app/api/agency/jobs/route";

/** Display labels (fallback before the first real stage payload lands). */
const STAGE_LABELS = [
  "Mapped market & applied filters",
  "Contacts extracted",
  "Website & tech signals + Lighthouse",
  "Reviews & reputation signals",
  "Expert layer (playbook)",
  "Draft first touches",
];

interface JobsResponse {
  jobs: AgencyJob[];
  stages?: EnrichStage[];
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
  const [finished, setFinished] = useState(false);
  const [stages, setStages] = useState<EnrichStage[] | null>(null);
  const [etaMin, setEtaMin] = useState(Math.max(1, Math.round(leadCount / 70)));

  // Poll the jobs feed every 4s for this run's overall progress + per-stage
  // rollup. ETA is derived here (in the effect, never during render) from
  // elapsed × remaining/done.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch(
          `/api/agency/jobs?runId=${encodeURIComponent(runId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data: JobsResponse = await res.json();
        if (!cancelled && data.stages) setStages(data.stages);
        const job = data.jobs.find((j) => j.id === runId);
        const running = job ? job.running : true;
        // Progress comes from the REAL per-stage rollup (data.stages), NOT the
        // run's unitsCompleted — that's only written at close, so a unit-based %
        // sits at 0 the whole run then jumps to 100. Equal-weight each visible
        // stage (job stages by done/total; inline stages by their status).
        const sts = data.stages ?? [];
        if (!cancelled) {
          if (!running) {
            setPct(100);
            setFinished(true);
            setEtaMin(0);
            return; // stop polling
          }
          const frac =
            sts.length > 0
              ? sts.reduce(
                  (s, st) =>
                    s +
                    (st.total > 0
                      ? st.done / st.total
                      : st.status === "done"
                        ? 1
                        : st.status === "running"
                          ? 0.5
                          : 0),
                  0,
                ) / sts.length
              : 0;
          const p = Math.max(2, Math.min(99, Math.round(frac * 100)));
          const elapsedMin = (Date.now() - startedAt) / 60000;
          setPct(p);
          setEtaMin(
            p > 2
              ? Math.max(1, Math.round((elapsedMin * (100 - p)) / p))
              : Math.max(1, Math.round(leadCount / 70)),
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

  // The checklist rows: REAL per-stage rollup once it lands; before then,
  // labels-only placeholders (all pending) so the card renders immediately.
  const stageRows: { label: string; status: EnrichStage["status"] }[] = stages
    ? stages.map((s) => ({ label: s.label, status: s.status }))
    : STAGE_LABELS.map((label) => ({ label, status: "pending" as const }));

  return (
    <section style={{ paddingBottom: 40 }}>
      <h1>
        Enriching <span className="hl">{leadCount.toLocaleString()} leads</span>
        …
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
            {finished ? "done" : `~${etaMin} min left`}
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
          {stageRows.map(({ label, status }) => (
            <div
              className="job"
              key={label}
              style={status === "pending" ? { opacity: 0.5 } : undefined}
            >
              {status === "done" ? (
                <span className="check" aria-hidden="true">
                  ✓
                </span>
              ) : status === "running" ? (
                <span className="spin" aria-hidden="true" />
              ) : (
                <span style={{ width: 16 }} aria-hidden="true" />
              )}
              {label}
            </div>
          ))}
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
