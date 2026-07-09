/**
 * Top-up pack picker (prototype #view-billing lines 8251–8304).
 *
 * Two one-time packs (+1,000 / $70 and +5,000 / $275). Each CTA POSTs
 * `startTopUpCheckout` (one-time payment checkout) when its Stripe price id is
 * configured AND the agency is on a paid plan, else degrades to a disabled
 * button with an explanatory tip.
 *
 * Top-ups are the mid-cycle pressure valve, repriced 2026-07-09 to sit above
 * plan rates and gated to paid subscriptions (review Part F · top-up inversion).
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
  /** True when the agency is on an active paid plan — top-ups are paid-only. */
  available: boolean;
}

export function TopUpPacks({ configured, locale, available }: TopUpPacksProps) {
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
            available={available}
            locale={locale}
          />
        ))}
      </div>
      <div className="note" style={{ marginTop: "auto", paddingTop: 12 }}>
        From $0.055 / credit · never expires · added to your balance. Priced
        above plan credits and available on paid plans — bigger plans stay the
        better deal.
      </div>
    </div>
  );
}

function PackView({
  pack,
  configured,
  available,
  locale,
}: {
  pack: TopUpPack;
  configured: boolean;
  available: boolean;
  locale: string;
}) {
  const canBuy = configured && available;
  const disabledTip = !available
    ? "Top-ups are available on a paid plan — choose a plan above first."
    : "Top-up checkout is being set up — available shortly.";
  // When the button is disabled it leaves the tab order and suppresses pointer
  // events, so the tip can't live on it — put it on the always-hoverable wrapper.
  return (
    <div className="pack" data-tip={canBuy ? undefined : disabledTip}>
      <div className="pk-credits">
        <CoinGlyph />+{nf.format(pack.credits)}
      </div>
      <div className="pk-price">${pack.priceUsd}</div>
      <div className="pk-rate">{pack.rate}</div>
      {canBuy ? (
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
        <button className="btn block plan-cta" disabled>
          Buy +{nf.format(pack.credits)}
        </button>
      )}
    </div>
  );
}
