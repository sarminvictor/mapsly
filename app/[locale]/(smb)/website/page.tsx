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

import { Suspense, type CSSProperties } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { SmbPageHeader } from "@/components/smb/SmbPageHeader";
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
        maxWidth: 1080,
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
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <SmbPageHeader
        userId={session.user.id}
        namespace="smb.website"
        titleId="website-heading"
        pillar="website"
      />

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
          {/* Two-column layout · left = the audit detail (overall + speed +
              checks + tech), right = Quick wins. Collapses to one column on
              mobile via `.smb-website-grid`. */}
          <div
            className="smb-website-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 300px",
              gap: 24,
              alignItems: "start",
            }}
          >
            <main>
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
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {data.overallScore != null ? (
                    <ScorePill
                      label={t("score_label")}
                      value={data.overallScore}
                      tone={data.overallTone}
                    />
                  ) : null}
                  {data.seoScore != null ? (
                    <ScorePill
                      label={t("seo_label")}
                      value={data.seoScore}
                      tone={data.seoTone}
                    />
                  ) : null}
                </div>
              </section>

              {/* Speed signals */}
              <section
                aria-labelledby="speed-heading"
                style={{ marginBottom: 22 }}
              >
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 16,
                          marginTop: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          {/* Only label "Mobile" when there's a Desktop value
                              to sit beside it — otherwise just show the value. */}
                          {s.desktopValue ? (
                            <p style={deviceLabelStyle}>{t("speed_mobile")}</p>
                          ) : null}
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontFamily: "var(--font-serif)",
                              fontSize: 22,
                              fontWeight: 600,
                              color: toneColor(s.tone),
                            }}
                          >
                            {s.value}
                          </p>
                        </div>
                        {s.desktopValue ? (
                          <div style={{ textAlign: "right" }}>
                            <p style={deviceLabelStyle}>{t("speed_desktop")}</p>
                            <p
                              style={{
                                margin: "2px 0 0",
                                fontFamily: "var(--font-serif)",
                                fontSize: 22,
                                fontWeight: 600,
                                color: toneColor(s.desktopTone),
                              }}
                            >
                              {s.desktopValue}
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--color-text-3)",
                        }}
                      >
                        {s.target}
                      </p>
                      <p
                        style={{
                          margin: "8px 0 0",
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

              {/* Checks · only rendered when there's at least one definite
                  pass/fail (uncertain checks are filtered out upstream). */}
              {data.checks.length > 0 ? (
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
                            idx === 0
                              ? "none"
                              : "1px solid var(--color-border)",
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
                          {c.state === "pass"
                            ? "✓"
                            : c.state === "fail"
                              ? "!"
                              : "?"}
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

              {/* Compare nearby · same-cell speed ranking. Hidden until at
                  least one competitor has a website score (audit them via the
                  admin "Run Website" button to fill the table). */}
              {data.competitors.length > 0 ? (
                <section
                  aria-labelledby="compare-heading"
                  style={{ marginBottom: 22 }}
                >
                  <h2
                    id="compare-heading"
                    style={{
                      margin: "0 0 4px",
                      fontFamily: "var(--font-serif)",
                      fontSize: 18,
                      letterSpacing: "-0.01em",
                      color: "var(--color-text)",
                    }}
                  >
                    {t("compare_heading")}
                  </h2>
                  <p
                    style={{
                      margin: "0 0 12px",
                      fontSize: 13,
                      color: "var(--color-text-2)",
                    }}
                  >
                    {t("compare_subtitle", { total: data.rankedTotal })}
                  </p>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 14,
                      background: "var(--color-bg-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 14,
                      overflow: "hidden",
                    }}
                  >
                    <thead>
                      <tr>
                        <th scope="col" style={compareThStyle}>
                          #
                        </th>
                        <th scope="col" style={compareThStyle}>
                          {t("compare_col_business")}
                        </th>
                        <th
                          scope="col"
                          style={{ ...compareThStyle, textAlign: "right" }}
                        >
                          {t("compare_col_score")}
                        </th>
                        <th
                          scope="col"
                          style={{ ...compareThStyle, textAlign: "right" }}
                        >
                          {t("compare_col_speed")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.competitors.map((c) => (
                        <tr
                          key={`${c.rank}-${c.name}`}
                          style={{
                            borderTop: "1px solid var(--color-border)",
                            background: c.isYou
                              ? "rgba(195, 85, 58, 0.08)"
                              : "transparent",
                          }}
                        >
                          <td
                            style={{
                              padding: "10px 12px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                              color: "var(--color-text-3)",
                              width: 48,
                            }}
                          >
                            #{c.rank}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: "var(--color-text)",
                              fontWeight: c.isYou ? 700 : 500,
                            }}
                          >
                            {c.name}
                            {c.isYou ? (
                              <span style={youBadgeStyle}>
                                {t("compare_you")}
                              </span>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontFamily: "var(--font-serif)",
                              fontSize: 18,
                              fontWeight: 600,
                              color: pillarScoreColor(c.score),
                            }}
                          >
                            {c.score.toFixed(1)}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontFamily: "var(--font-mono)",
                              fontSize: 13,
                              color:
                                c.speed != null
                                  ? scoreColorFor(c.speed)
                                  : "var(--color-text-3)",
                            }}
                          >
                            {c.speed != null ? c.speed : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            </main>

            {/* Right rail · Quick wins · the prioritised fixes (no time
                estimates). Falls below <main> on mobile via the grid CSS. */}
            <aside
              aria-label={t("quick_wins_heading")}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {data.topFixes.length > 0 ? (
                <>
                  <h2
                    style={{
                      margin: "0 0 4px",
                      fontFamily: "var(--font-serif)",
                      fontSize: 16,
                      letterSpacing: "-0.01em",
                      color: "var(--color-text)",
                    }}
                  >
                    {t("quick_wins_heading")}
                  </h2>
                  {data.topFixes.map((fix) => (
                    <article
                      key={fix.rank}
                      style={{
                        background: "var(--color-bg-2)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 14,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: toneColor(fix.tone),
                        }}
                      >
                        #{fix.rank}
                      </span>
                      <h3
                        style={{
                          margin: 0,
                          fontFamily: "var(--font-serif)",
                          fontSize: 15.5,
                          letterSpacing: "-0.01em",
                          lineHeight: 1.25,
                          color: "var(--color-text)",
                        }}
                      >
                        {fix.action}
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "var(--color-text-2)",
                        }}
                      >
                        {fix.why}
                      </p>
                    </article>
                  ))}
                </>
              ) : (
                <div
                  style={{
                    background: "var(--color-bg-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 14,
                    padding: "16px 18px",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: "var(--color-text-2)",
                    }}
                  >
                    {t("quick_wins_empty")}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

/** One 0-100 score pill (Speed · Findable on Google), number tinted by tone. */
function ScorePill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: HealthTone;
}) {
  return (
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
        {label}
      </p>
      <p
        style={{
          margin: "4px 0 0",
          fontFamily: "var(--font-serif)",
          fontSize: 28,
          fontWeight: 600,
          color: toneColor(tone),
        }}
      >
        {Math.round(value)}
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
  );
}

/** "Mobile" / "Desktop" mini-label above each speed value. */
const deviceLabelStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-3)",
};

/** Column header for the "compare nearby" table. */
const compareThStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-3)",
};

/** "You" badge on the owner's row in the compare table. */
const youBadgeStyle: CSSProperties = {
  marginLeft: 8,
  padding: "1px 7px",
  borderRadius: 999,
  background: "var(--color-coral)",
  color: "#fff",
  fontFamily: "var(--font-mono)",
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

/** Speed-score colour (0–100) for the compare table's speed column. */
function scoreColorFor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 50) return "var(--color-gold)";
  return "var(--color-alert)";
}

/** Website pillar-score colour (0–10) — same thresholds as the pillar tiles. */
function pillarScoreColor(score: number): string {
  if (score >= 7) return "var(--color-success)";
  if (score >= 4) return "var(--color-gold)";
  return "var(--color-alert)";
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
