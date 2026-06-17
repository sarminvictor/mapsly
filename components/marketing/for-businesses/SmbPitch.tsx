import { BoardCheck, BoardDash } from "./fb-shared";

/**
 * SmbPitch · "Your business has a scoreboard. We just show it to you."
 *
 * White section, centered head, then the two-card comparison: muted
 * "what you see today" vs the yellow-framed "what you see with Mapsly".
 * The contrast does the persuading; we don't narrate it heavy-handedly.
 *
 * Pure server component.
 */
interface SmbPitchProps {
  t: (key: string) => string;
}

const POINTS = [1, 2, 3, 4] as const;

export function SmbPitch({ t }: SmbPitchProps) {
  return (
    <section
      className="fb-section fb-pitch"
      aria-labelledby="fb-pitch-title"
      data-fb-tone="light"
    >
      <div className="fb-container">
        <div className="fb-board-head">
          <h2 id="fb-pitch-title" className="fb-h2">
            {t("pitch.title_lead")}{" "}
            <em className="fb-em fb-redacc">{t("pitch.title_emph")}</em>
          </h2>
          <p className="fb-sub">{t("pitch.sub")}</p>
        </div>

        <div className="fb-board-grid">
          <div className="fb-board-card fb-board-card--now">
            <h3>{t("pitch.old_label")}</h3>
            <ul className="fb-board-list">
              {POINTS.map((i) => (
                <li key={i}>
                  <BoardDash />
                  {t(`pitch.old_p${i}`)}
                </li>
              ))}
            </ul>
          </div>

          <div className="fb-board-card fb-board-card--mapsly">
            <h3>{t("pitch.new_label")}</h3>
            <ul className="fb-board-list">
              {POINTS.map((i) => (
                <li key={i}>
                  <BoardCheck />
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
