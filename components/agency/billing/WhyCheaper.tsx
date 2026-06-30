/**
 * "Why Mapsly is cheaper" competitor compare (prototype #view-billing lines
 * 8307–8347). Three columns — Mapsly (win) vs per-seat contact tools vs
 * per-action AI agents. Server-presentational; copy verbatim from the prototype.
 */
export function WhyCheaper() {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="eyebrow">Why Mapsly is cheaper</div>
      <p className="note" style={{ marginTop: 2 }}>
        Lower price, free discovery, and reasons to call others can&apos;t see.
        Figures are our approximate estimates from public pricing — for
        orientation, not official.
      </p>
      <div className="compare">
        <div className="cmp win">
          <div className="cmp-name">
            Mapsly
            <span className="pill indigo">$0.037–0.06 / enriched lead</span>
          </div>
          <div className="cmp-price">Free discovery · flat, no per-seat</div>
          <div className="cmp-mult win">Cheapest · your baseline</div>
          <div className="cmp-note">
            Local signals competitors can&apos;t see — slow site, no pixel,
            reviews slipping. A reason to call, not just a contact.
          </div>
        </div>
        <div className="cmp">
          <div className="cmp-name">Per-seat contact tools</div>
          <div className="cmp-price">~$0.10–0.20 / contact</div>
          <div className="cmp-mult">≈ 2–4× the cost</div>
          <div className="cmp-note">
            Billed per seat — a 4-person team pays 4×. Contacts only, no local
            signals.
          </div>
        </div>
        <div className="cmp">
          <div className="cmp-name">Per-action AI agents</div>
          <div className="cmp-price">~$0.20–0.50 / enriched lead</div>
          <div className="cmp-mult">≈ 4–10× the cost</div>
          <div className="cmp-note">
            Metered per action — one verified phone can cost 15× a search.
            Generic, no local-signal moat.
          </div>
        </div>
      </div>
    </div>
  );
}
