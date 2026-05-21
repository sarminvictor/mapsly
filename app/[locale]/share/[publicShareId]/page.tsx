/**
 * Public share page · F.8 · `/share/[publicShareId]`.
 *
 * View-only branded summary of an agency's prospect, sent to the SMB
 * by the agency as a pitch artifact. No auth required — the
 * `publicShareId` (32 hex chars, ~128 bits entropy) is the
 * authorization token. 30-day expiry; expired links render a gentle
 * "this link has expired" state instead of a 404 so the recipient
 * understands why and the agency can re-share.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** · default export is SYNC; async body inside a
 *     `<Suspense>` boundary so dynamic-id routes prerender clean.
 *   - **Pattern 1** · `getShareableReport` short-circuits at the
 *     `NEXT_PHASE === 'phase-production-build'` guard (INC-27).
 *   - **Pattern 5** · no `export const dynamic` · Suspense wrap is
 *     the canonical signal under `cacheComponents`.
 *
 * Per `.claude/rules/seo.md` + `.claude/rules/security.md`:
 *
 *   - Metadata sets `robots: noindex, nofollow` · we don't want share
 *     URLs in Google.
 *   - No `Cache-Control: public` · the page is per-publicShareId
 *     unique; Next's data cache handles repeated visits via
 *     `cacheTag('share-${id}')` instead.
 *
 * View-count increment runs via `after()` so the response is never
 * blocked on the write.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";

import {
  getShareableReport,
  incrementShareViewCount,
  isValidPublicShareId,
} from "@/modules/reports/share-link";
import type { ShareLookupResult } from "@/modules/reports/share-link";
import type { OnePagerData } from "@/modules/reports/one-pager-data";

/* ============================================================ types */

interface PageParams {
  locale: string;
  publicShareId: string;
}

interface PageProps {
  params: Promise<PageParams>;
}

/* ============================================================ meta */

export const metadata: Metadata = {
  title: "Mapsly · Local business briefing",
  description: "A shared local-business intelligence briefing on Mapsly.",
  robots: { index: false, follow: false },
};

/* ============================================================ page */

export default function ShareLinkPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ShareLoading />}>
      <ShareBody params={params} />
    </Suspense>
  );
}

/* ----------------------------------------------------------- skeleton */

function ShareLoading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg, #faf6f1)",
        padding: "48px 24px",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <p
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            fontSize: 12,
            color: "var(--color-text-3, #998a78)",
            margin: 0,
          }}
        >
          loading briefing…
        </p>
      </div>
    </main>
  );
}

/* ----------------------------------------------------------- body */

async function ShareBody({ params }: { params: Promise<PageParams> }) {
  const { publicShareId } = await params;

  if (!isValidPublicShareId(publicShareId)) {
    notFound();
  }

  const lookup: ShareLookupResult = await getShareableReport(
    publicShareId,
    "en",
  );

  if (lookup.status === "not_found") {
    notFound();
  }

  if (lookup.status === "expired") {
    return <ExpiredState expiresAt={lookup.expiresAt} />;
  }

  // Fire-and-forget view-count increment after the response ships.
  after(async () => {
    await incrementShareViewCount(publicShareId);
  });

  return (
    <ShareView
      data={lookup.report.data}
      remainingLabel={lookup.report.remainingLabel}
    />
  );
}

/* ============================================================ expired */

function ExpiredState({ expiresAt }: { expiresAt: Date }) {
  const expiredOn = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(expiresAt);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg, #faf6f1)",
        padding: "64px 24px",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial",
        color: "var(--color-text, #2d2418)",
      }}
    >
      <section
        aria-labelledby="expired-title"
        style={{
          maxWidth: 540,
          margin: "0 auto",
          background: "var(--color-bg-2, #ffffff)",
          border: "1px solid var(--color-border, #ebe1d3)",
          borderRadius: 14,
          padding: "32px 28px",
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
            fontSize: 11,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--color-coral, #c3553a)",
            margin: 0,
          }}
        >
          Link expired
        </p>
        <h1
          id="expired-title"
          style={{
            fontFamily: "Fraunces, Georgia, serif",
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            margin: "12px 0 16px",
            color: "var(--color-text, #2d2418)",
          }}
        >
          This briefing is no longer available
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--color-text-2, #5f5240)",
            margin: 0,
          }}
        >
          The share link expired on {expiredOn}. Ask whoever sent it to you for
          a fresh link — they can create a new one in seconds.
        </p>
        <MapslyAttribution />
      </section>
    </main>
  );
}

/* ============================================================ view */

