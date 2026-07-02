"use client";

// EnrichingStep · "Enriching N leads…" (step 5). The reassurance moment after a
// run is authorized: hero count + an editorial progress card (gradient bar +
// real done/total count + a stable ETA + the "what's running" checklist) + one
// low-key link into the workbench. Polls /api/agency/jobs?runId= for THIS run's
// REAL progress (done/total from unitsCompleted/unitsRequested, advanced each
// dispatch tick) + its per-stage rollup.
//
// Honesty: the "we'll email you" promise is now TRUE (WP6-3 · the run-finished
// email — internal:run-finished-emails cron + sendRunFinished). No "Jobs tray"
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

/** Terminal run statuses. OK → clean success (auto-advance); PARTIAL → some
 *  leads couldn't complete (honest breakdown, still advance); FAILED → the run
 *  couldn't run at all (retry CTA, never auto-advance). */
type RunOutcome = "OK" | "PARTIAL" | "FAILED";

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
  // WP4-2 · the run's terminal outcome (null while running). Drives the honest
  // done-state copy + whether we auto-advance (only OK/PARTIAL) or offer retry
  // (FAILED). Read from the progress endpoint's run.status — NOT just the
  // jobs-feed `running` flag — so a run whose jobs dropped from the 60s
  // jobs-tray window (WP4-5) is still resolved terminal instead of spinning.
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [stages, setStages] = useState<EnrichStage[] | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(leadCount);
  // WP4-6 · the close receipt (credits held vs charged) — present only at
  // terminal, shown on the done-state. refunded = held − charged.
  const [receipt, setReceipt] = useState<{
    held: number;
    charged: number;
  } | null>(null);
  // null = "not enough signal to estimate yet" (shown as "starting…"). A NUMBER
  // is a stable estimate derived from the RUN's real elapsed-per-unit, not the
  // page's clock — so it doesn't reset to 1 min on every refresh, and it stops
  // jumping (it's anchored to the run start + real throughput).
  const [etaMin, setEtaMin] = useState<number | null>(null);

  // WP3-3 · Poll two endpoints every 3s:
  //   - /api/agency/runs/[id]/progress → the lead-by-lead done/total/failed from
  //     the Redis run-progress counters (ETag/304, ~zero DB cost — see
  //     .claude/rules/realtime-runs-adr.md). This drives the bar + ETA so it
  //     moves per-lead instead of only each dispatch tick.
  //   - /api/agency/jobs?runId= → the per-stage checklist (the "what's running"
  //     rollup + the run's startedAt for the ETA anchor).
  // The progress endpoint is the source for done/total; jobs is the checklist.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let progressEtag: string | null = null;
    let lastDone = 0;
    let lastFailed = 0;
    let lastTotal = leadCount;
    let lastReceipt: { held: number; charged: number } | null = null;
    let runStartedAt: string | null = null;

    async function poll() {
      try {
        const [progressRes, jobsRes] = await Promise.all([
          fetch(`/api/agency/runs/${encodeURIComponent(runId)}/progress`, {
            cache: "no-store",
            headers: progressEtag ? { "If-None-Match": progressEtag } : {},
          }),
          fetch(`/api/agency/jobs?runId=${encodeURIComponent(runId)}`, {
            cache: "no-store",
          }),
        ]);
        if (cancelled) return;

        // Stage checklist + run start anchor from the jobs feed.
        let running = true;
        if (jobsRes.ok) {
          const data: JobsResponse = await jobsRes.json();
          if (data.stages) setStages(data.stages);
          const job = data.jobs.find((j) => j.id === runId);
          if (job) {
            running = job.running;
            runStartedAt = job.startedAt;
          }
        }

        // Progress (done/total/failed/status) from the Redis-backed endpoint. A
        // 304 means "unchanged since last poll" — keep the prior values.
        let terminalOutcome: RunOutcome | null = null;
        if (progressRes.status !== 304 && progressRes.ok) {
          progressEtag = progressRes.headers.get("etag");
          const prog: {
            done: number;
            total: number;
            failed: number;
            status: string;
            creditsHeld?: number;
            creditsCharged?: number;
          } = await progressRes.json();
          lastDone = prog.done;
          lastFailed = prog.failed;
          lastTotal = prog.total > 0 ? prog.total : leadCount;
          // WP4-2/WP4-5 · run.status is the SOURCE OF TRUTH for terminal. OK /
          // PARTIAL / FAILED all end the run — reading it here (not just the
          // jobs-feed `running` flag) means a run whose jobs already dropped
          // from the 60s jobs-tray window still resolves terminal, never an
          // infinite "starting…" spinner.
          if (
            prog.status === "OK" ||
            prog.status === "PARTIAL" ||
            prog.status === "FAILED"
          ) {
            running = false;
            terminalOutcome = prog.status;
            // WP4-6 · capture the close receipt when the endpoint attaches it.
            if (prog.creditsHeld != null && prog.creditsCharged != null) {
              lastReceipt = {
                held: prog.creditsHeld,
                charged: prog.creditsCharged,
              };
            }
          }
        }

        setDone(lastDone);
        setFailed(lastFailed);
        setTotal(lastTotal);

        if (!running) {
          setPct(100);
          setFinished(true);
          setEtaMin(0);
          // WP4-2 · a run that ended but whose progress endpoint didn't hand us
          // a terminal status this poll (e.g. resolved terminal only via the
          // jobs-feed flag) defaults to OK — the safe non-alarming outcome.
          setOutcome(terminalOutcome ?? "OK");
          if (lastReceipt) setReceipt(lastReceipt);
          return; // stop polling
        }

        // % from REAL units (floored at 2 while running so the bar isn't empty).
        setPct(
          Math.max(2, Math.min(99, Math.round((lastDone / lastTotal) * 100))),
        );

        // ETA from the RUN's real throughput: elapsed-since-run-start ÷ units
        // done × units remaining. Anchored to the run's startedAt (not page
        // load), so it's stable across refreshes; null until ≥1 unit lands.
        if (lastDone > 0 && runStartedAt) {
          const elapsedMs = Date.now() - Date.parse(runStartedAt);
          const remaining = Math.max(0, lastTotal - lastDone);
          const ms = (elapsedMs / lastDone) * remaining;
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
  // destination. WP4-2 · auto-advance only on OK/PARTIAL (there ARE leads to
  // see); a FAILED run has nothing to show, so it stays here with a retry CTA.
  // The buttons below stay for an immediate jump / closing.
  useEffect(() => {
    if (!finished || outcome === "FAILED") return;
    const t = setTimeout(() => {
      router.push({
        pathname: "/discover/[discoveryId]",
        params: { discoveryId },
      });
    }, 1400);
    return () => clearTimeout(t);
  }, [finished, outcome, router, discoveryId]);

  // The checklist rows: REAL per-stage rollup once it lands; before then,
  // labels-only placeholders (all pending) so the card renders immediately.
  const stageRows: { label: string; status: EnrichStage["status"] }[] = stages
    ? stages.map((s) => ({ label: s.label, status: s.status }))
    : STAGE_LABELS.map((label) => ({ label, status: "pending" as const }));

  // WP4-2 · which families couldn't complete (for the PARTIAL breakdown). A
  // terminal stage with real job rows (total>0) whose done<total had failures —
  // its label names the family the user paid for that didn't fully land.
  const failedStages =
    finished && outcome === "PARTIAL" && stages
      ? stages.filter((s) => s.total > 0 && s.done < s.total)
      : [];

  // WP4-2 · leads that completed cleanly vs couldn't. `done` and `failed` are
  // both business-unit counts (WP4-3), so they read as leads.
  const completed = Math.max(0, done);
  const couldntComplete = Math.max(0, failed);
  // WP4-6 · refund = held − charged (the fresh-cache + quote-vs-actual diff).
  const refunded = receipt ? Math.max(0, receipt.held - receipt.charged) : 0;

  // WP4-17 · first-hot-lead checkpoint. Once the first ~3 leads finish, the
  // "See leads" link becomes the PRIMARY CTA (Tom's aha at ~2 min, not at full
  // completion). Below that threshold it stays de-accented.
  const FIRST_HOT = 3;
  const hasFirstLeads = done >= FIRST_HOT;

  // FAILED runs get no auto-advance and no "see leads" (there are none) — a
  // retry CTA takes over.
  const isFailed = finished && outcome === "FAILED";

  // "done" once the run closes; else the real climbing count. Never over-claims.
  const rightNote = finished
    ? isFailed
      ? "failed"
      : "done"
    : etaMin == null
      ? "starting…"
      : `~${etaMin} min left`;

  return (
    <section style={{ paddingBottom: 40 }}>
      {/* WP7-11 · on-phone moment. Enriching is a glance screen — the full
          workbench is desktop-first. On a narrow viewport we tell the user
          their leads are safe and to continue on a computer. CSS-only visibility
          (.desktop-handoff shows at ≤640px), so it never clutters desktop. */}
      <p className="desktop-handoff" role="note">
        We&rsquo;ll email you the moment your leads are ready — the full
        workbench works best on a computer.
      </p>
      <h1>
        {isFailed ? (
          <>Enrichment couldn&rsquo;t run</>
        ) : finished ? (
          <>
            Enriched{" "}
            <span className="hl">{completed.toLocaleString()} leads</span>
          </>
        ) : (
          <>
            Enriching <span className="hl">{total.toLocaleString()} leads</span>
            …
          </>
        )}
      </h1>

      {isFailed ? (
        <p className="sub">
          Something went wrong before your leads could be enriched.{" "}
          <b>No credits were charged</b>
          {refunded > 0 ? " — your hold was refunded in full" : ""}. Retry the
          run, or pick it back up anytime from <b>My research</b>.
        </p>
      ) : finished && outcome === "PARTIAL" ? (
        // WP4-2 · honest PARTIAL: N enriched · X couldn't complete · Y refunded.
        <p className="sub">
          Enriched <b>{completed.toLocaleString()}</b> of{" "}
          {total.toLocaleString()}
          {couldntComplete > 0 ? (
            <>
              {" "}
              · <b>{couldntComplete.toLocaleString()}</b> couldn&rsquo;t
              complete
            </>
          ) : null}
          {refunded > 0 ? (
            <>
              {" "}
              · <b>{refunded.toLocaleString()} credits refunded</b>
            </>
          ) : null}
          . You only paid for the leads that landed.
        </p>
      ) : finished ? (
        // WP4-6 · clean OK done-state receipt (charged, and any refund).
        <p className="sub">
          {receipt ? (
            <>
              Charged <b>{receipt.charged.toLocaleString()} credits</b>
              {refunded > 0 ? (
                <>
                  {" "}
                  · <b>{refunded.toLocaleString()}</b> refunded from fresh cache
                  &amp; unused hold
                </>
              ) : null}
              . Opening your workbench…
            </>
          ) : (
            <>Opening your workbench…</>
          )}
        </p>
      ) : (
        <p className="sub">
          Work continues on our servers — close this page and{" "}
          <b>we&rsquo;ll email you</b> when your leads are ready. You can also
          pick this research back up anytime from <b>My research</b>.
        </p>
      )}

      {!isFailed ? (
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
      ) : null}

      {/* WP4-2 · PARTIAL failed-family breakdown — names exactly which research
          the incomplete leads were missing, so the refund is legible. */}
      {failedStages.length > 0 ? (
        <div className="callout amber" style={{ marginTop: 14 }} role="status">
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            Some research couldn&rsquo;t finish for every lead
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {failedStages.map((s) => (
              <li key={s.key} className="note">
                {s.label} — {s.done.toLocaleString()} of{" "}
                {s.total.toLocaleString()} completed
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isFailed ? (
        // WP4-2 · FAILED → retry, back to Preview (re-quote + re-run). No
        // workbench link (there are no leads to see).
        <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
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
            Retry enrichment →
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => router.push({ pathname: "/research" })}
          >
            My research
          </button>
        </div>
      ) : (
        // WP4-17 · the workbench link. Below the first-hot-lead threshold it's a
        // de-accented link (the view auto-advances on completion); once ≥3 leads
        // have landed it becomes the PRIMARY CTA + is badged, so Tom gets his
        // aha at ~2 min instead of at full-run completion.
        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={hasFirstLeads ? "btn primary" : "btn"}
            onClick={() =>
              router.push({
                pathname: "/discover/[discoveryId]",
                params: { discoveryId },
              })
            }
          >
            See leads as they come in →
          </button>
          {hasFirstLeads && !finished ? (
            <span className="pill green dot">
              Your first evidence-backed leads
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
