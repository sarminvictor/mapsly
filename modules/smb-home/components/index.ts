/**
 * SMB dashboard · audience-specific component library.
 *
 * Built on top of `components/ui` primitives (Button, Card, Pill, Modal).
 * These are Maria-facing components — cream + coral palette, warm copy
 * register, plain-English tooltips. Do not use in Agency routes; use the
 * `modules/agency-dashboard/components` library instead.
 *
 * See `.claude/rules/ui-ux-smb.md` for voice and density conventions and
 * `_design/product/home.html` for the original visual reference.
 *
 * Ships:
 *   - KPITile · hero + standard variants for the score summary
 *   - AlertCard · gentle info rows (e.g. the empty-fixes state)
 *   - FixCard · numbered prioritized quick wins
 *   - PillarTiles · the 5 navigable section-score tiles
 *   - MarketLeaderboardTable · interactive market competitor table
 *   - MarketChangesFeed · "this week — what changed" events feed
 */

export { KPITile } from "./KPITile";
export type {
  KPITileProps,
  KPITileTone,
  KPITileTrend,
  KPITileVariant,
} from "./KPITile";

export { AlertCard } from "./AlertCard";
export type { AlertCardProps, AlertTone } from "./AlertCard";

export { FixCard } from "./FixCard";
export type { FixCardProps, FixCardTone } from "./FixCard";

export { PillarTiles } from "./PillarTiles";
export type {
  PillarTileData,
  PillarTilesProps,
  PillarTileTone,
} from "./PillarTiles";

export { MarketLeaderboardTable } from "./MarketLeaderboardTable";
export type {
  MarketLeaderboardLabels,
  MarketLeaderboardTableProps,
} from "./MarketLeaderboardTable";

export { MarketChangesFeed } from "./MarketChangesFeed";
export type {
  MarketChangesFeedLabels,
  MarketChangesFeedProps,
} from "./MarketChangesFeed";
