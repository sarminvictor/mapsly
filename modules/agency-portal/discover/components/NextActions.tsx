// NextActions · a ranked next-best-action list (Phase 9). Pure/presentational:
// the caller passes the items, we rank them by weight (rankNextActions) and
// render them densely. Each row is a real link when `href` is set, otherwise a
// static row. Tone is paired with text (never color-only · a11y).
//
// Agency voice: imperative labels ("Enrich contacts", "Save as list"), terse
// detail lines, numbers welcome.

import { Link } from "@/i18n/navigation";

import {
  rankNextActions,
  toneClasses,
  type NextActionItem,
} from "../visual-helpers";

export type { NextActionItem };

export interface NextActionsProps {
  items: NextActionItem[];
  /** Heading above the list. */
  title?: string;
  /** Message when there are no actions. */
  emptyLabel?: string;
}

function Row({ item }: { item: NextActionItem }) {
  const tone = item.tone ?? "neutral";
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span
        aria-hidden
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border ${toneClasses(tone)}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{item.label}</p>
        {item.detail ? (
          <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

export function NextActions({
  items,
  title = "Next best actions",
  emptyLabel = "Nothing queued. Run a discovery to surface actions.",
}: NextActionsProps) {
  const ranked = rankNextActions(items);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {ranked.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {ranked.map((item) => (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href as never}
                  className="block hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                >
                  <Row item={item} />
                </Link>
              ) : (
                <Row item={item} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
