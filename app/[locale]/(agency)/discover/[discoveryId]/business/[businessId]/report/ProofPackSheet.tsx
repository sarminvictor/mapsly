// ProofPackSheet · the shared, presentational Proof Pack body (WP5-5 + WP6-10).
//
// Extracted from the authed report page so the SAME renderer backs both:
//   1. the in-portal Proof Pack (auth + agency scope resolve the lead), and
//   2. the public agency-branded share link (/s/[token]) — "Prepared by
//      {Agency} · powered by Mapsly" — with no auth (a Report.publicShareId
//      possession-based token resolves the lead).
//
// v2 (2026-07-22, owner UX pass): the sheet's END READER is a local business
// owner receiving an audit — not the agency operator. Every technical row is
// translated to plain English with a one-line hint and a Good / Needs work /
// Critical chip; sections open with a one-sentence intro; the ads sections
// render honest ABSENCE with market context ("no active ads — N businesses in
// this market run them"). The LeadDrawer keeps the dense/jargon row labels —
// this translation layer is pack-only presentation.

import type {
  LeadDetail,
  LeadEvidenceRow,
} from "@/modules/agency-portal/discover/lead-detail";
import styles from "./report.module.css";

/** Pack-only translation: loader row label → plain label + one-line hint. */
const PLAIN: Record<string, { label: string; hint?: string }> = {
  // ── Site speed (Lighthouse) ──
  "Performance (mobile)": {
    label: "Overall speed score",
    hint: "Google's 0–100 score for how the site feels on a phone · 90+ good, under 50 failing",
  },
  "Performance (desktop)": {
    label: "Overall speed score (desktop)",
    hint: "Google's 0–100 score · 90+ good, under 50 failing",
  },
  LCP: {
    label: "Time until the page shows",
    hint: "How long before the main content appears · Google's bar: under 2.5s",
  },
  INP: {
    label: "Tap response",
    hint: "Delay after a visitor taps something · good: under 0.2s",
  },
  TBT: {
    label: "Page freeze while loading",
    hint: "How long the page ignores taps during load · good: under 0.2s",
  },
  CLS: {
    label: "Content jumping around",
    hint: "How much the layout shifts while loading · good: under 0.1",
  },
  FCP: {
    label: "First thing on screen",
    hint: "When anything first appears · good: under 1.8s",
  },
  Accessibility: {
    label: "Accessibility score",
    hint: "How usable the site is for every visitor · 90+ is good",
  },
  SEO: {
    label: "On-page SEO score",
    hint: "How search-ready the page itself is · 90+ is good",
  },
  "Best practices": {
    label: "Code health",
    hint: "Security and modern-web checks",
  },
  "Crawlable (no-JS)": {
    label: "Google can read the site",
  },
  "Potential savings": {
    label: "Speed still on the table",
    hint: "Load time recoverable with standard fixes",
  },
  // ── Reviews ──
  "Reply rate": {
    label: "Owner replies to reviews",
    hint: "Share of recent reviews with an owner response — customers notice silence",
  },
  "Lifecycle (90d)": {
    label: "Review momentum (90 days)",
    hint: "Whether new reviews are picking up or drying up",
  },
  "1–3★ unanswered": {
    label: "Negative reviews with no reply",
    hint: "Unhappy customers left without a response",
  },
  // ── Search ──
  "Local 3-pack rank": {
    label: "Google Maps top-3",
    hint: "The three businesses Google shows on the map first — where most calls go",
  },
  "The pack": { label: "Who holds those spots" },
  "Organic rank": {
    label: "Google search position",
    hint: "Position in the regular results for the main local search",
  },
  // ── Website & tech ──
  "Built on": { label: "Website platform" },
  Stack: { label: "Tools detected on the site" },
  "Tracking pixel": {
    label: "Ad tracking installed",
    hint: "Needed to know whether ad money actually converts",
  },
  Analytics: {
    label: "Visitor analytics",
    hint: "Whether anyone can see how many people visit",
  },
  "Live chat": { label: "Live chat" },
  "Online booking": {
    label: "Online booking",
    hint: "Can a customer book without calling?",
  },
  // ── Ads ──
  "Active Meta ads": { label: "Facebook / Instagram ads" },
  "Active Google ads": { label: "Google ads" },
  Formats: { label: "Ad formats" },
  "Spend band": { label: "Estimated ad spend" },
  Advertiser: { label: "Advertising as" },
};

/** One-sentence section intros, by domain key. */
const SECTION_INTRO: Record<string, string> = {
  reviews: "What customers see on Google — and whether the owner engages.",
  tech: "The website's platform and the marketing tools installed on it.",
  speed:
    "Measured on a real phone connection with Google Lighthouse — slow pages lose visitors before they load.",
  meta_ads: "Paid ads in Facebook's public Ad Library.",
  google_ads: "Paid search ads in Google's public transparency data.",
  serp: "Where this business shows up when locals search for this service.",
  ai: "Analyst brief from public sources.",
};

