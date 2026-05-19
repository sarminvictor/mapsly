// Dev dashboard — Phase 1 wiring: real GitHub feed (commits + open PRs + merges).
// Remaining sections (PLAN.md parser, sessions JSON, CronRun, MCP health, enhance
// signals) get added by the autonomous loop in phases 1.10.4–1.10.7.

import { Suspense } from "react";
import {
  getRecentCommits,
  getOpenPrs,
  getRecentMerges,
} from "./queries/github";

export default function DevDashboard() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

  return (
    <div className="dev-wrap">
      <header className="dev-head">
        <div className="dev-head-left">
          <span className="dev-dot" aria-hidden />
          <div>
            <div className="dev-head-title">
              Mapsly · autonomous build status
            </div>
            <div className="dev-status">
              dev.mapsly.ai · phase 1 in progress
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span className="dev-pill">phase 1 · ramping</span>
          <span className="dev-pill">build {sha}</span>
        </div>
      </header>

      <section className="dev-hero">
        <Suspense fallback={<TileSkeleton label="open prs" />}>
          <OpenPrsTile />
        </Suspense>
        <Suspense fallback={<TileSkeleton label="recent merges" />}>
          <RecentMergesTile />
        </Suspense>
        <Tile label="avg score" value="—" sub="threshold 9.0" tone="indigo" />
        <Tile label="api spend today" value="$0.00" sub="ceiling $5.00" />
        <Tile label="sessions 7d" value="—" sub="loop not armed" />
        <Tile label="failures 24h" value="0" sub="rolling" tone="green" />
      </section>

      <div className="dev-card">
        <h2>Recent commits</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <CommitsList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Open PRs</h2>
        <Suspense fallback={<div className="dev-empty">loading…</div>}>
          <PrsList />
        </Suspense>
      </div>

      <div className="dev-card">
        <h2>Plan progress</h2>
        <div className="dev-empty">
          parser lands in phase 1.10.4 · until then, see{" "}
          <code className="dev-mono">PLAN.md</code> in the repo.
        </div>
      </div>

      <div className="dev-card">
        <h2>Sessions · last 7 days</h2>
        <div className="dev-empty">
          autonomous loop writes session JSON files; renderer lands in phase
          1.10.4.
        </div>
      </div>

      <div className="dev-card">
        <h2>MCP + API health</h2>
        <div className="dev-empty">
          health pings + cost aggregate land in phase 1.10.5 (KV-backed, 60s
          cache).
        </div>
      </div>

      <footer
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          color: "var(--dev-text-3)",
          marginTop: 24,
          textAlign: "center",
        }}
      >
        mapsly · build status · internal · no index
      </footer>
    </div>
  );
}

// ---------- Hero tiles ----------

async function OpenPrsTile() {
  const prs = await getOpenPrs();
  const needsReview = prs.filter((p) =>
    p.labels.includes("needs-review"),
  ).length;
  return (
    <Tile
      label="open prs"
      value={String(prs.length)}
      sub={needsReview > 0 ? `${needsReview} need review` : "all gates pending"}
      tone={needsReview > 0 ? "amber" : undefined}
    />
  );
}

async function RecentMergesTile() {
  const merges = await getRecentMerges(20);
  return (
    <Tile
      label="merges 7d"
      value={String(merges.length)}
      sub="auto + manual"
      tone="green"
    />
  );
}

// ---------- Lists ----------

async function CommitsList() {
  const commits = await getRecentCommits(8);
  if (commits.length === 0) {
    return (
      <div className="dev-empty">
        no commits visible · check GITHUB_TOKEN in Vercel env.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {commits.map((c) => (
        <a
          key={c.sha}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--dev-bg-3)",
            color: "var(--dev-text)",
            textDecoration: "none",
            border: "1px solid var(--dev-border)",
          }}
        >
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {c.short}
          </span>
          <span style={{ fontSize: 13, flex: 1 }}>{c.message}</span>
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {c.author}
          </span>
        </a>
      ))}
    </div>
  );
}

async function PrsList() {
  const prs = await getOpenPrs();
  if (prs.length === 0) {
    return <div className="dev-empty">no open PRs · queue is clean.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {prs.slice(0, 10).map((pr) => (
        <a
          key={pr.number}
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--dev-bg-3)",
            color: "var(--dev-text)",
            textDecoration: "none",
            border: "1px solid var(--dev-border)",
          }}
        >
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            #{pr.number}
          </span>
          <span style={{ fontSize: 13, flex: 1 }}>{pr.title}</span>
          {pr.labels.length > 0 && (
            <span style={{ display: "flex", gap: 4 }}>
              {pr.labels.slice(0, 3).map((l) => (
                <span
                  key={l}
                  className="dev-mono"
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: l.includes("ready")
                      ? "rgba(34,197,94,.15)"
                      : l.includes("review")
                        ? "rgba(245,158,11,.15)"
                        : "var(--dev-bg-2)",
                    color: "var(--dev-text-2)",
                  }}
                >
                  {l}
                </span>
              ))}
            </span>
          )}
          <span
            className="dev-mono"
            style={{ fontSize: 11, color: "var(--dev-text-3)" }}
          >
            {pr.author}
          </span>
        </a>
      ))}
    </div>
  );
}

// ---------- Reusable ----------

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "green" | "indigo" | "amber";
}) {
  return (
    <div className="dev-tile">
      <div className="dev-tile-label">{label}</div>
      <div className={`dev-tile-num${tone ? " " + tone : ""}`}>{value}</div>
      <div className="dev-tile-sub">{sub}</div>
    </div>
  );
}

function TileSkeleton({ label }: { label: string }) {
  return (
    <div className="dev-tile">
      <div className="dev-tile-label">{label}</div>
      <div className="dev-tile-num" style={{ opacity: 0.3 }}>
        …
      </div>
      <div className="dev-tile-sub">loading</div>
    </div>
  );
}
