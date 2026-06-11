/**
 * /admin/landing-pages · the personalized-landing conversion funnel.
 *
 * Top: the funnel — RAW and HUMAN-ONLY unique visitors side by side per step
 * (plan #17: scanners GET every emailed link, so raw alone lies), then the
 * three funnel gates from lib/funnel-thresholds with pass/fail + the
 * fix-layer hint. Middle: mint a landing. Bottom: every landing with its
 * open count + conversions + revoke control.
 *
 * Sync export + Suspense'd async body marked dynamic via `connection()` so the
 * fresh DB reads never run at build (Pattern 2). Admin-gated by the (admin)
 * route group.
 */

import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import {
  FALLBACK_PLAN,
  VERDICT_MAX_SENDS,
  VERDICT_MIN_SENDS,
} from "@/lib/funnel-thresholds";

import { MintLandingForm } from "./components/MintLandingForm";
import { ToggleLandingButton } from "./components/ToggleLandingButton";
import {
  getFunnelGates,
  getLandingFunnel,
  getLandingPagesList,
  type FunnelGateView,
  type LandingFunnel,
} from "./queries";

export const metadata = { title: "Landing pages · Mapsly admin" };

export default function AdminLandingPagesPage() {
  return (
    <Suspense
      fallback={<p style={{ padding: 24, color: "#6b7280" }}>Loading…</p>}
    >
      <Body />
    </Suspense>
  );
}

