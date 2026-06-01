/**
 * Shared SMB page header · one structure for every /(smb) page so titles,
 * the website line, and descriptions stay identical in tone + layout:
 *
 *   {eyebrow} · {domain}            ← mono label + clean domain (linked)
 *   {Topic} for {Business Name}     ← serif title, always names the business
 *   subtitle                        ← {namespace}.subtitle (one warm line)
 *
 * The website shows as the bare domain only (theinjectionist.ca) on the
 * eyebrow line, separated by a middot, linking to the full URL.
 *
 * Async server component · it fetches the business name + website itself
 * (`getSmbHeaderInfo`) and resolves its own i18n from `namespace`, so each
 * page renders it in a single line:
 *
 *   <SmbPageHeader userId={uid} namespace="smb.website" titleId="website-heading" />
 *
 * `subtitleParams` carries any extra ICU args the subtitle needs (e.g. {city}).
 */

import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";

import { getSmbHeaderInfo } from "@/modules/smb-shared/header-info";

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-3)",
};

const titleStyle: CSSProperties = {
  margin: "6px 0 0",
  fontFamily: "var(--font-serif)",
  fontSize: "clamp(28px, 4vw, 36px)",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  color: "var(--color-text)",
};

const subtitleStyle: CSSProperties = {
  margin: "10px 0 0",
  color: "var(--color-text-2)",
  fontSize: 15,
  lineHeight: 1.5,
  maxWidth: 580,
};

/** Bare display domain — "https://www.x.ca/path" → "x.ca". */
function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");
  }
}

export interface SmbPageHeaderProps {
  /** Signed-in user id · used to look up the owned business name + website. */
  userId: string;
  /** i18n namespace holding `eyebrow` / `title` (with {name}) / `subtitle`. */
  namespace: string;
  /** `id` for the page's `aria-labelledby` target. */
  titleId?: string;
  /** Extra ICU args for the subtitle (e.g. `{ city }`). */
  subtitleParams?: Record<string, string | number>;
}

export async function SmbPageHeader({
  userId,
  namespace,
  titleId,
  subtitleParams,
}: SmbPageHeaderProps) {
  const [t, header] = await Promise.all([
    getTranslations(namespace),
    getSmbHeaderInfo(userId),
  ]);
  const name = header?.name ?? "";
  const url = header?.websiteUrl ?? null;
  const domain = url ? displayDomain(url) : null;

  return (
    <header style={{ marginBottom: 24 }}>
      <p style={eyebrowStyle}>
        {t("eyebrow")}
        {url && domain ? (
          <span style={{ textTransform: "none" }}>
            {" · "}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-text-2)", textDecoration: "none" }}
            >
              {domain}
            </a>
          </span>
        ) : null}
      </p>
      <h1 id={titleId} style={titleStyle}>
        {t("title", { name })}
      </h1>
      <p style={subtitleStyle}>{t("subtitle", subtitleParams ?? {})}</p>
    </header>
  );
}
