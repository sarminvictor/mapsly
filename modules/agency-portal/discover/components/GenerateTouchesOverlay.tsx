"use client";

// GenerateTouchesOverlay (WP5-1) · the selection-scoped touch-generation
// dialog. Mounted from the leads bulk bar (BulkGenerateTouchesButton) and the
// lead drawer footer with an explicit businessIds selection.
//
// Controls: what you're selling · channel · tone · 1–3 step sequence · a
// pain-theme multipicker (PAIN_THEMES — a theme still only fires when its
// signal is present) · a LIVE credit estimate (count × steps at the advertised
// 10 cr / 100 touches; the server recomputes — this number is a preview, not
// an authorization). On success it deep-links to the Touchpoints tab
// (?tab=touch) so Tom lands on the drafts he just paid for.
//
// WP5-1 batching: the server bounds ONE call at 25 businesses (Zod .max(25) —
// the per-call scalability bound stays). The bulk bar's "Select all N filtered"
// has no cap, so any selection > 25 is CHUNKED here into sequential ≤25 batches,
// each awaited, results accumulated ("Generating N of M…"). Per-batch credit
// hold/settle is independent (each call mints its own runId), so a mid-sequence
// stop (insufficient_credits) keeps the already-settled batches and halts the
// rest — Tom keeps what he paid for. The whole selection completes for any size.
//
// Per .claude/rules/cache-components.md Pattern 4: client component, callbacks
// owned by client parents. Per .claude/rules/ui-ux-agency.md: dense, tool-y,
// numbers over adjectives. English-only copy.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { showToast } from "@/components/agency/Toast";
import { emitLeadDetailChanged } from "../enrich-sheet-bus";
import { generateTouchpointsAction } from "@/modules/outreach/actions";
import { touchGenPreflightAction } from "@/modules/outreach/export-actions";
import { creditsForTouches } from "@/modules/outreach/touch-pricing";
import { chunkBusinessIds } from "@/modules/outreach/touch-batching";
import { PAIN_THEMES } from "@/modules/outreach/first-touch";
import { defaultPainKeysForSignals } from "@/modules/outreach/pain-goals";
import {
  SELLING_GLOBAL_KEY,
  sellingKeyFor,
  resolveSellingWhat,
  SUBJECT_NAME_KEY,
  readSubjectNameToggle,
  normalizeSkips,
  addSkips,
  EMPTY_SKIPS,
  buildGenerateSummary,
  type SkipCounts,
  type GenerateSummary,
} from "./touch-gen-helpers";

type Channel = "email" | "dm" | "phone" | "social";
type Tone = "direct" | "warm" | "brief";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "dm", label: "DM" },
  { value: "phone", label: "Phone script" },
  { value: "social", label: "Social" },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "warm", label: "Warm" },
  { value: "brief", label: "Brief" },
];

export interface GenerateTouchesOverlayProps {
  /** The exact leads to draft for (businessIds — ≤25 per call server-side). */
  businessIds: string[];
  /** Narrows the server's cell gate to this research (optional). */
  discoveryId?: string;
  open: boolean;
  onClose: () => void;
  /** LD-2 · set by the lead-drawer entry point: on full success stay on the
   *  current lead (the drawer refreshes its touches in place via the bus) rather
   *  than deep-linking away to the Touchpoints tab. The bulk-bar entry omits it,
   *  so it keeps navigating to Touchpoints as before. */
  stayInPlace?: boolean;
}

