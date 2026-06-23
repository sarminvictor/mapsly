"use client";

// GenerateTouchpointsPanel · the trigger that turns discovered, reachable
// prospects into signal-grounded first-touch drafts (Phase 8). Calls the
// deterministic generateTouchpointsAction (bounded batch), then refreshes the
// read-only TouchpointsList below it. Agency-register copy (imperative, dense).

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { generateTouchpointsAction } from "@/modules/outreach/actions";

// Matches TouchChannel in modules/outreach/first-touch.ts.
type Channel = "email" | "dm" | "phone" | "social";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "dm", label: "DM" },
  { value: "phone", label: "Phone" },
  { value: "social", label: "Social" },
];

export function GenerateTouchpointsPanel() {
  const router = useRouter();
  const [sellingWhat, setSellingWhat] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function run() {
    setMsg(null);
    setError(false);
    start(async () => {
      const r = await generateTouchpointsAction({
        sellingWhat: sellingWhat.trim(),
        channel,
      });
      if (r.status === "ok") {
        setMsg(
          r.generated > 0
            ? `Generated ${r.generated} draft${r.generated === 1 ? "" : "s"} from ${r.scanned} prospects.`
            : "No new prospects to draft — every discovered, reachable business already has a touch.",
        );
        router.refresh();
      } else if (r.status === "invalid_input") {
        setError(true);
        setMsg(r.message);
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 text-xs font-medium text-slate-600">
          What are you selling?
          <input
            type="text"
            value={sellingWhat}
            onChange={(e) => setSellingWhat(e.target.value)}
            placeholder="e.g. local SEO retainers for med-spas"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
          />
        </label>
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
        <button
          type="button"
          disabled={pending || sellingWhat.trim().length < 3}
          onClick={run}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate"}
        </button>
      </div>
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
