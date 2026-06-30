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
 * Copy is English-only for now.
 */

import { Link } from "@/i18n/navigation";
import { HeroStats } from "./HeroStats";
import { PeekMock } from "./PeekMock";

interface WelcomeHeroProps {
  agencyName: string;
  credits: number;
}

export function WelcomeHero({ agencyName, credits }: WelcomeHeroProps) {
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
                to: 150,
                fmt: "plain",
                suffix: "",
                label: "US metros ready to search",
              },
              {
                to: 2_100_000,
                fmt: "compact",
                suffix: "",
                label: "local businesses mapped on Google",
              },
              {
                to: 50,
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
