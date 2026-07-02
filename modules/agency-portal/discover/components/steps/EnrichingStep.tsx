"use client";

// EnrichingStep · "Enriching N leads…" (step 5). The reassurance moment after a
// run is authorized: hero count + an editorial progress card (gradient bar +
// real done/total count + a stable ETA + the "what's running" checklist) + one
// low-key link into the workbench. Polls /api/agency/jobs?runId= for THIS run's
// REAL progress (done/total from unitsCompleted/unitsRequested, advanced each
// dispatch tick) + its per-stage rollup.
//
// Honesty: no "we'll email you" promise (we don't email) and no "Jobs tray"
// reference (there is none — a research is resumed from the My research page).
// The % + ETA are anchored to the RUN's real throughput, not the page clock, so
// they don't reset on refresh or jump around.
//
// Uses ported classes (.editorial/.bar/.joblist/.job/.check/.spin). English-only.

import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import type { AgencyJob, EnrichStage } from "@/app/api/agency/jobs/route";

/** Display labels (fallback before the first real stage payload lands — a
 *  brief window, since the jobs API returns real per-run stages on the first
 *  poll). Deliberately generic: naming a specific research combination here
 *  (e.g. "+ Lighthouse") would overclaim for a run that only requested one of
 *  them — the real, run-specific label (see app/api/agency/jobs/route.ts's
 *  buildTechStageLabel) replaces this the moment real data lands. */
const STAGE_LABELS = [
  "Mapped market & applied filters",
  "Contacts extracted",
  "Website & tech signals",
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
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(leadCount);
  // null = "not enough signal to estimate yet" (shown as "starting…"). A NUMBER
  // is a stable estimate derived from the RUN's real elapsed-per-unit, not the
  // page's clock — so it doesn't reset to 1 min on every refresh, and it stops
  // jumping (it's anchored to the run start + real throughput).
  const [etaMin, setEtaMin] = useState<number | null>(null);

  // Poll the jobs feed every 3s for this run's REAL progress: done/total come
  // from the run's unitsCompleted/unitsRequested (now advanced each dispatch
  // tick — see modules/enrichment/dispatch.ts updateRunProgress), so the bar
  // climbs honestly instead of sitting at 0 then jumping to 100. The per-stage
  // rollup still drives the "what's running" checklist.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/agency/jobs?runId=${encodeURIComponent(runId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data: JobsResponse = await res.json();
        if (cancelled) return;
        if (data.stages) setStages(data.stages);
        const job = data.jobs.find((j) => j.id === runId);
        const running = job ? job.running : true;
        const jobDone = job?.done ?? 0;
        const jobTotal = job && job.total > 0 ? job.total : leadCount;
        setDone(jobDone);
        setTotal(jobTotal);

        if (!running) {
          setPct(100);
          setFinished(true);
          setEtaMin(0);
          return; // stop polling
        }

        // % from REAL units (floored at 2 while running so the bar isn't empty).
        setPct(
          Math.max(2, Math.min(99, Math.round((jobDone / jobTotal) * 100))),
        );

        // ETA from the RUN's real throughput: elapsed-since-run-start ÷ units
        // done × units remaining. Anchored to job.startedAt (not page load), so
        // it's stable across refreshes; null until ≥1 unit lands.
        if (jobDone > 0 && job?.startedAt) {
          const elapsedMs = Date.now() - Date.parse(job.startedAt);
          const remaining = Math.max(0, jobTotal - jobDone);
          const ms = (elapsedMs / jobDone) * remaining;
          setEtaMin(Math.max(1, Math.round(ms / 60000)));
        } else {
          setEtaMin(null);
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, leadCount]);

  // On completion, auto-advance to the leads workspace (the results) after a
  // brief "done" beat — the enriching screen is a progress view, not a
  // destination. The buttons below stay for an immediate jump / closing.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => {
      router.push({
        pathname: "/discover/[discoveryId]",
        params: { discoveryId },
      });
    }, 1400);
    return () => clearTimeout(t);
  }, [finished, router, discoveryId]);

  // The checklist rows: REAL per-stage rollup once it lands; before then,
  // labels-only placeholders (all pending) so the card renders immediately.
  const stageRows: { label: string; status: EnrichStage["status"] }[] = stages
    ? stages.map((s) => ({ label: s.label, status: s.status }))
    : STAGE_LABELS.map((label) => ({ label, status: "pending" as const }));

  // "done" once the run closes; else the real climbing count. Never over-claims.
  const rightNote = finished
    ? "done"
    : etaMin == null
      ? "starting…"
      : `~${etaMin} min left`;

  return (
    <section style={{ paddingBottom: 40 }}>
      <h1>
        {finished ? (
          <>
            Enriched <span className="hl">{total.toLocaleString()} leads</span>
          </>
        ) : (
          <>
            Enriching <span className="hl">{total.toLocaleString()} leads</span>
            …
          </>
        )}
      </h1>
      <p className="sub">
        Work continues on our servers — you can leave and pick this research
        back up anytime from <b>My research</b>. It keeps going even if you
        close the tab.
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
          <b>
            {done.toLocaleString()} of {total.toLocaleString()} · {pct}%
          </b>
          <span className="note">{rightNote}</span>
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

      {/* One low-key link into the workbench — leads appear there as they
          enrich (the workbench shows its own live progress). De-accented (not a
          primary CTA) since the enriching view auto-advances on completion. */}
      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          className="btn"
          onClick={() =>
            router.push({
              pathname: "/discover/[discoveryId]",
              params: { discoveryId },
            })
          }
        >
          See leads as they come in →
        </button>
      </div>
    </section>
  );
}
