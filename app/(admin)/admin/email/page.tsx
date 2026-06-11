/**
 * Cold-email admin · overview (/admin/email). Admin-gated by the /admin layout.
 * Sync export + Suspense'd async body (cache-components Pattern 2).
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import AutoRefresh from "./AutoRefresh";
import {
  CreateDefaultButton,
  MailboxControls,
  MarkRepliedForm,
  PauseToggle,
  RemoveSuppressionButton,
  SeedTestForm,
  SuppressionForm,
  SyncMailboxesButton,
} from "./EmailControls";
import { getCampaigns, getColdOverview, getSuppressions } from "./queries";

export const metadata: Metadata = {
  title: "Cold email · Mapsly",
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

export default function ColdEmailAdminPage() {
  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        color: "#2b2b2b",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Cold Email · control panel</h1>
        <Link href="/admin" style={{ fontSize: 13, color: "#5b3df5" }}>
          ← admin home
        </Link>
      </header>
      <Suspense fallback={<p style={{ color: "#999" }}>Loading…</p>}>
        <Overview />
      </Suspense>
      <AutoRefresh intervalMs={30000} />
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#999" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: warn ? "#c3553a" : "#2b2b2b",
        }}
      >
        {value}
      </div>
    </div>
  );
}

async function Overview() {
  const [overview, campaigns, suppressions] = await Promise.all([
    getColdOverview(),
    getCampaigns(),
    getSuppressions(50),
  ]);

  return (
    <>
      <div
        style={{
          ...card,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Sending is{" "}
            <span
              style={{ color: overview.globalPaused ? "#c3553a" : "#1a7f37" }}
            >
              {overview.globalPaused ? "PAUSED" : "live"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#999" }}>
            Cron runs every 15 min · {overview.activeCampaigns} active
            campaign(s)
          </div>
        </div>
        <PauseToggle paused={overview.globalPaused} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <Stat label="sent today" value={String(overview.sentToday)} />
        <Stat label="sent · 7d" value={String(overview.sent7d)} />
        {/* Raw opens include MPP/proxy prefetch — fuzzy upper bound (plan #17).
            Human = firstOpenedAt set + suspectedPrefetch=false (cheap path). */}
        <Stat
          label="opens · 7d (incl. prefetch)"
          value={String(overview.opens7dRaw)}
        />
        <Stat
          label="likely human opens · 7d"
          value={String(overview.opens7dHuman)}
        />
        <Stat
          label="failed · 7d"
          value={String(overview.failed7d)}
          warn={overview.failed7d > 0}
        />
        <Stat label="suppressed" value={String(overview.suppressedTotal)} />
        <Stat label="recipients" value={String(overview.totalRecipients)} />
        <Stat
          label="capacity · wk"
          value={String(overview.projectedWeekly)}
          warn={overview.projectedWeekly < 1000}
        />
      </div>

      <section style={card}>
        <h2 style={h2}>Mailboxes</h2>
        <div style={{ marginBottom: 12 }}>
          <SyncMailboxesButton />
        </div>
        {overview.mailboxes.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>
            No mailboxes yet. Set COLD_MAILBOX_* env vars, then “Sync mailboxes
            from env”.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>address</th>
                <th style={th}>status</th>
                <th style={th}>today</th>
                <th style={th}>cap (eff/target)</th>
                <th style={th}>ramp</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {overview.mailboxes.map((m) => (
                <tr key={m.address}>
                  <td style={td}>{m.address}</td>
                  <td style={td}>
                    {m.status}
                    {m.blocked ? " · blocked" : ""}
                  </td>
                  <td style={td}>{m.todaySent}</td>
                  <td style={td}>
                    {m.effectiveCap}/{m.dailyCap}
                  </td>
                  <td style={td}>{m.rampStartedAt ? "started" : "—"}</td>
                  <td style={td}>
                    <MailboxControls address={m.address} status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>
          Seed test (sends from your first mailbox, ignores caps)
        </h2>
        <SeedTestForm />
      </section>

      <section style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ ...h2, marginBottom: 0 }}>Campaigns</h2>
          <CreateDefaultButton />
        </div>
        {campaigns.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>
            No campaigns yet. Create the default 3-touch sequence to start.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>name</th>
                <th style={th}>status</th>
                <th style={th}>country</th>
                <th style={th}>steps</th>
                <th style={th}>recipients</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>{c.status}</td>
                  <td style={td}>{c.country}</td>
                  <td style={td}>{c.steps}</td>
                  <td style={td}>{c.recipients}</td>
                  <td style={td}>
                    <Link
                      href={`/admin/email/campaigns/${c.id}`}
                      style={{ color: "#5b3df5" }}
                    >
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Mark replied (stops their follow-ups instantly)</h2>
        <MarkRepliedForm />
      </section>

      <section style={card}>
        <h2 style={h2}>Suppression list ({overview.suppressedTotal})</h2>
        <div style={{ marginBottom: 14 }}>
          <SuppressionForm />
        </div>
        {suppressions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>Nothing suppressed yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>email</th>
                <th style={th}>source</th>
                <th style={th}>when</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {suppressions.map((s) => (
                <tr key={s.email}>
                  <td style={td}>{s.email}</td>
                  <td style={td}>{s.source}</td>
                  <td style={td}>{s.createdAt.slice(0, 10)}</td>
                  <td style={td}>
                    <RemoveSuppressionButton email={s.email} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
