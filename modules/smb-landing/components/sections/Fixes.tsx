/**
 * Action-plan section — the top-3 ranked fixes with impact values, on the
 * light gray band. Extracted verbatim from LandingView.tsx.
 */

import type { SmbOverviewFix } from "@/modules/smb-home/types";
import type { LandingCopy } from "../../types";

import { CtaPill, MissingNote, SectionIntro } from "./shared";
import { CARD, CONTAINER, SERIF, STAT_UNIT_16 } from "./style-tokens";

/* ----------------------------------------------------------- fixes section */

export function FixesSection({
  fixes,
  copy,
  ctaHref,
}: {
  fixes: SmbOverviewFix[];
  copy: LandingCopy["fixes"];
  ctaHref: string;
}) {
  const top = fixes.slice(0, 3);
  return (
    <section
      data-landing-section="fixes"
      style={{
        background: "#F5F5F5",
        padding: "clamp(56px, 8vw, 104px) 20px",
      }}
    >
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
        />
        {top.length > 0 ? (
          <div
            style={{
              marginTop: 40,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {top.map((f) => (
              <div
                key={f.rank}
                style={{
                  ...CARD,
                  border: "none",
                  padding: "36px 52px",
                  borderRadius: 22,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <svg
                  width={74}
                  height={48}
                  viewBox="0 0 73 48"
                  fill="none"
                  aria-hidden
                  style={{ display: "block" }}
                >
                  <path
                    d="M4.29492 18.2854L27.7949 38.9785L68.2949 4.97852"
                    stroke="#ECE6DE"
                    strokeWidth={13}
                  />
                </svg>
                <p
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    lineHeight: 1.4,
                    flex: 1,
                  }}
                >
                  {f.action}
                  {f.meta ? (
                    <span
                      style={{
                        display: "block",
                        marginTop: 6,
                        fontSize: 16,
                        fontWeight: 400,
                        color: "var(--color-text-3)",
                      }}
                    >
                      {f.meta}
                    </span>
                  ) : null}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 40,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  {f.impact} <span style={STAT_UNIT_16}>/ {f.impactSub}</span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <MissingNote>
            {
              "Once we've tracked a full week we'll line up your highest-impact fixes here, in order."
            }
          </MissingNote>
        )}
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <CtaPill href={ctaHref} cta="fixes" label="Start tracking · $29/mo" />
        </div>
      </div>
    </section>
  );
}
