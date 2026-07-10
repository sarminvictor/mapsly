"use client";

// LiveRunGate · AUDIT D4 · the always-mounted live-run wrapper.
//
// Supersedes the conditionally-mounted LiveWorkbenchBanner: the banner now
// appears the MOMENT a run starts — either from the server-resolved `activeRun`
// OR optimistically from the `enrich-started` event (dispatched by
// EnrichMoreSheet when runEnrichAction returns a runId), BEFORE the
// router.refresh() RSC round-trip brings the server activeRun. That closes the
// "the banner only shows up after I refresh the page" complaint.
//
// Crucially the children (WorkbenchShell) live in a STABLE wrapper that is
// always rendered, so toggling the banner on/off never re-parents — and never
// remounts — the table, preserving the user's filters + selection. (The old
// `activeRun ? <Banner>{shell}</Banner> : shell` shape re-mounted the shell the
// instant a run appeared.)
//
// Poll semantics are unchanged from LiveWorkbenchBanner: poll the WP3-3 progress
// endpoint every ~4s with ETag/304, router.refresh() on a done/total change or a
// terminal transition, flash the results area ~180ms, stop on terminal.
// Per .claude/rules/cache-components.md Pattern 4 · plain props. English-only.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { showToast } from "@/components/agency/Toast";
import {
  emitEnrichFinished,
  emitLeadDetailChanged,
  subscribeEnrichStarted,
} from "../enrich-sheet-bus";

interface RunProgress {
  done: number;
  total: number;
  failed: number;
  /** 2026-07-10 · businesses waiting out a retry backoff — surfaced in the
   *  banner so a run in the backoff tail reads "… · 1 retrying" instead of a
   *  frozen "44 of 45". Optional for older payloads. */
  retrying?: number;
  status: string;
  /** WB-COL-2 · the run's purchased enrichment-type tokens — present only in
   *  the terminal payload (server truth from run.enrichmentsJson). Forwarded
   *  on the enrich-finished bus so the workbench can auto-show the bought
   *  data's columns, even after a reload-mid-run. */
  enrichments?: string[];
}

const POLL_MS = 4000;

function isTerminal(status: string): boolean {
  return status === "OK" || status === "PARTIAL" || status === "FAILED";
}

