/**
 * PeekMock · the right-column product peek in the welcome hero.
 *
 * A faithful static mini-mock of the leads workbench (prototype `.peek`,
 * docs/portal-prototype.html lines 6827-6876). Pure presentation — `aria-hidden`
 * because it's illustrative, not interactive content. The sample rows are
 * hardcoded marketing content matching the prototype exactly.
 *
 * Server component (no client behavior). Copy is English-only for now.
 */

interface PeekRow {
  name: string;
  meta: string;
  match: string;
  sigs: { text: string; pain?: boolean }[];
}

const ROWS: PeekRow[] = [
  {
    name: "Solea Med Spa",
    meta: "★ 4.2 · 212 reviews · Brickell",
    match: "88%",
    sigs: [
      { text: "Overdue for a redesign" },
      { text: "Runs Meta ads without a pixel", pain: true },
    ],
  },
  {
    name: "Glow Aesthetics Studio",
    meta: "★ 4.6 · 88 reviews · Wynwood",
    match: "81%",
    sigs: [
      { text: "Invisible locally" },
      { text: "Reputation slipping", pain: true },
    ],
  },
  {
    name: "Lumière Skin Bar",
    meta: "★ 3.9 · 47 reviews · Coral Gables",
    match: "76%",
    sigs: [
      { text: "Losing mobile customers" },
      { text: "Legal & compliance risk", pain: true },
    ],
  },
];

export function PeekMock() {
  return (
    <div className="peek" aria-hidden="true">
      <div className="peek-head">
        <span className="pdot" /> Med spas · Miami
        <span className="pcount">64 qualified</span>
      </div>
      {ROWS.map((row) => (
        <div className="peek-item" key={row.name}>
          <div className="peek-top">
            <div>
              <div className="peek-name">{row.name}</div>
              <div className="peek-meta">{row.meta}</div>
            </div>
            <span className="peek-match">{row.match}</span>
          </div>
          <div className="peek-sigs">
            {row.sigs.map((sig) => (
              <span
                className={sig.pain ? "psig pain" : "psig"}
                key={sig.text}
              >
                {sig.text}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="peek-fade" />
    </div>
  );
}
