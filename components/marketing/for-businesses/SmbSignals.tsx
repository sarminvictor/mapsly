import { StatArrow } from "./fb-shared";

/**
 * SmbSignals · "Not metrics. Plain English."
 *
 * Cream rounded band (landing's second-screen palette): pitch on the left,
 * seven signal cards in an auto-rising feed on the right — each a plain-English
 * fact with a colored progress bar, not a dashboard metric.
 *
 * Pure server component.
 */
interface SmbSignalsProps {
  t: (key: string) => string;
}

// Per-card accent + bar fill. Yellow / red / purple match the signal type.
const CARDS = [
  { n: 1, bar: 60, color: "var(--fb-yellow-deep)" },
  { n: 2, bar: 75, color: "#f81b1e" },
  { n: 3, bar: 55, color: "#a78fdf" },
  { n: 4, bar: 68, color: "#5fae8a" },
  { n: 5, bar: 40, color: "#f81b1e" },
  { n: 6, bar: 50, color: "var(--fb-yellow-deep)" },
  { n: 7, bar: 35, color: "#a78fdf" },
] as const;

/** Render a stat string, swapping a literal "→" for the SVG arrow glyph. */
function StatText({ value }: { value: string }) {
  if (!value.includes("→")) return <>{value}</>;
  const [from, to] = value.split("→");
  return (
    <span className="fb-stat-value">
      <span>{from.trim()}</span>
      <StatArrow />
      <span>{to.trim()}</span>
    </span>
  );
}

export function SmbSignals({ t }: SmbSignalsProps) {
  return (
    <section
      className="fb-section fb-stack-card fb-signals"
      aria-labelledby="fb-signals-title"
      data-fb-tone="light"
    >
      <div className="fb-container fb-split">
        <div>
          <h2 id="fb-signals-title" className="fb-h2">
            {t("signals.title_lead")}{" "}
            <em className="fb-em fb-redacc">{t("signals.title_emph")}</em>
          </h2>
          <p className="fb-sub">{t("signals.sub")}</p>
        </div>

        {/* Auto-rising feed: the 7 cards are rendered twice so the upward
            scroll loops seamlessly (translateY(-50%) lands the duplicate on
            the original). The second copy is aria-hidden. Pauses for
            prefers-reduced-motion. */}
        <div className="fb-stat-stack">
          <div className="fb-stat-track">
            {[...CARDS, ...CARDS].map(({ n, bar, color }, idx) => (
              <div
                key={idx}
                className="fb-stat-card"
                aria-hidden={idx >= CARDS.length || undefined}
              >
                <div className="fb-stat-card-head">
                  <p className="fb-stat-card-label">
                    {t(`signals.c${n}_label`)}
                  </p>
                  <span className="fb-stat-card-tag">
                    {t(`signals.c${n}_tag`)}
                  </span>
                </div>
                <div className="fb-stat-card-num">
                  <StatText value={t(`signals.c${n}_stat`)} />
                  <span className="fb-unit">{t(`signals.c${n}_unit`)}</span>
                </div>
                <div className="fb-stat-bar" aria-hidden>
                  <i style={{ width: `${bar}%`, background: color }} />
                </div>
                <p className="fb-stat-card-desc">{t(`signals.c${n}_desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
