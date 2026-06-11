/**
 * "What changed this week" section — serif heading + the animated market-
 * changes feed on the warm band. Extracted verbatim from LandingView.tsx.
 */

import type { SmbMarketChange } from "@/modules/smb-home/types";
import type { LandingCopy } from "../../types";

import { LandingChangesFeed } from "../LandingChangesFeed";

import { CurlyArrow } from "./shared";
import { CONTAINER, EYEBROW, SERIF } from "./style-tokens";

/* --------------------------------------------------------- changes section */

export function ChangesSection({
  events,
  copy,
}: {
  events: SmbMarketChange[];
  copy: LandingCopy["changes"];
}) {
  return (
    <section
      data-landing-section="changes"
      style={{ background: "#ECE6DE", padding: "clamp(56px, 8vw, 104px) 20px" }}
    >
      <div
        className="landing-2col landing-changes-grid"
        style={{
          ...CONTAINER,
          display: "grid",
          alignItems: "center",
        }}
      >
        <div className="landing-changes-intro" style={{ maxWidth: 700 }}>
          <p style={EYEBROW}>{copy.eyebrow}</p>
          <h2
            className="landing-section-h2 landing-section-h2--changes"
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            {copy.title}{" "}
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              {copy.emphasis}
            </em>
          </h2>
          <p
            style={{
              margin: "26px 0 0",
              maxWidth: 470,
              fontSize: 18,
              lineHeight: 1.6,
              color: "var(--color-text-3)",
            }}
          >
            {copy.subtitle}
          </p>
          <div
            className="landing-changes-arrow"
            style={{
              marginTop: 28,
              justifyContent: "center",
              transform: "translateX(250px) translateY(-50px)",
            }}
          >
            <CurlyArrow />
          </div>
        </div>

        <div
          className="landing-changes-feed"
          style={{
            maskImage: "linear-gradient(to bottom, #000 82%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, #000 82%, transparent)",
          }}
        >
          <LandingChangesFeed events={events} />
        </div>
      </div>
    </section>
  );
}
