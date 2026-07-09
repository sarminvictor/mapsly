"use client";

// FT-2 · Search-everywhere Preview (step 3, search variant). Mirrors the Target
// Preview's role — "before you spend, here's the cost" — then the same
// research→results→My-research pipeline. The ONLY difference from Target is how
// leads are selected (a signal-matched sweep of our index), and Enrich is
// skipped (search leads already carry contacts). Charge is 1 credit per
// DELIVERED lead — never the requested amount.

import type { GoalState } from "../../flow-types";
import { SIG_META } from "../../goal-templates";

export function SearchPreviewStep({
  goal,
  leadCount,
  walletCredits,
  searching,
  onRun,
  onBack,
  onAddCredits,
}: {
  goal: GoalState;
  leadCount: number;
  walletCredits: number;
  searching: boolean;
  onRun: () => void;
  onBack: () => void;
  onAddCredits: () => void;
}) {
  const activeSignals = goal.filters.filter((f) => f.on);
  // Free/paid clamp is server-authoritative; here we show the honest ceiling:
  // you can only get as many as your balance covers (1 credit each).
  const willTry = Math.min(leadCount, Math.max(0, walletCredits));
  const noCredits = walletCredits < 1;

  return (
    <div>
      <h1>
        Ready to <span className="hl">search</span>?
      </h1>
      <p className="sub">
        We&apos;ll sweep every market we&apos;ve already mapped for businesses
        that match your signals and have contacts — no new market to open.
      </p>

      <div
        className="matrix"
        style={{ display: "flex", gap: 18, flexWrap: "wrap" }}
      >
        <div className="card" style={{ flex: "1 1 320px" }}>
          <div className="eyebrow">Your signals</div>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}
          >
            {activeSignals.length === 0 ? (
              <span className="note">
                No signals — we&apos;ll return contactable businesses across
                markets.
              </span>
            ) : (
              activeSignals.map((f) => (
                <span key={f.key} className="pill">
                  {SIG_META[f.key]?.title ?? f.key.replace(/_/g, " ")}
                </span>
              ))
            )}
          </div>
          <div className="note" style={{ marginTop: 12 }}>
            Every delivered lead <b>matches all</b> your signals — including the
            reviews, ads and site signals, checked against data we&apos;ve
            already gathered. You get the matched businesses now — the exact
            signal values unlock when you enrich a lead. A target, not a
            guarantee — thin markets return fewer.
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 260px" }}>
          <div className="eyebrow">Cost</div>
          <div style={{ fontSize: 26, fontWeight: 750, marginTop: 6 }}>
            up to {willTry} credit{willTry === 1 ? "" : "s"}
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            <b>1 credit per lead</b>, and you&apos;re charged{" "}
            <b>only for the leads we deliver</b>. Add reviews, ads or site data
            on any lead later for +1–2 credits each.
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            Balance: <b>{walletCredits}</b> credit
            {walletCredits === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {noCredits ? (
        <div
          className="callout"
          style={{
            marginTop: 16,
            background: "var(--amber-50, #fbf3e2)",
            border: "1px solid var(--amber, #b7791f)",
          }}
        >
          <p style={{ margin: 0 }}>
            <b>You have no credits.</b> Search-everywhere charges 1 credit per
            lead — add credits to pull your leads.
          </p>
          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 10 }}
            onClick={onAddCredits}
          >
            Add credits →
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginTop: 20,
          gap: 12,
        }}
      >
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        <div style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className="btn primary"
            disabled={searching || noCredits}
            onClick={onRun}
          >
            {searching ? "Searching…" : `Get ${willTry} leads →`}
          </button>
        </div>
      </div>
    </div>
  );
}