function ShareView({
  data,
  remainingLabel,
}: {
  data: OnePagerData;
  remainingLabel: string;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg, #faf6f1)",
        padding: "48px 16px 64px",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial",
        color: "var(--color-text, #2d2418)",
      }}
    >
      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          background: "var(--color-bg-2, #ffffff)",
          border: "1px solid var(--color-border, #ebe1d3)",
          borderRadius: 16,
          padding: "32px 32px 40px",
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <p
            data-testid="share-prepared-by"
            style={{
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
              fontSize: 11,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--color-coral, #c3553a)",
              margin: 0,
            }}
          >
            {data.preparedBy} · {data.preparedDate}
          </p>
          <h1
            data-testid="share-business-name"
            style={{
              fontFamily: "Fraunces, Georgia, serif",
              fontSize: 36,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "10px 0 6px",
            }}
          >
            {data.businessName}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-2, #5f5240)",
              margin: 0,
            }}
          >
            {[data.cityLine, data.category].filter(Boolean).join(" · ")}
          </p>
        </header>

        <KpiRow data={data} />

        <PitchWedges wedges={data.pitchWedges} />

        <Fixes fixes={data.fixes} />

        <footer
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: "1px solid var(--color-border, #ebe1d3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <p
            data-testid="share-remaining"
            style={{
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
              fontSize: 11,
              color: "var(--color-text-3, #998a78)",
              margin: 0,
            }}
          >
            View-only · {remainingLabel}
          </p>
          <MapslyAttribution inline />
        </footer>
      </article>
    </main>
  );
}

function KpiRow({ data }: { data: OnePagerData }) {
  const kpis: { label: string; value: string }[] = [
    { label: "Mapsly Score", value: `${data.mapslyScore}/10` },
    { label: "Reviews", value: data.ratingLine },
    {
      label: "Reply rate",
      value: data.replyRateLine.replace(/^Reply rate /, ""),
    },
    {
      label: "Site speed",
      value: data.performanceLine.replace(/^Lighthouse /, ""),
    },
  ];
  return (
    <section
      aria-label="Key metrics"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
        margin: "8px 0 28px",
      }}
    >
      {kpis.map((k) => (
        <div
          key={k.label}
          style={{
            background: "var(--color-bg, #faf6f1)",
            border: "1px solid var(--color-border, #ebe1d3)",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <p
            style={{
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
              fontSize: 10,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--color-text-3, #998a78)",
              margin: 0,
            }}
          >
            {k.label}
          </p>
          <p
            style={{
              fontFamily: "Fraunces, Georgia, serif",
              fontSize: 22,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              margin: "4px 0 0",
              color: "var(--color-text, #2d2418)",
            }}
          >
            {k.value}
          </p>
        </div>
      ))}
    </section>
  );
}

function PitchWedges({ wedges }: { wedges: OnePagerData["pitchWedges"] }) {
  if (wedges.length === 0) return null;
  return (
    <section aria-labelledby="pitch-title" style={{ marginBottom: 28 }}>
      <h2
        id="pitch-title"
        style={{
          fontFamily: "Fraunces, Georgia, serif",
          fontSize: 20,
          letterSpacing: "-0.01em",
          margin: "0 0 14px",
        }}
      >
        What we&rsquo;d focus on
      </h2>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {wedges.map((w) => (
          <li
            key={w.index}
            data-testid={`share-wedge-${w.index}`}
            style={{
              display: "flex",
              gap: 14,
              padding: "14px 0",
              borderTop:
                w.index === 1
                  ? "none"
                  : "1px solid var(--color-border, #ebe1d3)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "0 0 28px",
                height: 28,
                borderRadius: 999,
                background: "var(--color-coral, #c3553a)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "Fraunces, Georgia, serif",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {w.index}
            </span>
            <div>
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.45,
                  margin: 0,
                  fontWeight: 600,
                  color: "var(--color-text, #2d2418)",
                }}
              >
                {w.headline}
              </p>
              <p
                style={{
                  fontFamily:
                    "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  margin: "4px 0 0",
                  color: "var(--color-text-2, #5f5240)",
                }}
              >
                {w.evidence}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fixes({ fixes }: { fixes: OnePagerData["fixes"] }) {
  if (fixes.length === 0) return null;
  return (
    <section aria-labelledby="fixes-title" style={{ marginBottom: 8 }}>
      <h2
        id="fixes-title"
        style={{
          fontFamily: "Fraunces, Georgia, serif",
          fontSize: 20,
          letterSpacing: "-0.01em",
          margin: "0 0 12px",
        }}
      >
        What we&rsquo;d ship in the first 30 days
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {fixes.map((f, i) => (
          <li
            key={`${f.area}-${i}`}
            data-testid={`share-fix-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(120px, auto) 1fr",
              gap: 14,
              padding: "10px 0",
              borderTop:
                i === 0 ? "none" : "1px solid var(--color-border, #ebe1d3)",
            }}
          >
            <span
              style={{
                fontFamily:
                  "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                fontSize: 11,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--color-text-3, #998a78)",
                paddingTop: 2,
              }}
            >
              {f.area}
            </span>
            <span
              style={{
                fontSize: 14.5,
                lineHeight: 1.5,
                color: "var(--color-text, #2d2418)",
              }}
            >
              {f.action}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MapslyAttribution({ inline = false }: { inline?: boolean }) {
  return (
    <p
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
        fontSize: 11,
        color: "var(--color-text-3, #998a78)",
        margin: inline ? 0 : "24px 0 0",
        textAlign: inline ? "right" : "center",
      }}
    >
      Built with{" "}
      <a
        href="https://mapsly.ai"
        style={{ color: "var(--color-coral, #c3553a)", textDecoration: "none" }}
        rel="noreferrer"
      >
        Mapsly
      </a>
    </p>
  );
}
