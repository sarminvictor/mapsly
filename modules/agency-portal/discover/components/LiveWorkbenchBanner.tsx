"use client";

// LiveWorkbenchBanner · WP4-1 · "See leads as they come in" made true.
//
// The workbench page is a one-shot server snapshot (no client poll). When a
// Discovery/EnrichmentRun for this discovery is still PENDING/RUNNING, this slim
// sticky banner polls the WP3-3 progress endpoint every ~4s and, on a done/total
// change OR a status→terminal transition, calls router.refresh() so the server
// re-renders the workbench with the newly-enriched rows + signal chips. Rows
// that gained data get a subtle ~180ms background-flash (a CSS class toggled on
// the results area after each refresh).
//
// Polling stops the moment the run is terminal (OK/PARTIAL/FAILED) — a finished
// run never keeps a timer alive. The banner then shows a one-tick "done" beat
// and removes itself. Reads run.status from the endpoint (not a jobs-tray flag),
// so a run whose jobs dropped from the 60s window still resolves terminal
// (WP4-5 parity for the workbench).
//
// Owned by the workbench PAGE (Editor A) — mounted above WorkbenchShell. It does
// NOT reach into the LeadsWorkbench table chrome (Editor B's territory); the
// cell-flash is a page-level CSS pulse on the results wrapper, not per-cell
// markup. Per .claude/rules/cache-components.md Pattern 4 it takes plain props.
// Per .claude/rules/ui-ux-agency.md: dense, numbers over adjectives, jargon-OK.
// English-only.

import { useEffect, useState, type ReactNode } from "react";

import { useRouter } from "next/navigation";

interface RunProgress {
  done: number;
  total: number;
  failed: number;
  status: string;
}

const POLL_MS = 4000;

function isTerminal(status: string): boolean {
  return status === "OK" || status === "PARTIAL" || status === "FAILED";
}

export function LiveWorkbenchBanner({
  runId,
  initialStatus,
  children,
}: {
  runId: string;
  /** The status the page resolved the run at (server-side) — lets us skip
   *  polling entirely for an already-terminal run (no banner, no timer). */
  initialStatus: string;
  /** The workbench shell — wrapped so a refresh can flash the results area. */
  children: ReactNode;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<RunProgress | null>(null);
  // Terminal state we settle on; once set, polling has stopped.
  const [done, setDone] = useState(!isTerminal(initialStatus) ? false : true);
  // A refresh just landed → flash the results area for ~180ms.
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    // Already terminal at server-render → nothing live to show or poll.
    if (isTerminal(initialStatus)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let etag: string | null = null;
    let lastDone = -1;
    let lastFailed = -1;

    async function poll() {
      try {
        const res = await fetch(
          `/api/agency/runs/${encodeURIComponent(runId)}/progress`,
          {
            cache: "no-store",
            headers: etag ? { "If-None-Match": etag } : {},
          },
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
            // Final refresh so the last batch of enriched rows appears, then
            // stop — a terminal run never keeps a timer alive.
            setDone(true);
            router.refresh();
            triggerFlash();
            return;
          }
          if (changed) {
            // New rows finished this tick → pull them into the server render +
            // pulse the results area so the fresh cells are visible.
            router.refresh();
            triggerFlash();
          }
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    function triggerFlash() {
      setFlash(true);
      window.setTimeout(() => {
        if (!cancelled) setFlash(false);
      }, 180);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // runId is stable for the page; router is stable. initialStatus gates only
    // the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const p = progress;
  const label = p
    ? `Enriching · ${p.done.toLocaleString()} of ${p.total.toLocaleString()} · updating live`
    : "Enriching · updating live";

  return (
    <>
      {/* The slim sticky banner — only while the run is live. Once done, the
          page has re-rendered the final rows, so the banner removes itself. */}
      {!done ? (
        <div className="live-enrich-banner" role="status" aria-live="polite">
          <span className="spin" aria-hidden="true" />
          <span className="leb-label">{label}</span>
        </div>
      ) : null}
      {/* Results area · pulses for ~180ms whenever a refresh lands so the
          newly-enriched rows/cells visibly flash into place. */}
      <div className={flash ? "wb-just-refreshed" : undefined}>{children}</div>
    </>
  );
}
