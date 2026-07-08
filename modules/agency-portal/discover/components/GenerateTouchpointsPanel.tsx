"use client";

// GenerateTouchpointsPanel · the trigger that turns discovered, reachable
// prospects into signal-grounded first-touch drafts (Phase 8). Calls the
// deterministic generateTouchpointsAction (bounded batch), then refreshes the
// read-only TouchpointsList below it. Agency-register copy (imperative, dense).
//
// T4/B7 · full parity with the workbench overlay: tone, sequence steps, and
// the pain-theme multipicker are explicit controls, not silent defaults. This
// page is cross-discovery, so no goal context applies — the all-checked theme
// default is correct here (the overlay handles goal-derived defaults, B1).
//
// T3/B2 · mailing-address pre-flight: `hasMailingAddress` is resolved
// server-side by the page (plain boolean prop, cache-components.md Pattern 4).
// A null Agency.mailingAddress makes email generation silently yield zero
// drafts, so the email channel shows the banner + disables Generate upfront.

import { useEffect, useState, useTransition } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { generateTouchpointsAction } from "@/modules/outreach/actions";
import { PAIN_THEMES } from "@/modules/outreach/first-touch";
import {
  SUBJECT_NAME_KEY,
  readSubjectNameToggle,
  normalizeSkips,
  buildGenerateSummary,
} from "./touch-gen-helpers";

// Matches TouchChannel in modules/outreach/first-touch.ts.
type Channel = "email" | "dm" | "phone" | "social";
type Tone = "direct" | "warm" | "brief";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "dm", label: "DM" },
  { value: "phone", label: "Phone" },
  { value: "social", label: "Social" },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "warm", label: "Warm" },
  { value: "brief", label: "Brief" },
];

export interface GenerateTouchpointsPanelProps {
  /** B2 · whether the agency has a mailing address on file (server-resolved). */
  hasMailingAddress: boolean;
}

export function GenerateTouchpointsPanel({
  hasMailingAddress,
}: GenerateTouchpointsPanelProps) {
  const router = useRouter();
  const [sellingWhat, setSellingWhat] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [tone, setTone] = useState<Tone>("direct");
  const [steps, setSteps] = useState(1);
  const [pains, setPains] = useState<Set<string>>(
    () => new Set(PAIN_THEMES.map((p) => p.key)),
  );
  // B7 · subject name/case toggle. Default OFF — the expert default is a
  // lowercase, specific, no-name subject. This panel is cross-discovery, so it
  // uses the same GLOBAL key as its last-used default (no per-research scope).
  const [includeNameInSubject, setIncludeNameInSubject] = useState(() =>
    typeof window === "undefined"
      ? false
      : readSubjectNameToggle((k) => window.localStorage.getItem(k)),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  // B7 · persist the toggle so it survives navigation.
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

  // B2 · email drafts are DEAD without an agency mailing address (CAN-SPAM/
  // CASL) — the generator skips every one. Block upfront, don't apologize after.
  const emailBlocked = channel === "email" && !hasMailingAddress;

  function togglePain(key: string) {
    setPains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function run() {
    setMsg(null);
    setError(false);
    start(async () => {
      const r = await generateTouchpointsAction({
        sellingWhat: sellingWhat.trim(),
        channel,
        tone,
        sequenceLength: steps,
        // B7 · lowercase-specific subject by default; toggle prepends the name.
        includeNameInSubject,
        // All themes selected = no restriction (a theme only fires when its
        // signal is grounded anyway).
        painPointKeys:
          pains.size === PAIN_THEMES.length ? undefined : [...pains],
      });
      if (r.status === "ok") {
        if (r.generated > 0) {
          // B3 · itemize skips from the structured shape (nested `skips`
          // preferred, flat fields as fallback) instead of only "enrich first".
          const summary = buildGenerateSummary(r.generated, normalizeSkips(r));
          const tail = summary.reasons.length
            ? ` · ${summary.reasons.join(" · ")}`
            : "";
          setMsg(
            `${summary.headline} from ${r.scanned} prospects${r.creditsCharged > 0 ? ` · ${r.creditsCharged} cr` : ""}${tail}.`,
          );
        } else if (r.skippedNoAddress > 0) {
          // TM-1 · the real reason nothing drafted was a missing mailing address,
          // not "everyone already has a touch". Point to Settings.
          setError(true);
          setMsg(
            "Email drafts need your mailing address — set it in Settings → Profile.",
          );
        } else if (r.skippedSparse > 0) {
          // A17 · everyone selected lacks a grounded pain — a generic note would
          // be spam-shaped. Point at enrichment, not a hollow "0 drafts".
          setError(true);
          setMsg(
            "No grounded pain on these prospects yet — enrich them first, then generate.",
          );
        } else {
          setMsg(
            "No new prospects to draft — every discovered, reachable business already has a touch.",
          );
        }
        router.refresh();
      } else if (r.status === "invalid_input") {
        setError(true);
        setMsg(r.message);
      } else if (r.status === "insufficient_credits") {
        setError(true);
        setMsg(
          `Needs ${r.creditsNeeded} credit${r.creditsNeeded === 1 ? "" : "s"} — top up in Billing.`,
        );
      } else if (r.status === "forbidden") {
        setError(true);
        setMsg("Owner or admin role required — generation spends credits.");
      } else {
        setError(true);
        setMsg(`Couldn't generate (${r.status}).`);
      }
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-slate-900">
        Generate touchpoints
      </p>
      <label className="block text-xs font-medium text-slate-600">
        What are you selling?
        <input
          type="text"
          value={sellingWhat}
          onChange={(e) => setSellingWhat(e.target.value)}
          placeholder="e.g. local SEO retainers for med-spas"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Channel
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Tone
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Sequence
          <select
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} step{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={
            pending ||
            sellingWhat.trim().length < 3 ||
            pains.size === 0 ||
            emailBlocked
          }
          onClick={run}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate"}
        </button>
      </div>
      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-slate-600">
          Pain themes — a theme only fires when its signal is real
        </legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {PAIN_THEMES.map((p) => (
            <label
              key={p.key}
              className="flex items-center gap-1.5 text-xs text-slate-700"
            >
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
      {/* B7 · subject name/case toggle. Default OFF — the expert default is a
          lowercase, specific, no-name subject that leads with the hook. */}
      <div className="mt-3">
        <label
          className={`toggle tg-subject-toggle text-xs${includeNameInSubject ? " on" : ""}`}
          style={{ maxWidth: 340 }}
        >
          <span className="font-medium text-slate-700">
            Add business name to subject
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={includeNameInSubject}
            onChange={(e) => setIncludeNameInSubject(e.target.checked)}
          />
          <span className="sw" aria-hidden="true" />
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Subjects lead with the specific hook — turn on to prepend the business
          name.
        </p>
      </div>
      {emailBlocked ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          Email drafts need your agency&apos;s mailing address (CAN-SPAM/CASL) —
          set it in{" "}
          <Link href="/agency-settings" className="underline">
            Settings → Profile
          </Link>
          .
        </div>
      ) : null}
      {msg ? (
        <p
          className={`mt-2 text-sm ${error ? "text-red-600" : "text-emerald-700"}`}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
