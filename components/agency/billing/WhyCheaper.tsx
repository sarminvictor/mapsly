/**
 * "Why Mapsly is cheaper" — reworked to C4 (docs/billing-repricing-2026-07-09).
 * A compact comparison table (Tom's audience: tables are first-class) with the
 * closest rival Origami as its own row, plus three positioning wedges below.
 * Figures are our approximate estimates from public pricing — orientation, not
 * official. Server-presentational; no functions cross a `'use client'` boundary.
 */

interface CompareRow {
  tool: string;
  model: string;
  perLead: string;
  vsMapsly: string;
  win?: boolean;
}

const ROWS: CompareRow[] = [
  {
    tool: "Mapsly",
    model: "Flat plan · free discovery · seats included · charge-on-delivery",
    perLead: "$0.05–0.08",
    vsMapsly: "Your baseline",
    win: true,
  },
  {
    tool: "Origami · closest rival",
    model: "Credit, pay-per-result forever · also crawls Maps",
    perLead: "$0.07–0.12 · $0.30+ full",
    vsMapsly: "1.5–2× more",
  },
  {
    tool: "Instantly",
    model: "Raw B2B leads",
    perLead: "$0.02–0.05",
    vsMapsly: "Cheaper — no local “why”",
  },
  {
    tool: "Apollo",
    model: "Seat + credit, overage",
    perLead: "$0.20 / contact",
    vsMapsly: "2–4× more",
  },
  {
    tool: "ZoomInfo",
    model: "Quote-only seats, annual lock",
    perLead: "$1–3 / credit",
    vsMapsly: "15–40× more",
  },
];

export function WhyCheaper() {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="eyebrow">Why Mapsly is cheaper</div>
      <p className="note" style={{ marginTop: 2 }}>
        Flat fee, free discovery, and reasons to call others can&apos;t see.
        Figures are our approximate estimates from public pricing — for
        orientation, not official.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Model</th>
              <th>Per enriched lead</th>
              <th>vs Mapsly</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.tool}>
                <td style={{ fontWeight: r.win ? 750 : 600 }}>
                  {r.win ? <span className="cr">{r.tool}</span> : r.tool}
                </td>
                <td className="note">{r.model}</td>
                <td style={{ fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>
                  {r.perLead}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {r.win ? (
                    <span className="pill indigo">{r.vsMapsly}</span>
                  ) : (
                    r.vsMapsly
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="plan-feat" style={{ marginTop: 12 }}>
        <li>
          <b>vs Origami</b> — they bill per lead forever; Mapsly is one flat fee
          that amortizes, and their generic crawl can&apos;t produce our 60+
          local signals.
        </li>
        <li>
          <b>vs Apollo / ZoomInfo</b> — 2–40× more, with the per-seat tax and
          annual locks Tom is fleeing.
        </li>
        <li>
          <b>vs Instantly</b> — cheaper per raw record, but names, not reasons
          to call.
        </li>
      </ul>
    </div>
  );
}
