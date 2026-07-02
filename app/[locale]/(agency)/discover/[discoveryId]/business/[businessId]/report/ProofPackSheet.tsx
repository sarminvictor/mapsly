// ProofPackSheet · the shared, presentational Proof Pack body (WP5-5 + WP6-10).
//
// Extracted from the authed report page so the SAME renderer backs both:
//   1. the in-portal Proof Pack (auth + agency scope resolve the lead), and
//   2. the public agency-branded share link (/s/[token]) — "Prepared by
//      {Agency} · powered by Mapsly" — with no auth (a Report.publicShareId
//      possession-based token resolves the lead).
//
// Pure presentational component: it receives a fully-loaded LeadDetail and the
// branding bits, renders zero DB/auth. Evidence keeps the vs-cell context baked
// into the loader values, findings keep the confidence-capped exposure framing,
// and the footer carries the public-sources provenance + disclaimer
// (WP7-1/7-3 alignment).

import type {
  LeadDetail,
  LeadEvidenceRow,
} from "@/modules/agency-portal/discover/lead-detail";
import styles from "./report.module.css";

function EvidenceLine({ row }: { row: LeadEvidenceRow }) {
  return (
    <div className={styles.evrow}>
      <span className={styles.evlabel}>{row.label}</span>
      <span className={styles.evvalue}>{row.value}</span>
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

/** The Proof Pack sheet — brand bar → header → evidence → provenance footer. */
export function ProofPackSheet({
  lead,
  agencyName,
  retrievedOn,
  poweredBy = false,
}: ProofPackSheetProps) {
  const firedVerdicts = lead.signalVerdicts.filter((v) => v.matched === true);
  const enrichedDomains = lead.domains.filter(
    (d) => d.enriched && (d.summary || d.rows.length > 0),
  );

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
              <div className={styles.factk}>{f.key}</div>
              <div className={styles.factv}>{f.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why this lead qualifies */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Why this lead qualifies</h2>
        {firedVerdicts.length > 0 ? (
          <div style={{ marginBottom: 8 }}>
            {firedVerdicts.map((v) => (
              <div key={v.key} className={styles.evrow}>
                <span className={styles.evvalue}>✓ {v.title}</span>
                <span className={styles.evlabel}>{v.means}</span>
              </div>
            ))}
          </div>
        ) : null}
        {lead.firedSignals.length === 0 && firedVerdicts.length === 0 ? (
          <p className={styles.evlabel} style={{ margin: 0 }}>
            Matched on raw market qualifiers — see the data sections below.
          </p>
        ) : (
          lead.firedSignals.map((s) => (
            <div key={s.key} style={{ marginBottom: 10 }}>
              <div className={styles.evvalue}>
                {s.title}{" "}
                <span className={styles.evlabel}>
                  · confidence: {s.confidence}
                </span>
              </div>
              {s.summary ? (
                <div className={styles.evlabel}>{s.summary}</div>
              ) : null}
              {s.pitch ? <div className={styles.pitch}>{s.pitch}</div> : null}
              {s.evidence.map((ev, i) => (
                <EvidenceLine key={i} row={ev} />
              ))}
            </div>
          ))
        )}
        {lead.angles.length > 0 ? (
          <p className={styles.evlabel} style={{ margin: "6px 0 0" }}>
            Other angles: {lead.angles.map((a) => a.label).join(" · ")}
          </p>
        ) : null}
      </section>

      {/* Data domains — enriched only (a client-facing artifact shows what we
          KNOW, never internal "not enriched yet" gaps). */}
      {enrichedDomains.map((d) => (
        <section key={d.key} className={styles.section}>
          <h2 className={styles.sectionTitle}>{d.title}</h2>
          {d.rows.length > 0 ? (
            d.rows.map((r, i) => <EvidenceLine key={i} row={r} />)
          ) : (
            <p className={styles.evlabel} style={{ margin: 0 }}>
              {d.summary}
            </p>
          )}
        </section>
      ))}

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
        {lead.contactsEnriched ? (
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
          <p className={styles.evlabel} style={{ margin: 0 }}>
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
