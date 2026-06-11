/**
 * Cold-email admin · campaign detail. Edit status, settings, the sequence
 * (copy + delays), and enroll cohorts. Admin-gated by the /admin layout.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import AutoRefresh from "../../AutoRefresh";
import { getCampaign } from "../../queries";
import {
  EnrollForm,
  SettingsForm,
  StatusButtons,
  StepEditor,
} from "./CampaignControls";

export const metadata: Metadata = {
  title: "Cold campaign · Mapsly",
  robots: { index: false, follow: false },
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ece7df",
  borderRadius: 12,
  padding: 18,
  marginBottom: 18,
};
const h2: React.CSSProperties = {
  fontSize: 15,
  margin: "0 0 12px",
  fontWeight: 600,
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#999",
  padding: "6px 10px",
  borderBottom: "1px solid #ece7df",
};
const td: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderBottom: "1px solid #f4f0e9",
};

export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        color: "#2b2b2b",
      }}
    >
      <Suspense fallback={<p style={{ color: "#999" }}>Loading…</p>}>
        <Body params={params} />
      </Suspense>
      <AutoRefresh intervalMs={30000} />
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();

  return (
    <>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>{c.name}</h1>
        <Link href="/admin/email" style={{ fontSize: 13, color: "#5b3df5" }}>
          ← all campaigns
        </Link>
      </header>

      <section style={card}>
        <h2 style={h2}>Status</h2>
        <StatusButtons id={c.id} status={c.status} />
        <div
          style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {Object.entries(c.statusCounts).map(([k, v]) => (
            <span
              key={k}
              style={{
                fontSize: 12,
                background: "#f4f0e9",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {k}: {v}
            </span>
          ))}
          {Object.keys(c.statusCounts).length === 0 && (
            <span style={{ fontSize: 12, color: "#999" }}>
              no recipients yet
            </span>
          )}
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>Opens by step</h2>
        {c.openStats.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>no sends yet</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>step</th>
                  <th style={th}>sent</th>
                  <th style={th}>opens (incl. prefetch)</th>
                  <th style={th}>likely human opens</th>
                  <th style={th}>human open rate</th>
                </tr>
              </thead>
              <tbody>
                {c.openStats.map((s) => (
                  <tr key={s.stepOrder}>
                    <td style={td}>#{s.stepOrder}</td>
                    <td style={td}>{s.sent}</td>
                    <td style={td}>{s.openedRaw}</td>
                    <td style={td}>{s.openedHuman}</td>
                    <td style={td}>
                      {s.sent > 0
                        ? `${Math.round((s.openedHuman / s.sent) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "#999", margin: "10px 0 0" }}>
              Raw opens include Apple MPP / Gmail proxy prefetch (~50%
              inflation) — diagnostic upper bound only. Human = first open after
              the 5s prefetch window from a non-proxy UA (lib/bot-detect).
              Clicks + landing visits are the truth.
            </p>
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Settings</h2>
        <SettingsForm campaign={c} />
      </section>

      <section style={card}>
        <h2 style={h2}>Sequence</h2>
        <StepEditor campaignId={c.id} steps={c.steps} />
      </section>

      <section style={card}>
        <h2 style={h2}>
          Enroll cohort (US · verified email + active landing page)
        </h2>
        <EnrollForm campaignId={c.id} country={c.country} />
      </section>
    </>
  );
}
