/**
 * WelcomeHero · the editorial hero surface of the agency welcome screen.
 *
 * Prototype `#view-welcome` hero (docs/portal-prototype.html lines 6760-6877):
 * an `.editorial` gradient card containing the 2-col `.hero` grid.
 *   LEFT  (`.hero-copy`) · personalized eyebrow, the 38px display h1 with the
 *         `.hl` highlight, the `.sub` paragraph, the animated <HeroStats/>, then
 *         the single yellow `.btn.punch.big` CTA → /discover + the free-credits
 *         note (`.cr` + `.ic-coin`).
 *   RIGHT (`.peek`) · the static <PeekMock/> (aria-hidden).
 *
 * Server component. The CTA routes into the discovery flow (`/discover`) — the
 * prototype's `data-go="goal"` target — via next-intl `Link`. Real data
 * (agencyName, credits) arrives as plain props; HeroStats is the only client
 * child and receives plain numbers/strings (cache-components Pattern 4).
 *
 * The three hero stats are wired to their real sources so they can't drift:
 *   - metros  → US_METROS.length (US + Canada gazetteer), resolved server-side
 *     in welcome/page.tsx and passed as `metrosCount`
 *   - signals → SIGNAL_COUNT (the live registry size), passed as `signalsCount`
 *   - businesses → INDEXED_BUSINESSES (curated marketing catalog figure)
 * Each arrives as a PLAIN NUMBER (cache-components Pattern 4 — no function props
 * cross the boundary into the HeroStats client child) with a fallback literal so
 * the component never breaks if a prop is omitted.
 *
 * Copy is English-only for now.
 */

import { Link } from "@/i18n/navigation";
import { INDEXED_BUSINESSES } from "@/lib/marketing/catalog-facts";
import { HeroStats } from "./HeroStats";
import { PeekMock } from "./PeekMock";

interface WelcomeHeroProps {
  agencyName: string;
  credits: number;
  /** Gazetteer size (US + Canada metros). Falls back to the prior literal. */
  metrosCount?: number;
  /** Live signal-registry size. Falls back to the prior literal. */
  signalsCount?: number;
  /** Curated marketing catalog size. Falls back to INDEXED_BUSINESSES. */
  businessesCount?: number;
}

export function WelcomeHero({
  agencyName,
  credits,
  metrosCount = 150,
  signalsCount = 50,
  businessesCount = INDEXED_BUSINESSES,
}: WelcomeHeroProps) {
  return (
    <div className="editorial section">
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Welcome back, {agencyName}</div>
          <h1 style={{ fontSize: 38, maxWidth: "16ch" }}>
            Find the local businesses that{" "}
            <span className="hl">need what you sell</span> — with the reason.
          </h1>
          <p className="sub" style={{ fontSize: 15.5, maxWidth: "46ch" }}>
            Mapsly maps every <b>local business on Google</b> in a city — the
            med spas, dentists, HVAC shops — and tells you{" "}
            <b>which ones have the problem you fix, and why</b>, in plain
            English. Not a contact database — a shortlist with reasons.
          </p>

          <HeroStats
            stats={[
              {
                to: metrosCount,
                fmt: "plain",
                suffix: "",
                label: "US & Canada metros ready to search",
              },
              {
                to: businessesCount,
                fmt: "compact",
                suffix: "",
                label: "local businesses mapped on Google",
              },
              {
                to: signalsCount,
                fmt: "plain",
                suffix: "+",
                color: "var(--indigo)",
                label: "expert signals competitors can't see",
              },
            ]}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link href="/discover" className="btn punch big">
              Find my first leads →
            </Link>
            <span className="note">
              Free plan ·{" "}
              <span className="cr">
                <span className="ic-coin sm" aria-hidden="true" />
                {credits.toLocaleString("en-US")} credits
              </span>{" "}
              included · no card needed
            </span>
          </div>
        </div>

        <PeekMock />
      </div>
    </div>
  );
}