export function LiveRunGate({
  activeRun,
  children,
}: {
  /** The run the page resolved server-side (null when none is in flight). */
  activeRun: { runId: string; status: string } | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // LD-2 · a full-page router.refresh() re-suspends the discover page body (one
  // top-level Suspense) which UNMOUNTS an open lead drawer — so the drawer
  // "closed itself" on every 4s poll. While a lead is open we refresh the
  // drawer's OWN data via the bus and DEFER the heavy server refresh until the
  // drawer closes; the table's optimistic enriching state covers the interim.
  const openLeadRef = useRef<string | null>(null);
  const pendingRefreshRef = useRef(false);
  useEffect(() => {
    const lead = sp.get("lead");
    openLeadRef.current = lead;
    if (!lead && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      router.refresh();
    }
  }, [sp, router]);
  // The run being watched: the server one, else one announced client-side.
  const [runId, setRunId] = useState<string | null>(activeRun?.runId ?? null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  // Live = a non-terminal run is being watched → show the banner + poll.
  const [live, setLive] = useState<boolean>(
    !!activeRun && !isTerminal(activeRun.status),
  );
  const [flash, setFlash] = useState(false);

  // The server prop wins once it resolves (a refresh brought the real run).
  // Deferred out of the effect body (setTimeout 0) to satisfy the codebase's
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (!activeRun?.runId) return;
    const id = activeRun.runId;
    const terminal = isTerminal(activeRun.status);
    const tid = window.setTimeout(() => {
      setRunId(id);
      if (!terminal) setLive(true);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [activeRun?.runId, activeRun?.status]);

  // Optimistic: a run just started this session → watch it immediately.
  useEffect(
    () =>
      subscribeEnrichStarted((id) => {
        setRunId(id);
        setProgress(null);
        setLive(true);
      }),
    [],
  );

  // Poll the progress endpoint while live. Keyed on runId so a new run restarts
  // the loop cleanly.
  useEffect(() => {
    if (!runId || !live) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let etag: string | null = null;
    let lastDone = -1;
    let lastFailed = -1;

    function triggerFlash() {
      setFlash(true);
      window.setTimeout(() => {
        if (!cancelled) setFlash(false);
      }, 180);
    }

    // LD-2 · if a lead drawer is open, refresh ITS data (bus) and defer the
    // full-page refresh (which would unmount the drawer) until it closes; else
    // do the normal server refresh so the table streams in new rows/coverage.
    function deferOrRefresh() {
      const lead = openLeadRef.current;
      if (lead) {
        emitLeadDetailChanged(lead);
        pendingRefreshRef.current = true;
      } else {
        router.refresh();
      }
    }

    async function poll() {
      try {
        const res = await fetch(
          `/api/agency/runs/${encodeURIComponent(runId!)}/progress`,
          { cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} },
        );
        if (cancelled) return;
        if (res.status !== 304 && res.ok) {
          etag = res.headers.get("etag");
          const p: RunProgress = await res.json();
          setProgress(p);
          const changed = p.done !== lastDone || p.failed !== lastFailed;
          lastDone = p.done;
          lastFailed = p.failed;

          if (isTerminal(p.status)) {
            setLive(false);
            // ISSUE-11 · tell the workbench to drop its optimistic per-cell
            // "enriching…" flags NOW (the old self-clear gated on not_run and
            // never fired for re-runs — loaders lingered 5 minutes).
            // WB-COL-2 · carry the server-truth purchased tokens so the
            // workbench can auto-show the bought data's columns (survives a
            // reload-mid-run, where the client-side scope state is gone).
            emitEnrichFinished(p.enrichments ?? []);
            deferOrRefresh();
            triggerFlash();
            // `done` and `failed` are DISJOINT partitions of total — `done` IS
            // the success count, never subtract failed (see agency-overlay memory).
            showToast(
              p.failed > 0
                ? `Enriched ${p.done.toLocaleString()} leads · ${p.failed} failed`
                : `Enriched ${p.done.toLocaleString()} leads`,
              p.status === "FAILED" ? "error" : undefined,
            );
            return;
          }
          if (changed) {
            deferOrRefresh();
            triggerFlash();
          }
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, live, router]);

  const p = progress;
  // 2026-07-10 · name the retry backoff tail so "44 of 45" doesn't read frozen
  // while 1 lead waits out its 2^attempts-min retry ladder.
  const retryNote =
    p && (p.retrying ?? 0) > 0 ? ` · ${p.retrying} retrying` : "";
  const label = p
    ? `Enriching · ${p.done.toLocaleString()} of ${p.total.toLocaleString()}${retryNote} · updating live`
    : "Enriching · updating live";
  // AUDIT U2 · the bottom-right chip label — a compact "done of total" the user
  // keeps in view after scrolling past the top banner.
  const chipLabel = p
    ? `Enriching · ${p.done.toLocaleString()} of ${p.total.toLocaleString()}${retryNote}`
    : "Enriching…";

  return (
    <>
      {live ? (
        <div className="live-enrich-banner" role="status" aria-live="polite">
          <span className="spin" aria-hidden="true" />
          <span className="leb-label">{label}</span>
        </div>
      ) : null}
      {/* Stable wrapper — always present so toggling the banner never remounts
          the workbench (preserves filters + selection). Pulses ~180ms on refresh. */}
      <div className={flash ? "wb-just-refreshed" : undefined}>{children}</div>
      {/* AUDIT U2 · a bottom-right fixed progress chip that COMPLEMENTS the top
          banner — it stays in view while the user scrolls the long leads table
          during an active run. Display-only (pointer-events: none), driven by
          the same poll feed as the banner, hidden when no run is live. */}
      {live ? (
        <div className="live-enrich-chip" role="status" aria-live="polite">
          <span className="spin sm" aria-hidden="true" />
          <span className="lec-label">{chipLabel}</span>
        </div>
      ) : null}
    </>
  );
}