async function Body() {
  await connection();
  const [funnel, landings] = await Promise.all([
    getLandingFunnel(),
    getLandingPagesList(),
  ]);
  const gates = await getFunnelGates(funnel);

  return (
    <div style={{ padding: "28px 28px 64px", maxWidth: 1080 }}>
      <header style={{ marginBottom: 8 }}>
        <h1
          style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}
        >
          Landing pages
        </h1>
        <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
          Personalized proposal pages (/l/…) we email to qualified businesses —
          and how raw opens convert into $29/mo subscribers.
        </p>
      </header>

      <FunnelCard funnel={funnel} />
      <GatesCard gates={gates} />

      <section style={cardSection}>
        <h2 style={sectionTitle}>Mint a landing</h2>
        <p style={{ margin: "0 0 14px", color: "#6b7280", fontSize: 13 }}>
          Paste a business id from{" "}
          <Link href="/admin/businesses" style={{ color: "#5b3df5" }}>
            /admin/businesses
          </Link>
          . One landing per business — re-running returns the existing link.
        </p>
        <MintLandingForm />
      </section>

      <section style={cardSection}>
        <h2 style={sectionTitle}>All landings · {landings.length}</h2>
        {landings.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14, margin: "8px 0 0" }}>
            None yet — mint one above.
          </p>
        ) : (
          <table
            className="admin-table"
            style={{ width: "100%", marginTop: 8 }}
          >
            <thead>
              <tr>
                <th style={th}>Business</th>
                <th style={th}>Link</th>
                <th style={{ ...th, textAlign: "right" }}>Opens</th>
                <th style={{ ...th, textAlign: "right" }}>Subs</th>
                <th style={{ ...th, textAlign: "center" }}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {landings.map((l) => {
                const path = `/l/${l.slug}-${l.token}`;
                return (
                  <tr key={l.id}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{l.businessName}</span>
                      {l.businessCity ? (
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>
                          {" "}
                          · {l.businessCity}
                        </span>
                      ) : null}
                    </td>
                    <td style={td}>
                      <a
                        href={path}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#5b3df5",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                      >
                        {path} ↗
                      </a>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{l.viewCount}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: l.conversions > 0 ? 700 : 400,
                        color: l.conversions > 0 ? "#15803d" : "#111827",
                      }}
                    >
                      {l.conversions}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: l.isActive ? "#dcfce7" : "#fee2e2",
                          color: l.isActive ? "#15803d" : "#b91c1c",
                        }}
                      >
                        {l.isActive ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <ToggleLandingButton
                        landingPageId={l.id}
                        active={l.isActive}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FunnelCard({ funnel }: { funnel: LandingFunnel }) {
  const top = Math.max(
    1,
    funnel.steps[0]?.human ?? 0,
    funnel.steps[0]?.raw ?? 0,
  );
  const opened = funnel.steps[0]?.human ?? 0;
  const paid = funnel.paid;
  const overall = opened > 0 ? ((paid / opened) * 100).toFixed(1) : "0.0";
  const reasons = Object.entries(funnel.botReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  return (
    <section style={cardSection}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h2 style={sectionTitle}>Conversion funnel · human vs raw</h2>
        <span style={{ fontSize: 13, color: "#6b7280" }}>
          {funnel.sessions} sessions · {funnel.nonHumanSessions} non-human
          {reasons ? ` (${reasons})` : ""} · overall{" "}
          <strong style={{ color: "#15803d" }}>{overall}%</strong> human
          open→sub
        </span>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {funnel.steps.map((s, i) => {
          const prev = i === 0 ? null : funnel.steps[i - 1].human;
          const stepPct =
            prev && prev > 0 ? Math.round((s.human / prev) * 100) : null;
          const humanWidth = `${Math.max(2, (s.human / top) * 100)}%`;
          const rawWidth = `${Math.max(2, (s.raw / top) * 100)}%`;
          return (
            <div
              key={s.id}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <span
                style={{
                  width: 150,
                  fontSize: 13,
                  color: "#374151",
                  flexShrink: 0,
                }}
              >
                {s.label}
              </span>
              <div
                style={{
                  flex: 1,
                  background: "#eef0f6",
                  borderRadius: 6,
                  height: 26,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Raw (bots included) — pale ghost behind the human bar. */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: rawWidth,
                    background: "#d7d3f8",
                    borderRadius: 6,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: humanWidth,
                    background:
                      i === funnel.steps.length - 1 ? "#15803d" : "#5b3df5",
                    borderRadius: 6,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 10,
                    top: 4,
                    fontSize: 13,
                    fontWeight: 600,
                    color: s.human / top > 0.12 ? "#fff" : "#374151",
                  }}
                >
                  {s.human}
                  <span style={{ fontWeight: 400, opacity: 0.75 }}>
                    {" "}
                    · raw {s.raw}
                  </span>
                </span>
              </div>
              <span
                style={{
                  width: 56,
                  textAlign: "right",
                  fontSize: 12,
                  color: "#9ca3af",
                  flexShrink: 0,
                }}
              >
                {stepPct != null ? `${stepPct}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "#9ca3af" }}>
        Human = PAGE_OPENED + ≥1 SECTION_VIEWED from a non-scanner UA
        (lib/bot-detect). Bars + step % are human-only; raw includes scanners
        and proxies. Section depth (human): past hero{" "}
        {funnel.sectionDepth.pastHero} · reached pricing{" "}
        {funnel.sectionDepth.reachedPricing}.
      </p>
    </section>
  );
}

function GatesCard({ gates }: { gates: FunnelGateView }) {
  const pct = (r: number | null) =>
    r == null ? "—" : `${(r * 100).toFixed(r < 0.02 ? 2 : 1)}%`;

  return (
    <section style={cardSection}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h2 style={sectionTitle}>Funnel gates · human-only</h2>
        <span style={{ fontSize: 13, color: "#6b7280" }}>
          {gates.delivered} delivered · {gates.totalSent} sent · verdict window{" "}
          {VERDICT_MIN_SENDS}–{VERDICT_MAX_SENDS} sends
        </span>
      </div>
      <table className="admin-table" style={{ width: "100%", marginTop: 10 }}>
        <thead>
          <tr>
            <th style={th}>Gate</th>
            <th style={{ ...th, textAlign: "right" }}>Observed</th>
            <th style={{ ...th, textAlign: "right" }}>Target</th>
            <th style={{ ...th, textAlign: "center" }}>Status</th>
            <th style={th}>Fix layer</th>
          </tr>
        </thead>
        <tbody>
          {gates.results.map(({ gate, rate, pass }) => (
            <tr key={gate.id}>
              <td style={td}>
                <span style={{ fontWeight: 600 }}>{gate.label}</span>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                  {gate.numerator} / {gate.denominator}
                </div>
              </td>
              <td
                style={{
                  ...td,
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color:
                    pass == null ? "#9ca3af" : pass ? "#15803d" : "#b91c1c",
                }}
              >
                {pct(rate)}
              </td>
              <td
                style={{
                  ...td,
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: "#6b7280",
                }}
              >
                ≥ {pct(gate.minRate)}
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background:
                      pass == null ? "#f3f4f6" : pass ? "#dcfce7" : "#fee2e2",
                    color:
                      pass == null ? "#6b7280" : pass ? "#15803d" : "#b91c1c",
                  }}
                >
                  {pass == null ? "No data" : pass ? "Pass" : "Fail"}
                </span>
              </td>
              <td style={{ ...td, maxWidth: 360 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "#5b3df5",
                  }}
                >
                  {gate.fixLayer}
                </span>
                {pass === false ? (
                  <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>
                    {gate.fixHint}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {gates.verdict === "fallback" ? (
        <p
          style={{
            margin: "14px 0 0",
            padding: "10px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          Verdict window reached with failing gates ({gates.totalSent} ≥{" "}
          {VERDICT_MIN_SENDS} sends). {FALLBACK_PLAN}
        </p>
      ) : null}
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "#9ca3af" }}>
        All rates computed on human-classified traffic. Email opens never enter
        a gate — Apple MPP / image proxies inflate them ~50% (see /admin/email).
      </p>
    </section>
  );
}

const cardSection: React.CSSProperties = {
  marginTop: 20,
  padding: 20,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
};
const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
};
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#9ca3af",
  borderBottom: "1px solid #e5e7eb",
};
const td: React.CSSProperties = {
  padding: "10px",
  fontSize: 13,
  color: "#111827",
  borderBottom: "1px solid #f1f3f9",
};
