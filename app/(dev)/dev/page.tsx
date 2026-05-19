// Dev dashboard — placeholder structure.
// Real data sources land in PLAN Phase 1.10.3+ (session JSON, PLAN.md parser,
// GitHub API, CronRun aggregates, MCP health pings, enhance-signals).
// See docs/dev-dashboard.md for the full spec.

export default function DevDashboard() {
  // Build identity surfaced from Vercel env (known at build time).
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
              dev.mapsly.ai · scaffold live · data wiring pending
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span className="dev-pill">phase 0 · scaffold</span>
          <span className="dev-pill">build {sha}</span>
        </div>
      </header>

      <section className="dev-hero">
        <Tile label="phases shipped" value="0" sub="phase 1 in queue" />
        <Tile label="auto-merges" value="0" sub="last 7d" />
        <Tile label="avg score" value="—" sub="threshold 9.0" tone="indigo" />
        <Tile label="api spend today" value="$0.00" sub="ceiling $5.00" />
        <Tile label="open prs" value="0" sub="needs-review queue" />
        <Tile label="failures 24h" value="0" sub="rolling" tone="green" />
      </section>

      <div className="dev-card">
        <h2>Plan progress</h2>
        <div className="dev-empty">
          parser lands in phase 1.10.3 · until then, see{" "}
          <code className="dev-mono">PLAN.md</code> in the repo.
        </div>
      </div>

      <div className="dev-card">
        <h2>Sessions · last 7 days</h2>
        <div className="dev-empty">
          no autonomous sessions yet · first run lands when the loop is armed.
        </div>
      </div>

      <div className="dev-card">
        <h2>MCP + API health</h2>
        <div className="dev-empty">
          health pings land in phase 1.10.5 (KV-backed, 60s cache).
        </div>
      </div>

      <div className="dev-card">
        <h2>Recent commits</h2>
        <div className="dev-empty">GitHub API feed lands in phase 1.10.3.</div>
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
