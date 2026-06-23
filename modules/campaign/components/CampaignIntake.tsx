"use client";

// CampaignIntake · the 2-pane demand-intent intake (Phase 9). Left pane: what
// you're selling / who you sell to / pain points. Right pane: the proposed
// strategy (categories / enrichments / filters / rationale) updated live via
// getStrategyAction as the agency types (debounced), with a "Save campaign" CTA
// that calls createCampaignAction.
//
// Agency voice: tool-y, dense, imperative actions, jargon welcome (per
// .claude/rules/ui-ux-agency.md). English-only for now (the app runs
// English-only — see i18n/routing.ts).

import { useEffect, useRef, useState, useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import {
  getStrategyAction,
  createCampaignAction,
  type GetStrategyResult,
} from "@/modules/campaign/actions";

const DEBOUNCE_MS = 500;

export function CampaignIntake() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [sellingWhat, setSellingWhat] = useState("");
  const [buyerIcp, setBuyerIcp] = useState("");
  const [painPoints, setPainPoints] = useState("");

  const [strategy, setStrategy] = useState<GetStrategyResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live strategy preview · debounced on every intent edit. ALL setState happens
  // inside the deferred timeout (never synchronously in the effect body) to avoid
  // the cascading-render lint rule — clearing an empty field is debounced too.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = sellingWhat.trim();
    debounceRef.current = setTimeout(() => {
      if (trimmed.length === 0) {
        setStrategy(null);
        setPreviewError(null);
        return;
      }
      setPreviewError(null);
      startPreview(async () => {
        try {
          const r = await getStrategyAction({
            sellingWhat: trimmed,
            buyerIcp: buyerIcp.trim() || undefined,
            painPoints: painPoints.trim() || undefined,
          });
          setStrategy(r);
        } catch {
          setStrategy(null);
          setPreviewError("Couldn't preview the strategy. Try again.");
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sellingWhat, buyerIcp, painPoints]);

  function save() {
    setSaveError(null);
    const trimmed = sellingWhat.trim();
    if (trimmed.length === 0) {
      setSaveError("Tell us what you're selling first.");
      return;
    }
    startSave(async () => {
      try {
        const res = await createCampaignAction({
          name: name.trim() || undefined,
          sellingWhat: trimmed,
          buyerIcp: buyerIcp.trim() || undefined,
          painPoints: painPoints.trim() || undefined,
        });
        // Saved · route to discover so the agency can run the strategy.
        router.push(`/discover?campaign=${res.campaignId}` as never);
      } catch {
        setSaveError("Couldn't save the campaign. Try again.");
      }
    });
  }

  const canSave = sellingWhat.trim().length > 0 && !saving;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left · intent intake */}
      <section className="space-y-4">
        <Field
          label="Campaign name"
          help="Optional — a label for your team."
          optional
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Q3 website pitch"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          />
        </Field>

        <Field
          label="What are you selling?"
          help="The primary input — e.g. websites, booking software, reputation management, PPC, SEO."
        >
          <textarea
            value={sellingWhat}
            onChange={(e) => setSellingWhat(e.target.value)}
            rows={3}
            placeholder="We sell website redesigns + ongoing maintenance to local service businesses."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          />
        </Field>

        <Field
          label="Who's the buyer?"
          help="Optional ICP refinement."
          optional
        >
          <textarea
            value={buyerIcp}
            onChange={(e) => setBuyerIcp(e.target.value)}
            rows={2}
            placeholder="Med-spas + dental clinics doing $1M+ with an outdated site."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          />
        </Field>

        <Field
          label="Pain points you solve"
          help="Optional — sharpens the signal weights."
          optional
        >
          <textarea
            value={painPoints}
            onChange={(e) => setPainPoints(e.target.value)}
            rows={2}
            placeholder="Slow site, no schema, losing mobile bookings."
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save campaign"}
          </button>
          {saveError ? (
            <span className="text-sm text-red-600" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </section>

      {/* Right · live proposed strategy */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Proposed strategy
          </h2>
          <span className="font-mono text-xs text-slate-400">
            {previewing
              ? "thinking…"
              : strategy
                ? `~$${strategy.estimatedCostUsd.toFixed(4)} / business`
                : "—"}
          </span>
        </header>

        {previewError ? (
          <p className="text-sm text-red-600" role="alert">
            {previewError}
          </p>
        ) : !strategy ? (
          <p className="text-sm text-slate-500">
            Describe what you&apos;re selling and we&apos;ll propose the
            categories, enrichments, and filters to target.
          </p>
        ) : (
          <StrategyPreview strategy={strategy} />
        )}
      </section>
    </div>
  );
}

function StrategyPreview({ strategy }: { strategy: GetStrategyResult }) {
  const s = strategy.strategy;
  return (
    <div className="space-y-4">
      <PreviewGroup title="Target categories">
        <div className="flex flex-wrap gap-1.5">
          {s.recommendedCategories.map((c) => (
            <span
              key={c}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-600"
            >
              {c}
            </span>
          ))}
        </div>
      </PreviewGroup>

      <PreviewGroup title="Enrichments">
        <div className="flex flex-wrap gap-1.5">
          {s.recommendedEnrichments.map((e) => (
            <span
              key={e}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-xs text-indigo-700"
            >
              {e}
            </span>
          ))}
        </div>
      </PreviewGroup>

      <PreviewGroup title="Suggested filters">
        <ul className="space-y-1">
          {s.suggestedFilters.map((f, i) => (
            <li
              key={`${f.signalKey}-${i}`}
              className="font-mono text-xs text-slate-600"
            >
              {f.signalKey} {f.comparator} {String(f.value)}
            </li>
          ))}
        </ul>
      </PreviewGroup>

      <PreviewGroup title="Why this strategy">
        <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-slate-600">
          {s.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </PreviewGroup>
    </div>
  );
}

function PreviewGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  help,
  optional,
  children,
}: {
  label: string;
  help?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {optional ? (
          <span className="font-mono text-xs text-slate-400">optional</span>
        ) : null}
      </span>
      {children}
      {help ? (
        <span className="mt-1 block text-xs text-slate-500">{help}</span>
      ) : null}
    </label>
  );
}
