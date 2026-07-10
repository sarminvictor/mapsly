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

import { useEffect, useRef, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import type { AgencyJob, EnrichStage } from "@/app/api/agency/jobs/route";

/** The honest pre-data placeholder. Shown ONLY in the brief window before the
 *  first real per-run stage payload lands (the jobs API returns real per-run
 *  stages on the first poll). It deliberately claims NOTHING about which
 *  researches this run selected — the old fixed six-row fallback overclaimed
 *  (it listed "Website & tech signals", "Reviews…", etc. for EVERY run, even
 *  ones that never requested them) AND included "Draft first touches", which is
 *  a separate Touchpoints action, not part of enrichment at all. Once the real
 *  stages arrive (buildEnrichStages · app/api/agency/jobs/route.ts) they replace
 *  this single row with only the stages THIS run actually performs. */
const PREPARING_STAGE = { label: "Preparing…", status: "running" as const };

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
  // 2026-07-10 · businesses waiting out a retry backoff — the "N retrying" hint
  // that stops the tail reading as a frozen "44 of 45". NOT monotonic-clamped
  // (it rises then falls to 0 as retries resolve). Transient; 0 at terminal.
  const [retrying, setRetrying] = useState(0);
  const [total, setTotal] = useState(leadCount);
  // WP4-6 · the close receipt (credits held vs charged) — present only at
  // terminal, shown on the done-state. refunded = held − charged.
  const [receipt, setReceipt] = useState<{
    held: number;
    charged: number;
  } | null>(null);
  // null = "not enough signal to estimate yet" (shown as "starting…"). Otherwise
  // a {lo,hi}-minute RANGE derived from the RUN's real elapsed-per-unit throughput
  // (anchored to the run start, not the page clock, so it survives refreshes).
  // Shown as a range, not a false-precision point, and EMA-smoothed + monotone-
  // non-increasing so it stops jumping 1↔5 min (2026-07-10): the counter is now
  // business-unit (no sawtooth) AND the rate is smoothed here.
  const [eta, setEta] = useState<{ lo: number; hi: number } | null>(null);
  // Smoothed ms-per-business estimate across polls (EMA) — a ref so it persists
  // between polls without re-rendering.
  const etaRateRef = useRef<number | null>(null);
  const lastEtaHiRef = useRef<number>(Number.POSITIVE_INFINITY);

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
    let lastRetrying = 0;
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
            retrying?: number;
            status: string;
            creditsHeld?: number;
            creditsCharged?: number;
          } = await progressRes.json();
          lastDone = prog.done;
          lastFailed = prog.failed;
          lastRetrying = prog.retrying ?? 0;
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

        // MONOTONIC display (2026-07-10): never let done/failed/pct regress. The
        // counter is now business-unit + clamped server-side, but a re-seed
        // correcting a rare concurrent double-count could still nudge a value
        // down — the user should never see progress go backwards, so clamp to the
        // max seen this run. (A new run remounts this component → fresh state.)
        setDone((prev) => Math.max(prev, lastDone));
        setFailed((prev) => Math.max(prev, lastFailed));
        // retrying is transient (rises during a backoff tail, falls to 0 as it
        // resolves) — NOT clamped monotone like done/failed.
        setRetrying(lastRetrying);
        setTotal(lastTotal);

        if (!running) {
          setPct(100);
          setFinished(true);
          setRetrying(0); // terminal — nothing is backing off anymore
          setEta({ lo: 0, hi: 0 });
          // WP4-2 · a run that ended but whose progress endpoint didn't hand us
          // a terminal status this poll (e.g. resolved terminal only via the
          // jobs-feed flag) defaults to OK — the safe non-alarming outcome.
          setOutcome(terminalOutcome ?? "OK");
          if (lastReceipt) setReceipt(lastReceipt);
          return; // stop polling
        }

        // % from REAL units (floored at 2 while running so the bar isn't empty),
        // monotone-non-decreasing so it never dips.
        const rawPct = Math.max(
          2,
          Math.min(99, Math.round((lastDone / lastTotal) * 100)),
        );
        setPct((prev) => Math.max(prev, rawPct));

        // ETA from the RUN's real throughput, EMA-SMOOTHED into a RANGE. Point
        // estimate = elapsed-since-run-start ÷ units done × units remaining
        // (anchored to startedAt, stable across refreshes). We smooth the
        // ms-per-unit rate (0.6 old · 0.4 new) so a single slow/fast unit doesn't
        // swing the estimate, present a ±30% range (enrichment ETAs are
        // genuinely uncertain — a range is honest, a point is false precision),
        // and clamp the upper bound monotone-non-increasing so it only ever
        // shrinks. null until ≥1 unit lands (the pre-run "~2 min" guess is gone).
        if (lastDone > 0 && runStartedAt) {
          const elapsedMs = Date.now() - Date.parse(runStartedAt);
          const remaining = Math.max(0, lastTotal - lastDone);
          const instantRate = elapsedMs / lastDone; // ms per business
          const rate =
            etaRateRef.current == null
              ? instantRate
              : 0.6 * etaRateRef.current + 0.4 * instantRate;
          etaRateRef.current = rate;
          const midMs = rate * remaining;
          const loMin = Math.max(1, Math.round((midMs * 0.7) / 60000));
          let hiMin = Math.max(loMin, Math.round((midMs * 1.3) / 60000));
          // Monotone-non-increasing upper bound: an ETA that only shrinks reads
          // as steady progress; one that grows reads as "stuck".
          hiMin = Math.min(hiMin, lastEtaHiRef.current);
          lastEtaHiRef.current = hiMin;
          setEta({ lo: Math.min(loMin, hiMin), hi: hiMin });
        } else {
          setEta(null);
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

  // The checklist rows: the REAL per-stage rollup once it lands (only the
  // stages THIS run performs — buildEnrichStages omits `touches` entirely and
  // labels the free discovery step "Find businesses · free"); before then, a
  // single honest "Preparing…" placeholder that claims nothing about which
  // researches ran. Never the old fixed list of every possible stage.
  const stageRows: { label: string; status: EnrichStage["status"] }[] = stages
    ? stages.map((s) => ({ label: s.label, status: s.status }))
    : [PREPARING_STAGE];

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

  // "done" once the run closes; else an honest ETA RANGE (never a false-precise
  // point, never over-claims). "~2 min" when lo===hi, "~2–4 min" otherwise.
  const rightNote = finished
    ? isFailed
      ? "failed"
      : "done"
    : eta == null
      ? "starting…"
      : eta.lo === eta.hi
        ? `~${eta.hi} min left`
        : `~${eta.lo}–${eta.hi} min left`;

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
              {/* 2026-07-10 · name the backoff tail so a run waiting out a
                  retry doesn't read as a frozen "44 of 45". */}
              {!finished && retrying > 0 ? (
                <span
                  className="note"
                  style={{ fontWeight: 400, marginLeft: 6 }}
                >
                  · {retrying.toLocaleString()} retrying
                </span>
              ) : null}
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
