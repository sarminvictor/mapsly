/**
 * Cold-email admin · campaign detail. Edit status, settings, the sequence
 * (copy + delays), and enroll cohorts. Admin-gated by the /dev layout.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import AutoRefresh from "../../../AutoRefresh";
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
        <Link href="/dev/email" style={{ fontSize: 13, color: "#5b3df5" }}>
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
