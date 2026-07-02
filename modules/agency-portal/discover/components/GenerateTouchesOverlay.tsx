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

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { showToast } from "@/components/agency/Toast";
import { generateTouchpointsAction } from "@/modules/outreach/actions";
import { creditsForTouches } from "@/modules/outreach/touch-pricing";
import { chunkBusinessIds } from "@/modules/outreach/touch-batching";
import { PAIN_THEMES } from "@/modules/outreach/first-touch";

const SELLING_KEY = "mapsly.touchgen.sellingWhat";

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
}

export function GenerateTouchesOverlay({
  businessIds,
  discoveryId,
  open,
  onClose,
}: GenerateTouchesOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [sellingWhat, setSellingWhat] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem(SELLING_KEY) ?? ""),
  );
  const [channel, setChannel] = useState<Channel>("email");
  const [tone, setTone] = useState<Tone>("direct");
  const [steps, setSteps] = useState(1);
  const [pains, setPains] = useState<Set<string>>(
    () => new Set(PAIN_THEMES.map((p) => p.key)),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Batch progress for a chunked (> 25-lead) run — null when single-call. */
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

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

  if (!open) return null;

  function togglePain(key: string) {
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
    const selling = sellingWhat.trim();
    // Chunk the selection under the server's per-call cap so any size completes
    // (the whole selection is drafted across sequential batches, not truncated).
    const batches = chunkBusinessIds(businessIds);
    const painPointKeys =
      pains.size === PAIN_THEMES.length ? undefined : [...pains];

    startTransition(async () => {
      // Accumulate across batches so the final toast reports the WHOLE run.
      let generated = 0;
      let skippedExisting = 0;
      let creditsCharged = 0;
      let anyGenerated = false;
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
          // All themes selected = no restriction (a theme only fires when its
          // signal is grounded anyway).
          painPointKeys,
        });
        if (r.status === "ok") {
          generated += r.generated;
          skippedExisting += r.skippedExisting;
          creditsCharged += r.creditsCharged;
          anyGenerated = true;
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

      if (anyGenerated) {
        try {
          window.localStorage.setItem(SELLING_KEY, selling);
        } catch {
          // Private mode — skip persistence.
        }
        const bits = [
          `Drafted ${generated} touch${generated === 1 ? "" : "es"}`,
        ];
        if (skippedExisting > 0)
          bits.push(`${skippedExisting} already drafted`);
        if (creditsCharged > 0) bits.push(`${creditsCharged} cr`);
        // Partial completion (a later batch stopped): say so, don't pretend all ran.
        if (stopError) bits.push("stopped early");
        showToast(bits.join(" · "));
      }

      if (stopError) {
        // Some (or all) of the selection didn't draft. Keep the overlay open so
        // Tom sees why; the already-drafted batches are safe on the server.
        setError(
          anyGenerated
            ? `Drafted ${generated}, then stopped: ${stopError}`
            : stopError,
        );
        // A partial success still changed server state — refresh the counts.
        if (anyGenerated) router.refresh();
        return;
      }

      onClose();
      // Deep-link to the Touchpoints tab so the new drafts are on screen.
      const params = new URLSearchParams(sp.toString());
      params.set("tab", "touch");
      params.delete("lead");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      router.refresh();
    });
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
        </fieldset>

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
              pains.size === 0
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
  title: { margin: 0, fontSize: 16 },
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
  },
  error: { color: "var(--red, #b53d47)", fontSize: 12.5, margin: "0 0 8px" },
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
};
