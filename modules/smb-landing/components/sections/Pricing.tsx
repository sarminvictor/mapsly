/**
 * Pricing band — coral $29 section with the value props and the white
 * Mapsly Pro card (monthly + annual CTAs). Extracted verbatim from
 * LandingView.tsx.
 *
 * Below the paid CTAs sits the SECONDARY free option (plan #7): the
 * weekly-score email signup (FreeWeeklyCta · client leaf), keyed by the
 * landing token so the server action can attribute the signup.
 */

import type { LandingCopy } from "../../types";

import { FreeWeeklyCta } from "../FreeWeeklyCta";

import { CtaPill, CurlyArrow } from "./shared";
import { BODY, CONTAINER, SERIF, STAT_UNIT_16 } from "./style-tokens";

export function PricingSection({
  copy,
  ctaHref,
  ctaHrefAnnual,
  token,
}: {
  copy: LandingCopy["pricing"];
  ctaHref: string;
  ctaHrefAnnual: string;
  token: string;
}) {
  const props = [
    "Catch new competitor ads within 24h",
    "AI-draft a reply to every new review",
    "Weekly digest of every market move",
    "Spot ranking drops before they cost bookings",
  ];
  return (
    <section
      data-landing-section="pricing"
      style={{
        background: "var(--color-coral)",
      }}
    >
      <div
        className="landing-2col landing-pricing-grid"
        style={{
          ...CONTAINER,
          display: "grid",
          alignItems: "center",
        }}
      >
        <div>
          <h2
            className="landing-section-h2 landing-section-h2--pricing"
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              color: "#fff",
            }}
          >
            {copy.titleLead}{" "}
            <em style={{ fontStyle: "italic", color: "#ECE6DE" }}>
              {copy.emphasis}
            </em>
          </h2>
          <p
            style={{
              margin: "22px 0 0",
              maxWidth: 560,
              fontSize: 18,
              lineHeight: 1.6,
              color: "#DCB2B0",
            }}
          >
            {copy.body}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px 28px",
              marginTop: 30,
              maxWidth: 560,
            }}
          >
            {props.map((p) => (
              <span
                key={p}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  color: "rgba(255,255,255,0.95)",
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                <svg
                  width="13"
                  height="10"
                  viewBox="0 0 13 10"
                  fill="none"
                  aria-hidden
                  style={{ flexShrink: 0, marginTop: 7 }}
                >
                  <path
                    d="M0.736328 3.71777L4.40299 7.71777L11.623 0.717773"
                    stroke="#ECE6DE"
                    strokeWidth="2"
                  />
                </svg>
                {p}
              </span>
            ))}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              left: -200,
              bottom: 40,
            }}
            className="landing-pricing-arrow"
          >
            <CurlyArrow color="#ECE6DE" />
          </div>
          <div
            className="landing-pricing-card"
            style={{
              background: "#fff",
              borderRadius: 28,
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: BODY,
                fontSize: 15,
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              Get more customers!
            </p>
            <p
              style={{
                margin: "14px 0 0",
                fontFamily: SERIF,
                fontSize: 60,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              Mapsly Pro
            </p>
            <p
              style={{
                margin: "30px 0 0",
                fontSize: 13,
                color: "var(--color-text-3)",
              }}
            >
              from
            </p>
            <p
              style={{
                margin: "2px 0 22px",
                fontFamily: SERIF,
                fontSize: 80,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              $29
              <span style={STAT_UNIT_16}> / mo</span>
            </p>
            <div
              style={{
                display: "grid",
                gap: 12,
                maxWidth: 300,
                marginInline: "auto",
              }}
            >
              <span style={{ display: "grid" }}>
                <CtaPill
                  href={ctaHref}
                  cta="pricing"
                  label="See what to fix - $29/mo"
                  height={60}
                />
              </span>
              <span style={{ display: "grid" }}>
                <CtaPill
                  href={ctaHrefAnnual}
                  cta="pricing-annual"
                  label="Pay annually - Save $100"
                  variant="outline"
                  height={60}
                />
              </span>
            </div>
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 12,
                color: "var(--color-text-3)",
                lineHeight: 1.5,
              }}
            >
              {copy.guarantee}
            </p>
            <FreeWeeklyCta token={token} />
          </div>
        </div>
      </div>
    </section>
  );
}
