/**
 * SMB website health · `/(smb)/website`.
 *
 * Audience: Maria. The whole page is a Maria-voice translation of the
 * LighthouseAudit table — no LCP/INP/CLS/schema/NAP jargon reaches
 * the user. The page just lays out four sections:
 *
 *   1. Overall verdict hero · "Quick" / "OK" / "Slow"
 *   2. Speed signals · 4 tiles
 *   3. Checks · 5 pass/fail rows
 *   4. Top fixes · ranked + actionable
 *   5. Tech stack footnote (minor)
 *
 * Per `.claude/rules/ui-ux-smb.md` · all banned-jargon translation
 * happens in `modules/smb-website/types.ts` so this page just
 * renders pre-translated strings.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSmbWebsiteData } from "@/modules/smb-website/queries";
import type { HealthTone, WebsiteCheck } from "@/modules/smb-website/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.website.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function SmbWebsitePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<WebsiteSkeleton />}>
      <WebsiteBody params={params} />
    </Suspense>
  );
}

function WebsiteSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 240,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          height: 140,
          background: "var(--color-bg-2)",
          borderRadius: 16,
          marginBottom: 22,
        }}
      />
    </section>
  );
}

async function WebsiteBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.website");
  const data = await getSmbWebsiteData(session.user.id);

  if (data.ownedBusinessId === "") {
    return (
      <section
        style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--color-text)",
          }}
        >
          {t("empty_title")}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            color: "var(--color-text-2)",
            fontSize: 17,
            lineHeight: 1.5,
          }}
        >
          {t("empty_body")}
        </p>
      </section>
    );
  }

  const hasAudit = data.auditedAt != null;

  return (
    <section
      aria-labelledby="website-heading"
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {t("eyebrow")}
        </p>
        <h1
          id="website-heading"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "6px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        {data.websiteUrl ? (
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
            }}
          >
            {data.websiteUrl}
          </p>
        ) : null}
      </header>

      {!hasAudit ? (
        <div
          style={{
            background: "var(--color-bg-2)",
            border: "1px dashed var(--color-border)",
            borderRadius: 14,
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              color: "var(--color-text)",
            }}
          >
            {t("no_audit_title")}
          </p>
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
            }}
          >
            {t("no_audit_body")}
          </p>
        </div>
      ) : (
        <>
          {/* Overall verdict hero */}
          <section
            aria-labelledby="overall-heading"
            style={{
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "22px 24px",
              marginBottom: 22,
              display: "flex",
              alignItems: "center",
              gap: 24,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <p
                id="overall-heading"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-3)",
                }}
              >
                {t("overall_label")}
              </p>
              <p
                style={{
                  margin: "6px 0 0",
                  fontFamily: "var(--font-serif)",
                  fontSize: 40,
                  lineHeight: 1.05,
                  letterSpacing: "-0.02em",
                  color: toneColor(data.overallTone),
                  fontWeight: 600,
                }}
              >
                {data.overallVerdict}
              </p>
              <p
                style={{
                  margin: "10px 0 0",
                  color: "var(--color-text-2)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  maxWidth: 460,
                }}
              >
                {t("overall_meaning")}
              </p>
            </div>
            {data.overallScore != null ? (
              <div
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  padding: "12px 16px",
                  minWidth: 130,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-3)",
                  }}
                >
                  {t("score_label")}
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontFamily: "var(--font-serif)",
                    fontSize: 28,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  {Math.round(data.overallScore)}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--color-text-3)",
                      marginLeft: 2,
                    }}
                  >
                    /100
                  </span>
                </p>
              </div>
            ) : null}
          </section>

          {/* Speed signals */}
          <section aria-labelledby="speed-heading" style={{ marginBottom: 22 }}>
            <h2
              id="speed-heading"
              style={{
                margin: "0 0 12px",
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                letterSpacing: "-0.01em",
                color: "var(--color-text)",
              }}
            >
              {t("speed_heading")}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 10,
              }}
            >
              {data.speedSignals.map((s) => (
                <article
                  key={s.key}
                  style={{
                    background: "var(--color-bg-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    padding: "14px 16px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--color-text-3)",
                    }}
                  >
                    {t(`speed_${s.key}_label`)}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontFamily: "var(--font-serif)",
                      fontSize: 22,
                      fontWeight: 600,
                      color: toneColor(s.tone),
                    }}
                  >
                    {s.value}
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      color: "var(--color-text-2)",
                    }}
                  >
                    {s.meaning}
                  </p>
                </article>
              ))}
            </div>
          </section>

          {/* Checks */}
          <section
            aria-labelledby="checks-heading"
            style={{ marginBottom: 22 }}
          >
            <h2
              id="checks-heading"
              style={{
                margin: "0 0 12px",
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                letterSpacing: "-0.01em",
                color: "var(--color-text)",
              }}
            >
              {t("checks_heading")}
            </h2>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                background: "var(--color-bg-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              {data.checks.map((c, idx) => (
                <li
                  key={c.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderTop:
                      idx === 0 ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      background: checkBg(c.state),
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    {c.state === "pass" ? "✓" : c.state === "fail" ? "!" : "?"}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 14,
                        color: "var(--color-text)",
                        fontWeight: 500,
                      }}
                    >
                      {t(`check_${c.key}_label`)}
                    </p>
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: 12.5,
                        color: "var(--color-text-2)",
                        lineHeight: 1.45,
                      }}
                    >
                      {c.meaning}
                    </p>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: checkLabelColor(c.state),
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {t(`check_state_${c.state}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Top fixes */}
          {data.topFixes.length > 0 ? (
            <section
              aria-labelledby="fixes-heading"
              style={{ marginBottom: 22 }}
            >
              <h2
                id="fixes-heading"
                style={{
                  margin: "0 0 12px",
                  fontFamily: "var(--font-serif)",
                  fontSize: 18,
                  letterSpacing: "-0.01em",
                  color: "var(--color-text)",
                }}
              >
                {t("fixes_heading")}
              </h2>
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gap: 10,
                }}
              >
                {data.topFixes.map((fix) => (
                  <li
                    key={fix.rank}
                    style={{
                      background: "var(--color-bg-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      padding: "14px 18px",
                      display: "grid",
                      gridTemplateColumns: "32px minmax(0, 1fr) auto",
                      alignItems: "flex-start",
                      gap: 14,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--color-coral)",
                        fontWeight: 600,
                        marginTop: 2,
                      }}
                    >
                      #{fix.rank}
                    </span>
                    <div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: 600,
                          color: "var(--color-text)",
                        }}
                      >
                        {fix.action}
                      </p>
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: 13.5,
                          color: "var(--color-text-2)",
                          lineHeight: 1.5,
                        }}
                      >
                        {fix.why}
                      </p>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--color-text-3)",
                        whiteSpace: "nowrap",
                        marginTop: 4,
                      }}
                    >
                      {fix.effort}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {/* Tech stack */}
          {data.techStack.length > 0 ? (
            <section
              aria-labelledby="tech-heading"
              style={{ marginBottom: 22 }}
            >
              <h2
                id="tech-heading"
                style={{
                  margin: "0 0 8px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-3)",
                  fontWeight: 600,
                }}
              >
                {t("tech_heading")}
              </h2>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {data.techStack.map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: "var(--color-bg-3)",
                      color: "var(--color-text-2)",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <p
            style={{
              margin: "24px 0 0",
              color: "var(--color-text-3)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("footer_help")}
          </p>
        </>
      )}
    </section>
  );
}

function toneColor(tone: HealthTone): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "warn":
      return "var(--color-gold)";
    case "bad":
      return "var(--color-alert)";
    case "neutral":
    default:
      return "var(--color-text)";
  }
}

function checkBg(state: WebsiteCheck["state"]): string {
  switch (state) {
    case "pass":
      return "var(--color-success)";
    case "fail":
      return "var(--color-alert)";
    case "unknown":
    default:
      return "var(--color-text-3)";
  }
}

function checkLabelColor(state: WebsiteCheck["state"]): string {
  switch (state) {
    case "pass":
      return "var(--color-success)";
    case "fail":
      return "var(--color-alert)";
    case "unknown":
    default:
      return "var(--color-text-3)";
  }
}