/** Fact-key translation for the At-a-glance grid. */
const FACT_PLAIN: Record<string, string> = {
  Photos: "Photos on profile",
  Claimed: "Google profile claimed",
  "Built on": "Website platform",
  "Years on Google": "Years on Google",
};

function Chip({ tone }: { tone: "g" | "a" | "r" | null | undefined }) {
  if (!tone) return null;
  const text = tone === "g" ? "Good" : tone === "a" ? "Needs work" : "Critical";
  const cls =
    tone === "g" ? styles.chipG : tone === "a" ? styles.chipA : styles.chipR;
  return <span className={`${styles.chip} ${cls}`}>{text}</span>;
}

/** A review quote row renders full-width and quoted, not as a metric line. */
function isQuoteRow(row: LeadEvidenceRow): boolean {
  return /^[“"']/.test(row.value.trim());
}

function EvidenceLine({ row }: { row: LeadEvidenceRow }) {
  if (isQuoteRow(row)) {
    return (
      <div className={styles.quoterow}>
        <div className={styles.quotemeta}>{row.label}</div>
        <div className={styles.quotetext}>{row.value}</div>
      </div>
    );
  }
  const plain = PLAIN[row.label];
  // A few VALUES need translation too ("Off the pack" is 3-pack jargon).
  const value =
    row.label === "Local 3-pack rank" && row.value === "Off the pack"
      ? "Not shown"
      : row.value;
  return (
    <div className={styles.evrow}>
      <span className={styles.evlabelwrap}>
        <span className={styles.evlabel}>{plain?.label ?? row.label}</span>
        {plain?.hint ? (
          <span className={styles.evhint}>{plain.hint}</span>
        ) : null}
      </span>
      <span className={styles.evright}>
        <span className={styles.evvalue}>{value}</span>
        <Chip tone={row.tone} />
      </span>
    </div>
  );
}

export interface ProofPackSheetProps {
  lead: LeadDetail;
  /** Agency name for the "Prepared by {Agency}" brand bar. */
  agencyName: string;
  /** Localized "retrieved on" date string (rendered by the caller). */
  retrievedOn: string;
  /**
   * WP6-10 · when true, the brand bar adds a "powered by Mapsly" line — the
   * viral tell on a shared audit link. The in-portal Proof Pack omits it.
   */
  poweredBy?: boolean;
}

/** The Proof Pack sheet — brand bar → header → findings → data → footer. */
export function ProofPackSheet({
  lead,
  agencyName,
  retrievedOn,
  poweredBy = false,
}: ProofPackSheetProps) {
  const firedVerdicts = lead.signalVerdicts.filter((v) => v.matched === true);
  // Enriched-only by STATE (truth unification): this sheet also renders on the
  // PUBLIC share page (/s/[token]) — internal empty/failed/running states must
  // never leak into a client-facing artifact.
  const enrichedDomains = lead.domains.filter(
    (d) => d.state === "enriched" && (d.summary || d.rows.length > 0),
  );
  // v2 · ads ABSENCE is client-facing insight, not an internal gap: a scanned
  // cell with zero ads for this business renders honestly, with the market
  // context ("N businesses in this market are advertising — this one isn't").
  const emptyAds = lead.domains.filter(
    (d) =>
      (d.key === "meta_ads" || d.key === "google_ads") && d.state === "empty",
  );
  const marketCountFor = (key: string): number | null =>
    key === "meta_ads"
      ? lead.marketAds.metaAdvertisers
      : lead.marketAds.googleAdvertisers;

  return (
    <div className={styles.sheet}>
      {/* Branded header */}
      <div className={styles.brandbar}>
        <span className={styles.brand}>Prepared by {agencyName}</span>
        <span className={styles.brandsub}>
          {poweredBy ? (
            <>Prospect audit · {retrievedOn} · powered by Mapsly</>
          ) : (
            <>Prospect audit · {retrievedOn}</>
          )}
        </span>
      </div>

      <h1 className={styles.h1}>{lead.name}</h1>
      <p className={styles.meta}>
        {[
          lead.category,
          lead.addressLine !== "—" ? lead.addressLine : null,
          lead.rating != null
            ? `${lead.rating.toFixed(1)}★${lead.reviewCount != null ? ` (${lead.reviewCount.toLocaleString()} reviews)` : ""}`
            : null,
          lead.openStatus !== "—" ? lead.openStatus : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {/* At a glance */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>At a glance</h2>
        <div className={styles.factgrid}>
          {lead.facts.map((f) => (
            <div key={f.key}>
              <div className={styles.factk}>{FACT_PLAIN[f.key] ?? f.key}</div>
              <div className={styles.factv}>{f.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Key findings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Key findings</h2>
        <p className={styles.sectionIntro}>
          Where this business is losing customers today — each one is fixable.
        </p>
        {firedVerdicts.length > 0 ? (
          <div style={{ marginBottom: 8 }}>
            {firedVerdicts.map((v) => (
              <div key={v.key} className={styles.findingrow}>
                <span className={styles.findingtitle}>✓ {v.title}</span>
                <span className={styles.findingmeans}>{v.means}</span>
              </div>
            ))}
          </div>
        ) : null}
        {lead.firedSignals.length === 0 && firedVerdicts.length === 0 ? (
          <p className={styles.evhint} style={{ margin: 0 }}>
            Matched on market-level qualifiers — see the sections below.
          </p>
        ) : (
          lead.firedSignals.map((s) => (
            <div key={s.key} style={{ marginBottom: 10 }}>
              <div className={styles.findingtitle}>{s.title}</div>
              {s.summary ? (
                <div className={styles.findingmeans}>{s.summary}</div>
              ) : null}
              {s.pitch ? <div className={styles.pitch}>{s.pitch}</div> : null}
              {s.evidence.map((ev, i) => (
                <EvidenceLine key={i} row={ev} />
              ))}
            </div>
          ))
        )}
      </section>

      {/* Data domains — enriched only */}
      {enrichedDomains.map((d) => (
        <section key={d.key} className={styles.section}>
          <h2 className={styles.sectionTitle}>{d.title}</h2>
          {SECTION_INTRO[d.key] ? (
            <p className={styles.sectionIntro}>{SECTION_INTRO[d.key]}</p>
          ) : null}
          {d.rows.length > 0 ? (
            d.rows.map((r, i) => <EvidenceLine key={i} row={r} />)
          ) : (
            <p className={styles.evhint} style={{ margin: 0 }}>
              {d.summary}
            </p>
          )}
        </section>
      ))}

      {/* Ads absence — scanned, zero found, with market pressure context. */}
      {emptyAds.map((d) => {
        const marketN = marketCountFor(d.key);
        return (
          <section key={d.key} className={styles.section}>
            <h2 className={styles.sectionTitle}>{d.title}</h2>
            {SECTION_INTRO[d.key] ? (
              <p className={styles.sectionIntro}>{SECTION_INTRO[d.key]}</p>
            ) : null}
            <div className={styles.evrow}>
              <span className={styles.evlabelwrap}>
                <span className={styles.evlabel}>
                  {d.key === "meta_ads"
                    ? "Facebook / Instagram ads"
                    : "Google ads"}
                </span>
                {marketN != null && marketN > 0 ? (
                  <span className={styles.evhint}>
                    {marketN} business{marketN === 1 ? "" : "es"} in this market{" "}
                    {marketN === 1 ? "is" : "are"} advertising right now — this
                    one isn&apos;t.
                  </span>
                ) : null}
              </span>
              <span className={styles.evright}>
                <span className={styles.evvalue}>None found</span>
                {marketN != null && marketN > 0 ? <Chip tone="a" /> : null}
              </span>
            </div>
          </section>
        );
      })}

      {/* Expert findings — exposure-framed, confidence-capped phrasing. */}
      {lead.expertFindings.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Worth checking</h2>
          {lead.expertFindings.map((f) => (
            <div key={f.key} className={styles.finding}>
              <b>{f.title}:</b> {f.body}
            </div>
          ))}
        </section>
      ) : null}

      {/* Contacts */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Contacts</h2>
        {lead.contactsState === "enriched" ? (
          <div className={styles.factgrid}>
            <div>
              <div className={styles.factk}>Phone</div>
              <div className={styles.factv}>
                {lead.phones.map((c) => c.value).join(" · ") || "—"}
              </div>
            </div>
            <div>
              <div className={styles.factk}>Email</div>
              <div className={styles.factv}>
                {lead.emails.map((c) => c.value).join(" · ") || "—"}
              </div>
            </div>
            <div>
              <div className={styles.factk}>Website</div>
              <div className={styles.factv}>{lead.website ?? "—"}</div>
            </div>
          </div>
        ) : (
          <p className={styles.evhint} style={{ margin: 0 }}>
            Contacts not collected for this business yet.
          </p>
        )}
      </section>

      {/* Provenance footer + disclaimer */}
      <div className={styles.footer}>
        Data via public sources (Google Maps &amp; reviews, public websites, ad
        libraries, search results) · retrieved {retrievedOn} · prepared with
        Mapsly. Signals are indicators from public data, not guarantees — verify
        anything you plan to rely on before presenting it as fact.
      </div>
    </div>
  );
}
