/**
 * "What a credit buys" card (prototype #view-billing lines 8199–8249).
 *
 * Four rows — Discovery (free) · Lead with contacts (1) · Full enrichment (3) ·
 * First-touch per 100 (10) — plus a 💡 worked-example callout. Server-
 * presentational; copy verbatim from the prototype.
 */

import { CoinGlyph } from "./CoinGlyph";

export function WhatACreditBuys() {
  return (
    <div className="card">
      <div className="eyebrow">What a credit buys</div>
      <p className="note" style={{ marginTop: 2 }}>
        Contacts on every lead. Go deeper only where it counts.
      </p>
      <div className="creditbuys">
        <div className="row">
          <div className="what">
            Discovery
            <span className="d">Map a market, see every business</span>
          </div>
          <div className="cost free">Free · unlimited</div>
        </div>
        <div className="row">
          <div className="what">
            Lead with contacts
            <span className="d">Email · phone · socials, verified</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />1 credit
          </div>
        </div>
        <div className="row">
          <div className="what">
            Full enrichment
            <span className="d">+ reviews, ads, SERP, AI, compliance</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />3 credits
          </div>
        </div>
        <div className="row">
          <div className="what">
            First-touch messages
            <span className="d">AI drafts, ready to send · per 100</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />
            10 credits
          </div>
        </div>
      </div>
      <div className="callout" style={{ marginTop: 14 }}>
        <span aria-hidden="true">💡</span>
        <p style={{ margin: 0 }}>
          Map <i>Med spas · Miami</i> (free) → contacts on 200 leads (200) →
          fully enrich your best 40 (120) → 100 first touches (10) ={" "}
          <b>330 credits</b>.
        </p>
      </div>
    </div>
  );
}
