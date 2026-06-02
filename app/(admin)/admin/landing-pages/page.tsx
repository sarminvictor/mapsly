/**
 * /admin/landing-pages · the personalized-landing conversion funnel.
 *
 * Top: the funnel (unique visitors at each step, with step-to-step + overall
 * conversion %). Middle: mint a landing for a business id. Bottom: every
 * landing with its open count + conversions + revoke control.
 *
 * Sync export + Suspense'd async body marked dynamic via `connection()` so the
 * fresh DB reads never run at build (Pattern 2). Admin-gated by the (admin)
 * route group.
 */

import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import { MintLandingForm } from "./components/MintLandingForm";
import { ToggleLandingButton } from "./components/ToggleLandingButton";
import {
  getLandingFunnel,
  getLandingPagesList,
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
  const steps = [
    { label: "Opened", value: funnel.opened },
    { label: "Scrolled past hero", value: funnel.engaged },
    { label: "Reached $29 offer", value: funnel.reachedPricing },
    { label: "Clicked CTA", value: funnel.clickedCta },
    { label: "Opened checkout", value: funnel.checkoutOpened },
    { label: "Subscribed", value: funnel.subscribed },
  ];
  const top = Math.max(1, funnel.opened);
  const overall =
    funnel.opened > 0
      ? ((funnel.subscribed / funnel.opened) * 100).toFixed(1)
      : "0.0";

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
        <h2 style={sectionTitle}>Conversion funnel</h2>
        <span style={{ fontSize: 13, color: "#6b7280" }}>
          {funnel.totalOpens} total opens · {funnel.botOpens} bot · overall{" "}
          <strong style={{ color: "#15803d" }}>{overall}%</strong> open→sub
        </span>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {steps.map((s, i) => {
          const prev = i === 0 ? null : steps[i - 1].value;
          const stepPct =
            prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
          const width = `${Math.max(2, (s.value / top) * 100)}%`;
          return (
            <div
              key={s.label}
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
                <div
                  style={{
                    width,
                    height: "100%",
                    background: i === steps.length - 1 ? "#15803d" : "#5b3df5",
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
                    color: s.value / top > 0.12 ? "#fff" : "#374151",
                  }}
                >
                  {s.value}
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