export function GenerateTouchesOverlay({
  businessIds,
  discoveryId,
  open,
  onClose,
  stayInPlace,
}: GenerateTouchesOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // B1 · per-research pitch memory. Prefer THIS research's own last pitch; fall
  // back to the global last-used only for a brand-new research (see
  // touch-gen-helpers). Keying by discoveryId stops one research's pitch from
  // bleeding into the next.
  const [sellingWhat, setSellingWhat] = useState(() =>
    typeof window === "undefined"
      ? ""
      : resolveSellingWhat(discoveryId, (k) => window.localStorage.getItem(k)),
  );
  const [channel, setChannel] = useState<Channel>("email");
  const [tone, setTone] = useState<Tone>("direct");
  const [steps, setSteps] = useState(1);
  // B7 · subject name/case toggle. Default OFF — the expert default is a
  // lowercase, specific, no-name subject that leads with the hook. Persisted.
  const [includeNameInSubject, setIncludeNameInSubject] = useState(() =>
    typeof window === "undefined"
      ? false
      : readSubjectNameToggle((k) => window.localStorage.getItem(k)),
  );
  const [pains, setPains] = useState<Set<string>>(
    () => new Set(PAIN_THEMES.map((p) => p.key)),
  );
  /** B1 · the user edited the picker — never override their choices after.
   *  A ref (not state): read inside the preflight effect without wiring it
   *  into the deps (which would refetch on every checkbox click). */
  const painsTouchedRef = useRef(false);
  /** B1 · a goal-derived default restriction was applied (shows the hint). */
  const [goalApplied, setGoalApplied] = useState(false);
  /** B1+B2 · upfront context (mailing address + goal signals), fetched on
   *  open. null = not loaded (fail open — the post-hoc TM-1 catch remains). */
  const [preflight, setPreflight] = useState<{
    hasMailingAddress: boolean;
    goalSignalKeys: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Batch progress for a chunked (> 25-lead) run — null when single-call. */
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  /** B3 · the in-overlay result summary (the 6-of-8 fix) — the primary signal
   *  after a generate, so a skip is never invisible. null until a run returns. */
  const [summary, setSummary] = useState<GenerateSummary | null>(null);

  const count = businessIds.length;
  // The live estimate must match how the server BILLS: one hold→settle per
  // ≤25-lead batch, each rounding credits up independently (ceil per batch).
  // Summing per-batch (not ceil of the whole) keeps the preview honest so it
  // never under-quotes a chunked run. Server still recomputes — this is a
  // preview, not an authorization.
  const estimate = useMemo(
    () =>
      chunkBusinessIds(businessIds).reduce(
        (sum, batch) => sum + creditsForTouches(batch.length * steps),
        0,
      ),
    [businessIds, steps],
  );

  // Escape closes (mirrors the drawer's overlay discipline).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // B1 · on (re)open, re-resolve the pitch for THIS research. The overlay
  // instance is reused across leads from different researches, so the once-only
  // initializer isn't enough — re-key by discoveryId each open, and clear the
  // previous run's summary so a stale "Drafted N" never lingers. Done with
  // React's "store previous state, adjust during render" pattern (setState in
  // render is allowed + loop-safe when guarded; setState in an effect body
  // cascades renders — the lint rule blocks that).
  const openKey = open ? (discoveryId ?? "") : null;
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) {
      setSummary(null);
      // Keep an in-progress edit if the user already typed something this open.
      if (!sellingWhat.trim()) {
        setSellingWhat(
          resolveSellingWhat(discoveryId, (k) =>
            typeof window === "undefined"
              ? null
              : window.localStorage.getItem(k),
          ),
        );
      }
    }
  }

  // B7 · persist the subject name/case toggle so it survives reopen.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SUBJECT_NAME_KEY,
        includeNameInSubject ? "1" : "0",
      );
    } catch {
      // Private mode — skip persistence.
    }
  }, [includeNameInSubject]);

  // B1+B2 · fetch the preflight once per open: mailing-address state (banner +
  // disable BEFORE spending, not a post-hoc "Drafted 0") and the discovery's
  // goal-signal keys (default-check only the themes the goal hunts). Refetched
  // on every open so setting the address in Settings takes effect immediately.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const r = await touchGenPreflightAction({ discoveryId });
      if (cancelled || r.status !== "ok") return; // fail open (TM-1 fallback)
      setPreflight({
        hasMailingAddress: r.hasMailingAddress,
        goalSignalKeys: r.goalSignalKeys,
      });
      // Goal-derived theme defaults (B1) — only while the picker is untouched,
      // and only when the map narrows (null = no goal restriction applies).
      if (r.goalSignalKeys.length > 0 && !painsTouchedRef.current) {
        const defaults = defaultPainKeysForSignals(r.goalSignalKeys);
        if (defaults && defaults.length > 0) {
          const known = new Set<string>(PAIN_THEMES.map((p) => p.key));
          const next = defaults.filter((k) => known.has(k));
          if (next.length > 0) {
            setPains(new Set(next));
            setGoalApplied(true);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, discoveryId]);

  if (!open) return null;

  // B2 · email drafts are DEAD without an agency mailing address (CAN-SPAM/
  // CASL) — the generator skips every one. Block upfront instead.
  const emailBlocked =
    channel === "email" && preflight !== null && !preflight.hasMailingAddress;

  function togglePain(key: string) {
    painsTouchedRef.current = true;
    setPains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function run() {
    setError(null);
    setProgress(null);
    setSummary(null);
    const selling = sellingWhat.trim();
    // Chunk the selection under the server's per-call cap so any size completes
    // (the whole selection is drafted across sequential batches, not truncated).
    const batches = chunkBusinessIds(businessIds);
    const painPointKeys =
      pains.size === PAIN_THEMES.length ? undefined : [...pains];

    startTransition(async () => {
      // Accumulate across batches so the final summary reports the WHOLE run.
      let generated = 0;
      let skips: SkipCounts = EMPTY_SKIPS;
      let creditsCharged = 0;
      let stopError: string | null = null;

      for (let i = 0; i < batches.length; i += 1) {
        if (batches.length > 1) {
          setProgress({ done: i, total: batches.length });
        }
        const r = await generateTouchpointsAction({
          sellingWhat: selling,
          channel,
          tone,
          sequenceLength: steps,
          businessIds: batches[i],
          discoveryId,
          // B7 · the expert default is a lowercase, specific, no-name subject;
          // the toggle prepends the business name when on.
          includeNameInSubject,
          // All themes selected = no restriction (a theme only fires when its
          // signal is grounded anyway).
          painPointKeys,
        });
        if (r.status === "ok") {
          generated += r.generated;
          // B3 · nested `skips` (AGENT A) preferred, flat fields as fallback.
          skips = addSkips(skips, normalizeSkips(r));
          creditsCharged += r.creditsCharged;
          continue;
        }
        // Non-ok: stop the sequence. Earlier batches already settled + persisted
        // their drafts (independent per-batch hold/settle) — keep them, halt the
        // rest, and surface why we stopped.
        if (r.status === "insufficient_credits") {
          stopError = `Needs ${r.creditsNeeded} credit${
            r.creditsNeeded === 1 ? "" : "s"
          } — top up in Billing.`;
        } else if (r.status === "forbidden") {
          stopError =
            "Owner or admin role required — generation spends credits.";
        } else if (r.status === "invalid_input") {
          stopError = r.message;
        } else {
          stopError = "Couldn't generate. Try again.";
        }
        break;
      }

      setProgress(null);

      // LD-1/LD-2 · any real generation changed these leads' server-side detail
      // — tell an open drawer to refresh its "This lead's touches" in place so it
      // stops showing "No touch yet".
      if (generated > 0) {
        for (const id of businessIds) emitLeadDetailChanged(id);
      }

      // TM-1 · nothing drafted because email touches need a mailing address the
      // agency hasn't set. Don't fire a misleading "Drafted 0" toast or close —
      // explain it and keep the overlay open (the email primer links to Settings).
      if (generated === 0 && skips.noAddress > 0 && !stopError) {
        setError(
          "Email drafts need your mailing address. Set it in Settings → Profile.",
        );
        return;
      }

      // A17 · nothing drafted because every selected lead has no grounded pain
      // yet — a generic note would be spam-shaped (and CASL-weak). Say so and
      // point at enrichment instead of firing a hollow "Drafted 0".
      if (generated === 0 && skips.sparse > 0 && !stopError) {
        setError(
          `No grounded pain on ${
            skips.sparse === 1 ? "this lead" : "these leads"
          } yet — enrich them first, then generate.`,
        );
        return;
      }

      // B3 · nothing drafted, but leads WERE skipped for reasons invisible from
      // the outside (already drafted, or a data-read error). noAddress/sparse
      // already returned above, so this catches the error/alreadyDrafted-only
      // case — never close silently, always show the itemized summary (the exact
      // 6-of-8 mystery for a fully-skipped run).
      const skipped0 =
        skips.noAddress + skips.sparse + skips.error + skips.alreadyDrafted;
      if (generated === 0 && skipped0 > 0 && !stopError) {
        setSummary(buildGenerateSummary(0, skips));
        showToast(`Drafted 0 · ${skipped0} skipped`);
        return;
      }

      if (generated > 0) {
        // B1 · persist the pitch BOTH per-research (so this research reopens with
        // it) and globally (a default for the next brand-new research). Only the
        // per-research key is read first, so the global one never bleeds across
        // researches that already have their own pitch.
        try {
          window.localStorage.setItem(sellingKeyFor(discoveryId), selling);
          window.localStorage.setItem(SELLING_GLOBAL_KEY, selling);
        } catch {
          // Private mode — skip persistence.
        }

        // B3 · the durable in-overlay summary is the primary signal now. The
        // toast stays as a fleeting confirmation, but a skip is never invisible.
        setSummary(buildGenerateSummary(generated, skips));

        const bits = [
          `Drafted ${generated} touch${generated === 1 ? "" : "es"}`,
        ];
        const skippedTotal =
          skips.noAddress + skips.sparse + skips.error + skips.alreadyDrafted;
        if (skippedTotal > 0) bits.push(`${skippedTotal} skipped`);
        if (creditsCharged > 0) bits.push(`${creditsCharged} cr`);
        // Partial completion (a later batch stopped): say so, don't pretend all ran.
        if (stopError) bits.push("stopped early");
        showToast(bits.join(" · "));
      }

      if (stopError) {
        // Some (or all) of the selection didn't draft. Keep the overlay open so
        // Tom sees why; the already-drafted batches are safe on the server.
        setError(
          generated > 0
            ? `Drafted ${generated}, then stopped: ${stopError}`
            : stopError,
        );
        // A partial success still changed server state — refresh the counts.
        if (generated > 0) router.refresh();
        return;
      }

      // B3 · when a run drafted some but SKIPPED others (the 6-of-8 case), keep
      // the overlay open so the itemized summary is the primary signal — a skip
      // is never invisible. Refresh the server counts underneath; the user
      // dismisses (or navigates via the Touchpoints link) when they've read it.
      const skippedTotal =
        skips.noAddress + skips.sparse + skips.error + skips.alreadyDrafted;
      if (generated > 0 && skippedTotal > 0) {
        router.refresh();
        return;
      }

      onClose();
      // LD-2 · from the drawer, stay on the current lead (it refreshed in place
      // via the bus above); from the bulk bar, deep-link to the Touchpoints tab.
      if (stayInPlace) {
        router.refresh();
        return;
      }
      const params = new URLSearchParams(sp.toString());
      params.set("tab", "touch");
      params.delete("lead");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  // B3 · deep-link the user to the drafts they just paid for when they dismiss
  // the summary from the bulk-bar entry point (the drawer stays in place).
  function goToTouchpoints() {
    onClose();
    if (stayInPlace) return;
    const params = new URLSearchParams(sp.toString());
    params.set("tab", "touch");
    params.delete("lead");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <div
        style={styles.scrim}
        onClick={onClose}
        aria-hidden="true"
        data-testid="gen-touches-scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="genTouchesTitle"
        style={styles.panel}
      >
        <div style={styles.head}>
          <h2 id="genTouchesTitle" style={styles.title}>
            Generate touches ({count})
          </h2>
          <button
            type="button"
            className="x"
            aria-label="Close"
            onClick={onClose}
            style={styles.close}
          >
            ×
          </button>
        </div>

        <label style={styles.label}>
          What are you selling?
          <input
            type="text"
            value={sellingWhat}
            onChange={(e) => setSellingWhat(e.target.value)}
            placeholder="e.g. local SEO retainers for med-spas"
            style={styles.input}
            // Overlay opens on explicit intent — focus the one required field.
            autoFocus
          />
        </label>

        <div style={styles.row}>
          <label style={styles.label}>
            Channel
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              style={styles.input}
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Tone
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              style={styles.input}
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Sequence
            <select
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              style={styles.input}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} step{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>
            Pain themes — a theme only fires when its signal is real
          </legend>
          <div style={styles.painGrid}>
            {PAIN_THEMES.map((p) => (
              <label key={p.key} style={styles.painRow}>
                <input
                  type="checkbox"
                  checked={pains.has(p.key)}
                  onChange={() => togglePain(p.key)}
                />
                {p.label}
              </label>
            ))}
          </div>
          {goalApplied ? (
            <p
              style={styles.goalHint}
              data-tip="Themes matched to this research's goal signals — check others to widen"
            >
              Pre-selected from your goal
            </p>
          ) : null}
        </fieldset>

        {/* B7 · subject name/case toggle. Default OFF — the expert default is a
            lowercase, specific, no-name subject that leads with the hook. */}
        <div style={styles.subjectToggleWrap}>
          <label
            className={`toggle tg-subject-toggle${includeNameInSubject ? " on" : ""}`}
            style={styles.toggleLabel}
          >
            <span>Add business name to subject</span>
            <input
              type="checkbox"
              role="switch"
              checked={includeNameInSubject}
              onChange={(e) => setIncludeNameInSubject(e.target.checked)}
            />
            <span className="sw" aria-hidden="true" />
          </label>
          <p style={styles.subjectToggleSub}>
            Subjects lead with the specific hook — turn on to prepend the
            business name.
          </p>
        </div>

        {emailBlocked ? (
          <div role="alert" style={styles.addressBanner}>
            Email drafts need your agency&apos;s mailing address (CAN-SPAM/CASL)
            — set it in{" "}
            <Link href="/agency-settings" style={styles.primerLink}>
              Settings → Profile
            </Link>
            .
          </div>
        ) : null}

        {channel === "email" ? (
          <div style={styles.primer} role="note">
            <p style={styles.primerHead}>Before you send email</p>
            <ul style={styles.primerList}>
              <li>
                Every email draft carries your agency postal address +
                unsubscribe. Canadian (CA) recipients get CASL framing (sender
                ID + consent basis) automatically; US recipients get CAN-SPAM —
                by recipient country, no toggle.
              </li>
              <li>
                Add your mailing address in{" "}
                <Link href="/agency-settings" style={styles.primerLink}>
                  Settings → Profile
                </Link>{" "}
                — email drafts are skipped until it is set.
              </li>
              <li>
                Deliverability: authenticate your domain (SPF + DKIM + DMARC) in
                your sending tool before the first send, and ramp volume slowly
                (~20–50/day for a new domain, doubling weekly) to avoid spam
                filters.
              </li>
            </ul>
          </div>
        ) : null}

        {error ? (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        ) : null}

        {/* B2 · a real in-body generating state so the dialog reads as working,
            not frozen. Keeps the chunked "N of M" progress. */}
        {pending ? (
          <div style={styles.working} role="status" aria-live="polite">
            <span className="spin" aria-hidden="true" />
            <span>
              {progress
                ? `Generating drafts… ${progress.done + 1} of ${progress.total}`
                : "Generating drafts…"}
            </span>
          </div>
        ) : null}

        {/* B3 · the durable result summary — the primary signal after a run so a
            skip is never invisible (the 6-of-8 fix). */}
        {summary && !pending ? (
          <div
            style={styles.summary}
            role="status"
            aria-live="polite"
            data-testid="gen-touches-summary"
          >
            <p style={styles.summaryHead}>{summary.headline}</p>
            {summary.clean ? (
              <p style={styles.summaryClean}>Every selected lead drafted.</p>
            ) : (
              <ul style={styles.summaryList}>
                {summary.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn primary"
              style={styles.summaryCta}
              onClick={goToTouchpoints}
            >
              {stayInPlace ? "Done" : "Open touchpoints"}
            </button>
          </div>
        ) : null}

        <div style={styles.foot}>
          <span style={styles.estimate}>
            {count} lead{count === 1 ? "" : "s"} × {steps} step
            {steps === 1 ? "" : "s"} ≈ {estimate} cr
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={
              pending ||
              count === 0 ||
              sellingWhat.trim().length < 3 ||
              pains.size === 0 ||
              // B2 · email generation is dead without a mailing address —
              // don't let the user spend a click on a guaranteed zero.
              emailBlocked
            }
            onClick={run}
          >
            {pending
              ? progress
                ? `Generating ${progress.done + 1} of ${progress.total}…`
                : "Generating…"
              : `Generate · ${estimate} cr`}
          </button>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 17, 26, 0.45)",
    zIndex: 90,
  },
  panel: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 48px)",
    overflowY: "auto",
    background: "var(--panel, #fff)",
    // Set an explicit readable base color — the dialog set a white bg but no
    // color, so title + option labels were inheriting an ambient light color
    // and washing out (owner 2026-07-07). Hex fallback holds if the var doesn't
    // resolve in this portalled dialog.
    color: "var(--ink, #1c2233)",
    border: "1px solid var(--line, #e5e7f0)",
    borderRadius: 14,
    boxShadow: "0 24px 64px rgba(15,17,26,.22)",
    padding: 18,
    zIndex: 91,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: "var(--ink, #1c2233)",
  },
  close: {
    border: "none",
    background: "transparent",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    padding: "2px 8px",
  },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  label: {
    display: "block",
    flex: "1 1 140px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--muted, #5a5f73)",
    marginBottom: 10,
  },
  input: {
    display: "block",
    width: "100%",
    marginTop: 4,
    padding: "8px 10px",
    fontSize: 13.5,
    borderRadius: 8,
    border: "1px solid var(--line, #e5e7f0)",
    background: "var(--bg, #fff)",
    color: "inherit",
    boxSizing: "border-box",
  },
  fieldset: {
    border: "1px solid var(--line, #e5e7f0)",
    borderRadius: 10,
    padding: "8px 12px 10px",
    margin: "0 0 10px",
  },
  legend: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--muted, #5a5f73)",
    padding: "0 4px",
  },
  painGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "4px 12px",
  },
  painRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    padding: "2px 0",
    // The checkable theme options are primary content — keep them full-ink,
    // not the inherited light color that made them near-invisible.
    color: "var(--ink, #1c2233)",
    cursor: "pointer",
  },
  error: { color: "var(--red, #b53d47)", fontSize: 12.5, margin: "0 0 8px" },
  goalHint: {
    margin: "6px 0 0",
    fontSize: 11.5,
    color: "var(--muted, #5a5f73)",
    width: "fit-content",
    cursor: "default",
  },
  addressBanner: {
    border: "1px solid var(--red, #b53d47)",
    borderRadius: 10,
    background: "var(--bg, #f6f7fb)",
    color: "var(--red, #b53d47)",
    fontSize: 12.5,
    lineHeight: 1.5,
    padding: "10px 12px",
    margin: "0 0 12px",
  },
  primer: {
    border: "1px solid var(--line, #e5e7f0)",
    borderRadius: 10,
    background: "var(--bg, #f6f7fb)",
    padding: "10px 12px",
    margin: "0 0 12px",
  },
  primerHead: {
    margin: "0 0 6px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.2,
    textTransform: "uppercase",
    color: "var(--muted, #5a5f73)",
  },
  primerList: {
    margin: 0,
    paddingLeft: 16,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--muted, #5a5f73)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  primerLink: {
    color: "var(--color-agency-indigo, #5b3df5)",
    textDecoration: "underline",
  },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
  },
  estimate: {
    marginRight: "auto",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    color: "var(--muted, #5a5f73)",
  },
  // B7 · subject name/case toggle band.
  subjectToggleWrap: { margin: "0 0 12px" },
  toggleLabel: {
    fontSize: 12.5,
    color: "var(--ink, #1c2233)",
  },
  subjectToggleSub: {
    margin: "4px 0 0",
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--muted, #5a5f73)",
  },
  // B2 · in-body generating state.
  working: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--muted, #5a5f73)",
    padding: "8px 0 12px",
  },
  // B3 · durable result summary.
  summary: {
    border: "1px solid var(--line, #e5e7f0)",
    borderRadius: 10,
    background: "var(--bg, #f6f7fb)",
    padding: "10px 12px",
    margin: "0 0 12px",
  },
  summaryHead: {
    margin: "0 0 6px",
    fontSize: 13.5,
    fontWeight: 700,
    color: "var(--ink, #1c2233)",
  },
  summaryClean: {
    margin: 0,
    fontSize: 12.5,
    color: "var(--muted, #5a5f73)",
  },
  summaryList: {
    margin: 0,
    paddingLeft: 16,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--muted, #5a5f73)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  summaryCta: { marginTop: 10 },
};
