/**
 * AgPitch · "Stop renting Apollo. Start hunting with intent."
 *
 * White section, centered head, then the two-card comparison: the muted
 * "cold list" column (red ✕) vs the yellow-framed "signal-based query"
 * column (green ✓). Same .fb-board-* card system as the SMB pitch — only
 * the accent colour + the ✕ glyph differ.
 *
 * Pure server component.
 */
interface AgPitchProps {
  t: (key: string) => string;
}

const POINTS = [1, 2, 3, 4, 5] as const;

/** Check · the signal-query column bullet (design asset ok1.svg) · stroked
 *  #597277 with the same soft blue drop-shadow as the ✕. */
function OkGlyph() {
  return (
    <svg
      width="22"
      height="13"
      viewBox="0 0 22 12"
      fill="none"
      aria-hidden
      style={{
        filter: "drop-shadow(2.67px 5.33px 2.67px rgba(87, 108, 192, 0.2))",
      }}
    >
      <path
        d="M3.69141 5.39801L10.0914 10.7313L19.6914 1.13135"
        stroke="#597277"
        strokeWidth="3.2"
      />
    </svg>
  );
}

/** Red ✕ · the cold-list column bullet (design asset cross.svg) · the soft
 *  blue drop-shadow matches the board check/dash glyphs. */
function XGlyph() {
  return (
    <svg
      className="fb-ag-x"
      width="19"
      height="16"
      viewBox="0 0 19 16"
      fill="none"
      aria-hidden
      style={{
        filter: "drop-shadow(1.56px 3.12px 1.56px rgba(87, 108, 192, 0.2))",
      }}
    >
      <path
        d="M17.5586 2.20703L11.7656 8L17.5586 13.793L15.3516 16L9.55859 10.207L3.76562 16L1.55859 13.793L7.35156 8L1.55859 2.20703L3.76562 0L9.55859 5.79297L15.3516 0L17.5586 2.20703Z"
        fill="#E53A35"
      />
    </svg>
  );
}

export function AgPitch({ t }: AgPitchProps) {
  return (
    <section
      className="fb-section fb-ag-pitch"
      aria-labelledby="fb-ag-pitch-title"
      data-fb-tone="light"
    >
      <div className="fb-container">
        <div className="fb-ag-pitch-head">
          <h2 id="fb-ag-pitch-title" className="fb-h2">
            {t("pitch.title_lead")}{" "}
            <em className="fb-em fb-agacc">{t("pitch.title_emph")}</em>
          </h2>
          <p className="fb-sub">
            {t("pitch.sub_lead")}
            <span className="fb-ag-pitch-emph">{t("pitch.sub_emph")}</span>
            {t("pitch.sub_tail")}
          </p>
        </div>

        <div className="fb-board-grid">
          <div className="fb-board-card fb-board-card--now">
            <p className="fb-ag-card-eyebrow fb-ag-card-eyebrow--old">
              {t("pitch.old_eyebrow")}
            </p>
            <h3>{t("pitch.old_label")}</h3>
            <ul className="fb-board-list">
              {POINTS.map((i) => (
                <li key={i}>
                  <XGlyph />
                  {t(`pitch.old_p${i}`)}
                </li>
              ))}
            </ul>
          </div>

          <div className="fb-board-card fb-board-card--mapsly">
            <p className="fb-ag-card-eyebrow fb-ag-card-eyebrow--new">
              {t("pitch.new_eyebrow")}
            </p>
            <h3>{t("pitch.new_label")}</h3>
            <ul className="fb-board-list">
              {POINTS.map((i) => (
                <li key={i}>
                  <OkGlyph />
                  {t(`pitch.new_p${i}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
