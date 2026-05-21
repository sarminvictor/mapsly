import * as React from "react";

import {
  MAX_ADS_PER_LANE_VISIBLE,
  UNMATCHED_KEYWORD,
  type AdEntry,
  type AdLaneStatus,
  type SmbAdPlatform,
} from "../types";

/**
 * AdLane · single keyword-lane card in the SMB ads grid.
 *
 * Renders one keyword bucket: the keyword string as the header, an
 * off-services chip when applicable, then the top
 * `MAX_ADS_PER_LANE_VISIBLE` ads inline with a "+N more" footer when
 * there are more. Each ad shows its platform + creative body + a
 * landing-page link.
 *
 * Server-component-safe — no hooks, no event handlers. Pure props in,
 * markup out. Visual palette honors `.claude/rules/ui-ux-smb.md`:
 * cream card surface (`--color-bg-2`), coral accent border when the
 * lane is off-services (per the "redundant cues, never color alone"
 * rule — the visual border pairs with the explicit text chip).
 *
 * Mobile-first: layout works at 380px (single column), then naturally
 * fits into the page's CSS grid. The container itself takes 100% of
 * its grid cell — the page controls how many columns.
 *
 * Accessibility (per `.claude/rules/accessibility.md`):
 *   - Lane is a `<article>` with `aria-label` carrying both keyword
 *     and off-service status so screen readers can scan the grid
 *   - Off-service chip is real text, not color-only
 *   - External landing-page links carry `rel="noopener noreferrer"` +
 *     `aria-label` (link icon would otherwise be unannounced)
 */

export interface AdLaneLabels {
  /** Chip text shown when the lane is off-keyword. */
  offKeywordChip: string;
  /** Accessible label for the off-service warning. */
  offKeywordAria: string;
  /** Label used in place of the keyword for the unmatched bucket
   * (e.g. "Other ads"). */
  unmatchedLabel: string;
  /** Plural-aware ads count formatter, resolved by next-intl in the
   * page. The component just calls it. */
  adsCount: (n: number) => string;
  /** Placeholder when an ad has no captured creative text. */
  noCreative: string;
  /** Platform pill label for Meta. */
  platformMeta: string;
  /** Platform pill label for Google. */
  platformGoogle: string;
  /** Aria label for the external landing-page link. */
  linkAria: string;
  /** Text suffix for the "+N more" footer when the lane has more ads
   * than fit visibly. Receives the overflow count. */
  moreCount: (n: number) => string;
  /** Status pill text — one per `AdLaneStatus`. */
  statusOpen: string;
  statusYouAbsent: string;
  statusPresent: string;
  statusCrowded: string;
  /** Sub-label rendered under the status pill summarising who's in
   * the lane. Receives competitor count + top advertiser names. */
  competitorsLine: (count: number, names: string[]) => string;
  /** Tag shown on each ad row identifying the advertiser (own vs
   * competitor). */
  yourAdTag: string;
}

export interface AdLaneProps {
  /** Lane key. `__unmatched__` for the catch-all bucket; any other
   * string is a tracked keyword. */
  keyword: string;
  /** Ads in this lane. The component slices to
   * `MAX_ADS_PER_LANE_VISIBLE` for the visible block; the rest are
   * counted into the "+N more" footer. */
  ads: AdEntry[];
  /** Whether to render with the off-service warning chip + coral
   * border. */
  isOffKeyword: boolean;
  /** Computed lane status (open / you-absent / present / crowded). */
  status: AdLaneStatus;
  /** Count of distinct competitor businesses advertising in this lane. */
  competitorCount: number;
  /** Top 3 competitor business names (sorted by ad count). */
  topCompetitors: string[];
  /** i18n-resolved labels passed in from the page. */
  labels: AdLaneLabels;
}

function statusPillStyle(status: AdLaneStatus): React.CSSProperties {
  // Per .claude/rules/ui-ux-smb.md "redundant cues, never color alone":
  // each status uses a different background + colour AND a different
  // text label, so colour is supportive not load-bearing.
  switch (status) {
    case "open":
      return {
        background: "rgba(45,134,89,.12)",
        color: "var(--color-success)",
      };
    case "you-absent":
      return {
        background: "rgba(212,165,116,.18)",
        color: "var(--color-berry)",
      };
    case "crowded":
      return {
        background: "rgba(154,144,136,.18)",
        color: "var(--color-text-2)",
      };
    case "present":
    default:
      return {
        background: "rgba(195,85,58,.10)",
        color: "var(--color-coral)",
      };
  }
}

