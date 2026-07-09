/**
 * "Why Mapsly is cheaper" — reworked 2026-07-09 after the billing-repricing
 * review (docs/billing-repricing-review-2026-07-09.html, Part C).
 *
 * A compact comparison table (Tom's audience: tables are first-class). Every
 * cell was re-checked against live rival pricing (Jul 2026) so it survives a
 * substantiation demand:
 *   - Mapsly's own row now shows BOTH the delivered-lead and the fully-enriched
 *     price, matching how the rival rows are shown (no apples-to-oranges).
 *   - Apollo is framed on the per-seat cost buyers actually pay, not the
 *     à-la-carte overage rate.
 *   - Instantly was removed (it's cheaper on raw records — a distraction here).
 *   - Origami's wedge is the true differentiator (free discovery + never-expiring
 *     top-ups + the 60+ local-signal moat), not a false "flat vs pay-per-result".
 *   - Clay + DIY Google-Maps scrapers added so the table isn't cherry-picked.
 * Figures are our own estimates from public pricing as of Jul 2026 — see the
 * dated disclaimer + docs/competitor-pricing-receipts/.
 *
 * Server-presentational; no functions cross a `'use client'` boundary.
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
    perLead: "$0.05–0.08 · ~$0.28–0.46 fully enriched",
    vsMapsly: "Your baseline",
    win: true,
  },
  {
    tool: "Origami",
    model:
      "Flat credit plans · discovery costs credits · pay-as-you-go overage",
    perLead: "$0.07–0.12 · $0.30+ fully enriched",
    vsMapsly: "Similar price, no free discovery",
  },
  {
    tool: "Apollo",
    model: "$49–119 per seat / mo · credits expire monthly · $0.20 overage",
    perLead: "$147+/mo for a 3-seat team before a lead",
    vsMapsly: "Per-seat pricing · no local “why”",
  },
  {
    tool: "Clay",
    model: "Per-enrichment credit stacking · B2B-oriented",
    perLead: "$185/mo entry · multi-credit / lead",
    vsMapsly: "3–4× the entry price",
  },
  {
    tool: "ZoomInfo",
    model: "Quote-only seats · annual lock",
    perLead: "≈$1–3 / credit (est.)",
    vsMapsly: "15–40× more",
  },
  {
    tool: "DIY Maps scrapers",
    model: "Outscraper / D7 · raw records, no qualification",
    perLead: "$0.003–0.01 / raw record",
    vsMapsly: "Cheaper records — no verification, scoring or signals",
  },
];

export function WhyCheaper() {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="eyebrow">Why Mapsly is cheaper</div>
      <p className="note" style={{ marginTop: 2 }}>
        Flat fee, free discovery, and reasons to call others can&apos;t see.
        Figures are our own calculations from each vendor&apos;s public pricing,
        as of July 2026 — for orientation, not official, and pricing may have
        changed.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ marginTop: 8 }}
          aria-label="Pricing comparison vs competitors"
        >
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Model</th>
              <th scope="col">What it costs</th>
              <th scope="col">vs Mapsly</th>
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
          <b>vs Origami</b> — discovery costs credits there; Mapsly maps the
          market free and charges only delivered leads, and your top-up credits
          never expire. Their crawl isn&apos;t built for our 60+ local signals.
        </li>
        <li>
          <b>vs Apollo / ZoomInfo</b> — per-seat pricing (and, with ZoomInfo, an
          annual lock) before you export a single lead. Mapsly bundles seats
          into a flat plan.
        </li>
        <li>
          <b>vs DIY scrapers</b> — raw records cost a cent, but you get names,
          not verified contacts with reasons to call: no dedup, no scoring, no
          60-signal qualification, no refresh.
        </li>
      </ul>
    </div>
  );
}
