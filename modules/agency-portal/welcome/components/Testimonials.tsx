/**
 * Testimonials · the two social-proof quote cards below the welcome hero.
 *
 * Prototype `.grid.g2.section` of two `.quotecard`s (docs/portal-prototype.html
 * lines 6880-6904). The Apollo-vs-Mapsly positioning ("names" vs "the reason to
 * call"). Pure presentation — static marketing copy matching the prototype.
 *
 * Server component. The yellow opening-quote glyph + star styling come from the
 * ported `.quotecard` CSS. Copy is English-only for now.
 */

export function Testimonials() {
  return (
    <div className="grid g2 section" style={{ alignItems: "stretch" }}>
      <div className="quotecard">
        <div className="qstars" aria-label="5 out of 5 stars">
          ★★★★★
        </div>
        <p className="qtext">
          Apollo gave me names. Mapsly gives me the{" "}
          <span className="hl">reason to call</span> — the slow site, the dead
          pixel, the unanswered reviews. My reply rate went from 2% to 19%.
        </p>
        <div className="qchose">Switched from Apollo</div>
        <div className="qwho">
          Marcus Hale · owner, Brightpath Agency (Toronto)
        </div>
      </div>
      <div className="quotecard">
        <div className="qstars" aria-label="5 out of 5 stars">
          ★★★★★
        </div>
        <p className="qtext">
          One search pulled{" "}
          <span className="hl">64 med spas losing bookings</span> to a slow site
          — with the proof for each. Two retainers signed that month.
        </p>
        <div className="qchose">Replaced manual prospecting</div>
        <div className="qwho">Dana Reyes · founder, Coastline Studio</div>
      </div>
    </div>
  );
}