function statusLabel(status: AdLaneStatus, labels: AdLaneLabels): string {
  switch (status) {
    case "open":
      return labels.statusOpen;
    case "you-absent":
      return labels.statusYouAbsent;
    case "crowded":
      return labels.statusCrowded;
    case "present":
    default:
      return labels.statusPresent;
  }
}

function platformLabel(platform: SmbAdPlatform, labels: AdLaneLabels): string {
  return platform === "GOOGLE" ? labels.platformGoogle : labels.platformMeta;
}

export function AdLane({
  keyword,
  ads,
  isOffKeyword,
  status,
  competitorCount,
  topCompetitors,
  labels,
}: AdLaneProps) {
  const isUnmatched = keyword === UNMATCHED_KEYWORD;
  const headerText = isUnmatched ? labels.unmatchedLabel : keyword;
  const visible = ads.slice(0, MAX_ADS_PER_LANE_VISIBLE);
  const overflow = Math.max(0, ads.length - visible.length);

  const ariaLabel = isOffKeyword
    ? `${headerText} (${labels.offKeywordAria})`
    : headerText;

  const showCompetitorLine = competitorCount > 0 || topCompetitors.length > 0;

  return (
    <article
      aria-label={ariaLabel}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "16px 16px 14px",
        background: isOffKeyword ? "rgba(195,85,58,.06)" : "var(--color-bg-2)",
        border: `1px solid ${
          isOffKeyword ? "var(--color-coral)" : "var(--color-border)"
        }`,
        borderRadius: 14,
        minWidth: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 0,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 17,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {headerText}
        </h3>
        {isOffKeyword ? (
          <span
            aria-label={labels.offKeywordAria}
            style={{
              flexShrink: 0,
              padding: "3px 8px",
              borderRadius: 999,
              background: "var(--color-coral)",
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            {labels.offKeywordChip}
          </span>
        ) : null}
      </header>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
            ...statusPillStyle(status),
          }}
          data-testid={`lane-status-${status}`}
        >
          {statusLabel(status, labels)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {labels.adsCount(ads.length)}
        </span>
      </div>

      {showCompetitorLine ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--color-text-2)",
          }}
        >
          {labels.competitorsLine(competitorCount, topCompetitors)}
        </p>
      ) : null}

      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 0,
          margin: 0,
          listStyle: "none",
        }}
      >
        {visible.map((ad) => (
          <li
            key={ad.id}
            style={{
              padding: "10px 12px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "space-between",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    padding: "2px 6px",
                    borderRadius: 6,
                    background: "var(--color-bg-3)",
                    color: "var(--color-text-2)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {platformLabel(ad.platform, labels)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: ad.isOwn
                      ? "var(--color-coral)"
                      : "var(--color-text-3)",
                    fontWeight: ad.isOwn ? 600 : 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                    maxWidth: 180,
                  }}
                  title={
                    ad.isOwn
                      ? labels.yourAdTag
                      : (ad.advertiserName ?? undefined)
                  }
                >
                  {ad.isOwn ? labels.yourAdTag : (ad.advertiserName ?? "—")}
                </span>
              </span>
              {ad.landingUrl ? (
                <a
                  href={ad.landingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={labels.linkAria}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-coral)",
                    textDecoration: "none",
                    flexShrink: 0,
                  }}
                >
                  &rarr;
                </a>
              ) : null}
            </div>
            <p
              style={{
                margin: 0,
                color: ad.adCreativeBody
                  ? "var(--color-text)"
                  : "var(--color-text-3)",
                fontSize: 14,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                fontStyle: ad.adCreativeBody ? "normal" : "italic",
              }}
            >
              {ad.adCreativeBody ?? labels.noCreative}
            </p>
          </li>
        ))}
      </ul>

      {overflow > 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
          }}
        >
          {labels.moreCount(overflow)}
        </p>
      ) : null}
    </article>
  );
}
