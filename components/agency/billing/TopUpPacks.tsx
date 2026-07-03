/**
 * Top-up pack picker (prototype #view-billing lines 8251–8304).
 *
 * "The only place real money is spent" — two one-time packs (+1,000 / $50 and
 * +5,000 / $200). Each CTA POSTs `startTopUpCheckout` (one-time payment
 * checkout) when its Stripe price id is configured, else degrades to a disabled
 * "contact us" button.
 *
 * Server-presentational: the CTA is a server-action `<form>`.
 */

import { startTopUpCheckout } from "@/modules/billing/credit-checkout";
import { TOPUP_PACKS, type TopUpPack } from "@/modules/cost/pricing";

import { CoinGlyph } from "./CoinGlyph";

const nf = new Intl.NumberFormat("en-US");

export interface TopUpPacksProps {
  /** Per-pack flag: is its Stripe price id configured? */
  configured: Record<TopUpPack["key"], boolean>;
  /** Locale for the checkout return URL. */
  locale: string;
}

export function TopUpPacks({ configured, locale }: TopUpPacksProps) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="eyebrow">
        Top-up{" "}
        <span
          className="note"
          style={{
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          one-time
        </span>
      </div>
      <p className="note" style={{ marginTop: 2 }}>
        Need more before renewal? Buy extra credits in advance — added to your
        balance.
      </p>
      <div className="packrow">
        {TOPUP_PACKS.map((pack) => (
          <PackView
            key={pack.key}
            pack={pack}
            configured={configured[pack.key]}
            locale={locale}
          />
        ))}
      </div>
      <div className="note" style={{ marginTop: "auto", paddingTop: 12 }}>
        From $0.04 / credit · never expires · added to your balance. Pricier
        than plan credits — bigger plans stay the better deal. This is the only
        place real money is spent.
      </div>
    </div>
  );
}

function PackView({
  pack,
  configured,
  locale,
}: {
  pack: TopUpPack;
  configured: boolean;
  locale: string;
}) {
  return (
    <div className="pack">
      <div className="pk-credits">
        <CoinGlyph />+{nf.format(pack.credits)}
      </div>
      <div className="pk-price">${pack.priceUsd}</div>
      <div className="pk-rate">{pack.rate}</div>
      {configured ? (
        <form action={startTopUpCheckout} style={{ margin: "auto 0 0" }}>
          <input type="hidden" name="pack" value={pack.key} />
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className={
              pack.primary ? "btn primary block plan-cta" : "btn block plan-cta"
            }
          >
            Buy +{nf.format(pack.credits)}
          </button>
        </form>
      ) : (
        <button
          className="btn block plan-cta"
          disabled
          data-tip="Checkout not configured yet — contact us to buy credits."
        >
          Contact us
        </button>
      )}
    </div>
  );
}
