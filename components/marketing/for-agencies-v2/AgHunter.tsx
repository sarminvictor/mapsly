/**
 * AgHunter · "This is Hunter. This is what you'd be using tomorrow."
 *
 * Green rounded band (same gradient as the SMB reviews block). Heading +
 * sub on the left, a 2×2 stat block on the right, then a stylised dark
 * product-demo panel below: a saved-search query bar, a filter rail, and a
 * results table. The demo is a static illustration of the product — the
 * table rows are decorative (aria-hidden) so screen readers skip the
 * placeholder data and land on the real copy.
 *
 * Pure server component.
 */
interface AgHunterProps {
  t: (key: string) => string;
}

const STATS = [1, 2, 3, 4] as const;
const ROWS = [1, 2, 3, 4] as const;
const CHIPS = [1, 2, 3, 4] as const;

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12.5 12.5L16 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AgHunter({ t }: AgHunterProps) {
  return (
    <section
      className="fb-section fb-stack-card fb-ag-hunter"
      aria-labelledby="fb-ag-hunter-title"
      data-fb-tone="dark"
    >
      <div className="fb-container">
        <div className="fb-ag-hunter-top">
          <div>
            <h2 id="fb-ag-hunter-title" className="fb-h2">
              {t("hunter.title_lead")}{" "}
              <em className="fb-em fb-mintacc">{t("hunter.title_emph")}</em>
            </h2>
            <p className="fb-sub">{t("hunter.sub")}</p>
          </div>

          <div className="fb-ag-stats">
            {STATS.map((i) => (
              <div key={i}>
                <div className="fb-ag-stat-num">
                  {t(`hunter.stat_${i}_num`)}
                </div>
                <p className="fb-ag-stat-label">
                  {t(`hunter.stat_${i}_label`)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Static product illustration — decorative for AT users. */}
        <div className="fb-ag-demo" aria-hidden>
          <div className="fb-ag-demo-bar">
            <span className="fb-ag-demo-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="fb-ag-demo-query">
              <SearchGlyph />
              {t("hunter.demo_query")}
            </span>
            <span className="fb-ag-demo-refresh">
              {t("hunter.demo_refresh")}
            </span>
          </div>

          <div className="fb-ag-demo-body">
            <div className="fb-ag-demo-rail">
              <p className="fb-ag-rail-label">{t("hunter.demo_filters")}</p>
              {CHIPS.map((i) => (
                <span key={i} className="fb-ag-chip">
                  {t(`hunter.demo_chip_${i}`)}
                  <b>{t(`hunter.demo_chip_${i}_val`)}</b>
                </span>
              ))}
            </div>

            <div className="fb-ag-demo-table">
              <div className="fb-ag-trow fb-ag-trow--head">
                <span>{t("sample_list.header_business")}</span>
                <span>{t("sample_list.header_signals")}</span>
                <span>{t("sample_list.header_score")}</span>
              </div>
              {ROWS.map((i) => (
                <div key={i} className="fb-ag-trow">
                  <div>
                    <div className="fb-ag-tname">
                      {t(`sample_list.row_${i}_name`)}
                    </div>
                    <p className="fb-ag-tmeta">
                      {t(`sample_list.row_${i}_meta`)}
                    </p>
                  </div>
                  <div className="fb-ag-tsignals">
                    {t(`sample_list.row_${i}_signals`)}
                  </div>
                  <span className="fb-ag-tmatch">
                    {t(`sample_list.row_${i}_score`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
