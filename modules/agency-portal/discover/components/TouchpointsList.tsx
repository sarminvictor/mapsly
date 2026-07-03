"use client";

// TouchpointsList · the agency Touchpoints view (Phase 9). Lists existing
// OutreachDraft rows (subject / body / predictedTier / why) with per-draft Copy
// buttons. Read-only browse of what `generateTouchesForLeads` produced — the
// page never calls external APIs; bulk generation runs out-of-band.
//
// Per `.claude/rules/ui-ux-agency.md`: dense, indigo accent, imperative actions
// ("Copy"), jargon-OK. No function props cross the boundary — drafts are plain
// serialized data resolved server-side (cache-components Pattern 4). Copy is
// English-only for now.

import { useState } from "react";

/** A serialized draft the list renders — plain data only. */
export interface TouchpointDraft {
  id: string;
  businessName: string | null;
  channel: string;
  subject: string | null;
  body: string;
  predictedTier: string | null;
  /** Plain-English reasons each line was included (from whyJson.why). */
  why: string[];
  /** Signal keys grounding the draft (from whyJson.usedSignals). */
  usedSignals: string[];
  createdAt: string;
}

export interface TouchpointsListProps {
  drafts: TouchpointDraft[];
}

function tierClass(tier: string | null): string {
  switch ((tier ?? "").toLowerCase()) {
    case "high":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "medium":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

export function TouchpointsList({ drafts }: TouchpointsListProps) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-700">No touchpoints yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Touches are generated from a list of prospects via
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
            generateTouchesForLeads
          </code>
          — each draft is grounded in a real signal (unanswered reviews, slow
          site, declining reviews). Run a batch from a discovery, then drafts
          land here ready to copy.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((d) => (
        <TouchpointCard key={d.id} draft={d} />
      ))}
    </div>
  );
}

function TouchpointCard({ draft }: { draft: TouchpointDraft }) {
  const [copied, setCopied] = useState<"none" | "body" | "all">("none");

  function copy(text: string, which: "body" | "all") {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(which);
        window.setTimeout(() => setCopied("none"), 1500);
      },
      () => {
        /* clipboard unavailable — no-op */
      },
    );
  }

  const fullText = draft.subject
    ? `Subject: ${draft.subject}\n\n${draft.body}`
    : draft.body;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800">
            {draft.businessName ?? "Unknown business"}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-500">
            {draft.channel}
          </span>
          {draft.predictedTier ? (
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tierClass(
                draft.predictedTier,
              )}`}
              data-tip="Predicted response tier"
            >
              {draft.predictedTier} tier
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copy(fullText, "all")}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {copied === "all" ? "Copied" : "Copy all"}
          </button>
          <button
            type="button"
            onClick={() => copy(draft.body, "body")}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {copied === "body" ? "Copied" : "Copy body"}
          </button>
        </div>
      </div>

      {draft.subject ? (
        <div className="mb-1.5 text-sm">
          <span className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
            Subject
          </span>
          <div className="text-slate-800">{draft.subject}</div>
        </div>
      ) : null}

      <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        {draft.body}
      </pre>

      {draft.why.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
            Why this works
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {draft.why.map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.usedSignals.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {draft.usedSignals.map((s) => (
            <span
              key={s}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
