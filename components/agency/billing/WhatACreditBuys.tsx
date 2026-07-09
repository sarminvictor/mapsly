/**
 * "What a credit buys" card — reworked to the 2026-07-09 unified pricing (C1,
 * docs/billing-repricing-2026-07-09.html). Anchor: 1 credit = 1 delivered local
 * lead with verified contacts + why-qualified evidence. Going deeper costs a few
 * more credits because it costs us more. All numbers derive from the pricing
 * constants (CREDIT_MEANING / CREDIT_PRICES) — never hand-typed — so the card
 * can't drift from what the wallet actually charges.
 *
 * Server-presentational: no functions cross a `'use client'` boundary.
 */

import { CREDIT_MEANING, CREDIT_PRICES } from "@/modules/cost/pricing";

import { CoinGlyph } from "./CoinGlyph";

// Full enrichment = contacts + reviews + site speed + AI angle (1+2+2+1 = 6).
const FULL_ENRICH = CREDIT_MEANING.fullEnrichment;
// Whole-market signals = ads + rankings across the whole market (12 + 4 = 16),
// charged once per market.
const MARKET_SIGNALS = CREDIT_PRICES.meta_ads + CREDIT_PRICES.serp;
const FIRST_TOUCH_100 = CREDIT_MEANING.firstTouchPer100;

export function WhatACreditBuys() {
  // Worked example (Solo, 750 cr): 400 contacts → fully enrich best 40 →
  // ads+rankings for 1 market → 100 first-touches.
  const exContacts = 400;
  const exEnrichN = 40;
  const exEnrich = exEnrichN * (FULL_ENRICH - CREDIT_MEANING.contacts); // +5 each
  const exTotal = exContacts + exEnrich + MARKET_SIGNALS + FIRST_TOUCH_100;

  return (
    <div className="card">
      <div className="eyebrow">What a credit buys</div>
      <p className="note" style={{ marginTop: 2 }}>
        1 credit = 1 delivered lead with verified contacts. Go deeper only where
        it counts.
      </p>
      <div className="creditbuys">
        <div className="row">
          <div className="what">
            Delivered lead + contacts
            <span className="d">Email · phone · socials, verified</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />
            {CREDIT_MEANING.contacts} credit
          </div>
        </div>
        <div className="row">
          <div className="what">
            Fully enrich
            <span className="d">+ reviews, site speed, AI angle</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />
            {FULL_ENRICH} total
          </div>
        </div>
        <div className="row">
          <div className="what">
            Market signals
            <span className="d">Ads + rankings across the whole market</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />
            {MARKET_SIGNALS} · once / market
          </div>
        </div>
        <div className="row">
          <div className="what">
            First-touch messages
            <span className="d">AI drafts, ready to send · per 100</span>
          </div>
          <div className="cost">
            <CoinGlyph sm />
            {FIRST_TOUCH_100} credits
          </div>
        </div>
      </div>
      <div className="callout" style={{ marginTop: 14 }}>
        <p style={{ margin: 0 }}>
          Solo plan (750 cr): {exContacts} contacts ({exContacts}) → fully
          enrich your best {exEnrichN} ({exEnrich}) → ads + rankings for 1
          market ({MARKET_SIGNALS}) → 100 first touches ({FIRST_TOUCH_100}) ={" "}
          <b>{exTotal} credits</b>.
        </p>
      </div>
    </div>
  );
}
