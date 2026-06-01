/**
 * SMB dashboard · PillarTiles (Scoring v2)
 *
 * Replaces the 6-dim ScoreBreakdown with 5 NAVIGABLE pillar tiles — the
 * decomposition becomes a map of Maria's business with doors on it. Each tile
 * shows the pillar's 0–10 score + a market-standing sub-line ("top 12%",
 * "#11 of 38", "fast win") and links to the page where she fixes it.
 *
 * Server component — pure display + locale-aware links (next-intl `Link`).
 * Tap targets ≥ 44px, visible focus ring, semantic list. Per
 * `.claude/rules/ui-ux-smb.md` (warm, mobile-first) + `accessibility.md`.
 */

import { Link } from "@/i18n/navigation";

export type PillarTileTone = "good" | "warn" | "bad" | "neutral";

/** The 5 pillar pages — typed so next-intl's `Link` accepts them. */
export type PillarHref =
  | "/reviews"
  | "/search"
  | "/my-business"
  | "/website"
  | "/ads";

export interface PillarTileData {
  /** Stable id (pillar key). */
  id: string;
  /** Maria-facing label (e.g. "Reputation"). */
  label: string;
  /** Locale-aware href to the pillar's page. */
  href: PillarHref;
  /** 0–10 pillar score, or null when not computed yet. */
  score: number | null;
  /** Market-standing sub-line ("top 12%", "#11 of 38", "fast win"). */
  sublabel: string;
  tone: PillarTileTone;
  /** Accessible label for the whole tile link ("Open Reputation"). */
  openLabel: string;
}

export interface PillarTilesProps {
  tiles: readonly PillarTileData[];
}

const TONE_COLOR: Record<PillarTileTone, string> = {
  good: "var(--color-success)",
  warn: "var(--color-gold)",
  bad: "var(--color-coral)",
  neutral: "var(--color-text)",
};

export function PillarTiles({ tiles }: PillarTilesProps) {
  return (
    <div
      role="list"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
      }}
    >
      {tiles.map((tile) => (
        <Link
          key={tile.id}
          // next-intl Link keeps the active locale prefix.
          href={tile.href}
          role="listitem"
          aria-label={tile.openLabel}
          className="smb-pillar-tile"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minHeight: 96,
            padding: "14px 16px",
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            textDecoration: "none",
            color: "var(--color-text)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--color-text-3)",
            }}
          >
            {tile.label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 32,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TONE_COLOR[tile.tone],
            }}
          >
            {tile.score == null ? "—" : tile.score.toFixed(1)}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 400,
                color: "var(--color-text-3)",
                marginLeft: 2,
              }}
            >
              /10
            </span>
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--color-text-2)",
            }}
          >
            {tile.sublabel}
          </span>
        </Link>
      ))}
    </div>
  );
}
