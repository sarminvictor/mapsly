/**
 * SmbMirror · "Five minutes. Once a week. Everything that matters."
 *
 * Deep-teal rounded band: weekly-check pitch on the left, the Mapsly
 * Score gauge card on the right, three big stat columns below
 * (customers lost · reviews waiting · weekly fixes).
 *
 * Server component. The gauge dial + the four stat numbers animate on
 * scroll via two tiny client leaves (<ScoreGauge> / <CountUp>) — all string
 * resolution stays here on the server.
 */
import {
  MirrorIconPeople,
  MirrorIconReviews,
  MirrorIconTrophy,
  GlyphDown,
  GlyphCross,
  GlyphCheck,
} from "./fb-shared";
import { CountUp, ScoreGauge } from "./mirror-anim";

interface SmbMirrorProps {
  t: (key: string) => string;
  locale: string;
}

/** Parse a localized stat string ("6.2" / "6,2" / "23") to a number. */
const toNum = (s: string) => Number(s.replace(",", ".")) || 0;

const STATS = [
  { block: 2, Icon: MirrorIconPeople, Glyph: GlyphDown },
  { block: 3, Icon: MirrorIconReviews, Glyph: GlyphCross },
  { block: 4, Icon: MirrorIconTrophy, Glyph: GlyphCheck },
] as const;

export function SmbMirror({ t, locale }: SmbMirrorProps) {
  return (
    <section
      className="fb-section fb-stack-card fb-mirror"
      aria-labelledby="fb-mirror-title"
      data-fb-tone="dark"
    >
      <div className="fb-container">
        <div className="fb-mirror-top">
          <div>
            <h2 id="fb-mirror-title" className="fb-h2">
              {t("mirror.title_lead")}{" "}
              <em className="fb-em fb-iceacc">{t("mirror.title_emph")}</em>
            </h2>
            <p className="fb-sub fb-sub--light">{t("mirror.sub")}</p>
          </div>

          <div className="fb-score-card">
            <ScoreGauge
              score={toNum(t("mirror.block_1_number"))}
              max={10}
              unit={t("mirror.block_1_unit")}
              locale={locale}
              ariaLabel={`${t("mirror.block_1_label")} ${t("mirror.block_1_number")}${t("mirror.block_1_unit")}`}
            />
            <p className="fb-score-label">{t("mirror.block_1_label")}</p>
            <p className="fb-score-desc">{t("mirror.block_1_desc")}</p>
          </div>
        </div>

        <div className="fb-mirror-stats">
          {STATS.map(({ block, Icon, Glyph }) => (
            <div key={block} className="fb-mstat">
              <span className="fb-mstat-icon" aria-hidden>
                <Icon />
              </span>
              <div className="fb-mstat-body">
                <div className="fb-mstat-num">
                  <CountUp
                    value={toNum(t(`mirror.block_${block}_number`))}
                    locale={locale}
                  />
                  <span className="fb-mstat-glyph" aria-hidden>
                    <Glyph />
                  </span>
                </div>
                <p className="fb-mstat-label">
                  {t(`mirror.block_${block}_label`)}
                </p>
                <p className="fb-mstat-desc">
                  {t(`mirror.block_${block}_desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
